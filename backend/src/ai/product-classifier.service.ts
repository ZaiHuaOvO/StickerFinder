import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AiStatusEnum,
  CandidateRelevanceEnum,
  MatchAssessmentEnum,
  MatchStatusEnum,
  MatchTypeEnum,
  NextActionEnum,
  PriceVerificationStatusEnum,
  SkuVerificationStatusEnum,
  VisualMatchEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SkuOption } from '../common/interfaces/price.interface';
import { normalizeTargetText } from '../common/utils/text.util';
import type {
  EvidenceEntry,
  SkuDecision,
} from '../entities/product-match-result.entity';
import {
  ClassificationResult,
  classificationResultSchema,
  parseJsonObject,
} from './ai.schema';
import { DeepseekService } from './deepseek.service';
import { ImageFetcherService } from './image-fetcher.service';
import {
  buildClassificationUserPrompt,
  CLASSIFICATION_SYSTEM_PROMPT,
  PROMPT_VERSION,
  TARGET_CATEGORY,
} from './prompts/product-classification.prompt';

export interface TargetDescriptor {
  name: string;
  seriesName?: string | null;
  aliases: string[];
  seriesAliases?: string[];
  brandNames?: string[];
  referenceImagePath?: string | null;
}

export interface ClassificationOutcome {
  aiStatus: AiStatusEnum;
  matchStatus: MatchStatusEnum;
  matchType: MatchTypeEnum | null;
  candidateRelevance: CandidateRelevanceEnum | null;
  categoryMatch: MatchAssessmentEnum | null;
  seriesMatch: MatchAssessmentEnum | null;
  targetItemMatch: MatchAssessmentEnum | null;
  visualMatch: VisualMatchEnum | null;
  confidence: number | null;
  summary: string;
  reason: string;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: EvidenceEntry[];
  nextAction: NextActionEnum | null;
  rawMatchStatus: MatchStatusEnum | null;
  rawConfidence: number | null;
  safetyWarnings: string[];
  safetyBlockers: string[];
  skuVerificationStatus: SkuVerificationStatusEnum;
  priceVerificationStatus: PriceVerificationStatusEnum;
  needsManualReview: boolean;
  rawResponse: Record<string, unknown> | null;
  error: string | null;
  model: string | null;
}

const MAX_CACHE_ENTRIES = 500;

@Injectable()
export class ProductClassifierService {
  private readonly logger = new Logger(ProductClassifierService.name);
  private readonly cache = new Map<string, ClassificationOutcome>();

  constructor(
    private readonly config: ConfigService,
    private readonly deepseek: DeepseekService,
    private readonly imageFetcher: ImageFetcherService,
  ) {}

  isConfigured(): boolean {
    return this.deepseek.isConfigured();
  }

  getStatus() {
    return {
      configured: this.deepseek.isConfigured(),
      model: this.deepseek.model,
      visionEnabled: this.imageFetcher.isVisionEnabled(),
      reason: this.deepseek.statusReason(),
    };
  }

  async classify(
    target: TargetDescriptor,
    candidate: NormalizedProduct,
    candidateRef: string,
    options: {
      detailEnriched?: boolean;
      referenceCases?: Array<{
        title: string;
        platform: string;
        manualDecision: string;
        note?: string | null;
      }>;
    } = {},
  ): Promise<ClassificationOutcome> {
    if (!this.deepseek.isConfigured()) {
      return this.skippedOutcome();
    }

    const visionEnabled = this.imageFetcher.isVisionEnabled();
    const detailEnriched = options.detailEnriched === true;
    const cacheKey = this.cacheKey(target, candidate, visionEnabled, detailEnriched);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const missingInformation: string[] = [];
    const imageDataUrls: string[] = [];
    let referenceImageUsed = false;
    let imageConfidencePenalty = 0;

    if (target.referenceImagePath) {
      if (!visionEnabled) {
        missingInformation.push(
          '已上传参考图片，但视觉比对未启用（AI_VISION_ENABLED=false），仅依据文字判断',
        );
      } else {
        const dataUrl = await this.imageFetcher.localImageToDataUrl(
          target.referenceImagePath,
          this.imageFetcher.maxImageBytes(),
        );
        if (dataUrl) {
          imageDataUrls.push(dataUrl);
          referenceImageUsed = true;
        } else {
          missingInformation.push('参考图片无法读取或超出大小限制，视觉比对未生效');
        }
      }
    }

    if (visionEnabled && candidate.imageUrls.length > 0) {
      const candidateImageUrls = candidate.imageUrls.slice(0, 2);
      let loadedCandidateImages = 0;
      for (const url of candidateImageUrls) {
        const dataUrl = await this.imageFetcher.remoteImageToDataUrl(
          url,
          this.imageFetcher.maxImageBytes(),
          10_000,
        );
        if (dataUrl) {
          imageDataUrls.push(dataUrl);
          loadedCandidateImages += 1;
        }
      }
      if (loadedCandidateImages === 0) {
        missingInformation.push('候选商品图片下载失败或不可访问，视觉比对未参与判断');
      } else if (loadedCandidateImages < candidateImageUrls.length) {
        missingInformation.push(
          `候选商品图片仅部分可用（${loadedCandidateImages}/${candidateImageUrls.length}）`,
        );
      }
      if (loadedCandidateImages === 0) {
        imageConfidencePenalty = 0.05;
      }
    }

    const referenceExpected = Boolean(target.referenceImagePath);
    if (referenceExpected && !referenceImageUsed) {
      imageConfidencePenalty = 0.1;
    }

    if (!candidate.description) missingInformation.push('商品描述缺失');
    if (candidate.skuOptions.length === 0) missingInformation.push('SKU 详情缺失');
    if (candidate.imageUrls.length === 0) missingInformation.push('商品图片缺失');

    const payload = this.buildPayload(target, candidate, missingInformation, {
      imageCount: imageDataUrls.length,
      referenceImageIncluded: referenceImageUsed,
      referenceCases: options.referenceCases,
    });
    const userPrompt = buildClassificationUserPrompt(payload);
    const rawMinConfidence = Number.parseFloat(
      this.config.get<string>('AI_MIN_CONFIDENCE') ?? '',
    );
    const minConfidence = Number.isFinite(rawMinConfidence)
      ? Math.min(1, Math.max(0, rawMinConfidence))
      : 0.65;

    let lastError = 'AI 识别失败';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const content = await this.deepseek.chatJson(
          CLASSIFICATION_SYSTEM_PROMPT,
          userPrompt,
          imageDataUrls,
        );
        const parsedObject = parseJsonObject(content);
        const parsed = classificationResultSchema.parse(parsedObject);
        const safe = this.applySafety(
          parsed,
          candidate,
          minConfidence,
          missingInformation,
          imageConfidencePenalty,
          imageDataUrls.length,
          detailEnriched,
        );
        const outcome: ClassificationOutcome = {
          aiStatus: AiStatusEnum.OK,
          ...safe,
          rawResponse: parsedObject as Record<string, unknown>,
          error: null,
          model: this.deepseek.model,
        };
        this.remember(cacheKey, outcome);
        return outcome;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `AI 识别失败（候选 ${candidateRef}，第 ${attempt} 次）：${lastError.slice(0, 300)}`,
        );
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    return {
      aiStatus: AiStatusEnum.FAILED,
      matchStatus: MatchStatusEnum.UNCERTAIN,
      matchType: MatchTypeEnum.UNCERTAIN,
      candidateRelevance: null,
      categoryMatch: null,
      seriesMatch: null,
      targetItemMatch: null,
      visualMatch: null,
      confidence: null,
      summary: 'AI 识别失败，已保留原始商品信息，请人工确认',
      reason: 'AI 识别失败，商品保留在待确认区域，请人工核对原始商品页面',
      matchedContents: [],
      matchedSkuIds: [],
      skuDecisions: [],
      evidence: [],
      nextAction: NextActionEnum.MANUAL_REVIEW,
      rawMatchStatus: null,
      rawConfidence: null,
      safetyWarnings: [],
      safetyBlockers: ['AI 识别失败，未取得可用结果'],
      skuVerificationStatus: SkuVerificationStatusEnum.NOT_AVAILABLE,
      priceVerificationStatus: PriceVerificationStatusEnum.UNVERIFIED,
      needsManualReview: true,
      rawResponse: null,
      error: lastError.slice(0, 1000),
      model: this.deepseek.model,
    };
  }

  private skippedOutcome(): ClassificationOutcome {
    return {
      aiStatus: AiStatusEnum.SKIPPED,
      matchStatus: MatchStatusEnum.UNCERTAIN,
      matchType: MatchTypeEnum.UNCERTAIN,
      candidateRelevance: null,
      categoryMatch: null,
      seriesMatch: null,
      targetItemMatch: null,
      visualMatch: null,
      confidence: null,
      summary: 'AI 识别未配置，商品已保留在待确认区域',
      reason: 'AI 识别未配置（缺少 DEEPSEEK_API_KEY 或已禁用），未对商品做自动判断',
      matchedContents: [],
      matchedSkuIds: [],
      skuDecisions: [],
      evidence: [],
      nextAction: NextActionEnum.MANUAL_REVIEW,
      rawMatchStatus: null,
      rawConfidence: null,
      safetyWarnings: [],
      safetyBlockers: ['AI 识别未配置，未做自动判断'],
      skuVerificationStatus: SkuVerificationStatusEnum.NOT_AVAILABLE,
      priceVerificationStatus: PriceVerificationStatusEnum.UNVERIFIED,
      needsManualReview: true,
      rawResponse: null,
      error: 'AI 识别未配置',
      model: null,
    };
  }

  private buildPayload(
    target: TargetDescriptor,
    candidate: NormalizedProduct,
    missingInformation: string[],
    imageInput: {
      imageCount: number;
      referenceImageIncluded: boolean;
      referenceCases?: Array<{
        title: string;
        platform: string;
        manualDecision: string;
        note?: string | null;
      }>;
    },
  ) {
    const skuOptions = candidate.skuOptions.slice(0, 50).map((sku, index) => ({
      skuId: sku.skuId ?? `sku-${index + 1}`,
      name: sku.name.slice(0, 200),
    }));
    return {
      target: {
        name: target.name,
        seriesName: target.seriesName ?? null,
        aliases: target.aliases,
        seriesAliases: target.seriesAliases ?? [],
        brandNames: target.brandNames ?? [],
        normalizedName: normalizeTargetText(target.name),
        normalizedSeries: normalizeTargetText(target.seriesName),
        targetCategory: TARGET_CATEGORY,
        referenceImageProvided: Boolean(target.referenceImagePath),
      },
      candidate: {
        platform: candidate.platform,
        title: candidate.title.slice(0, 300),
        description: (candidate.description ?? '').slice(0, 1500) || null,
        shopName: candidate.shopName ?? null,
        skuOptions,
      },
      imageInput:
        imageInput.imageCount > 0
          ? {
              count: imageInput.imageCount,
              referenceImageIncluded: imageInput.referenceImageIncluded,
              note: imageInput.referenceImageIncluded
                ? '图片顺序：第 1 张为用户提供的参考贴纸，其余为候选商品图片。参考图只能作为辅助证据。'
                : '图片均为候选商品图片。',
            }
          : null,
      missingInformation,
      referenceCases: imageInput.referenceCases?.slice(0, 2) ?? [],
    };
  }

  private applySafety(
    result: ClassificationResult,
    candidate: NormalizedProduct,
    minConfidence: number,
    missingInformation: string[],
    imageConfidencePenalty: number,
    imageCount: number,
    detailEnriched: boolean,
  ): Omit<ClassificationOutcome, 'aiStatus' | 'rawResponse' | 'error' | 'model'> {
    const warnings: string[] = [...missingInformation];
    const blockers: string[] = [];
    const rawMatchStatus = result.matchStatus as MatchStatusEnum;
    const rawConfidence = Math.max(0, Math.min(1, result.confidence));
    let matchStatus = rawMatchStatus;
    let matchType: MatchTypeEnum | null = result.matchType as MatchTypeEnum | null;
    let confidence = rawConfidence;
    let needsManualReview = result.needsManualReview;

    const providedSkus = candidate.skuOptions.map(
      (sku, index) => sku.skuId ?? `sku-${index + 1}`,
    );
    const knownSkuIds = new Set(providedSkus);

    const invalidMatchedSkuIds = result.matchedSkuIds.filter(
      (id) => !knownSkuIds.has(id),
    );
    if (invalidMatchedSkuIds.length > 0) {
      blockers.push('AI 返回了输入中不存在的 SKU ID，已剔除');
      needsManualReview = true;
    }
    let matchedSkuIds = result.matchedSkuIds.filter((id) => knownSkuIds.has(id));

    const invalidSkuDecisions = result.skuDecisions.filter(
      (decision) => !knownSkuIds.has(decision.skuId),
    );
    if (invalidSkuDecisions.length > 0) {
      blockers.push('AI 返回了输入中不存在的 SKU 判断，已剔除');
      needsManualReview = true;
    }
    let skuDecisions: SkuDecision[] = result.skuDecisions.filter((decision) =>
      knownSkuIds.has(decision.skuId),
    );
    if (providedSkus.length > 0) {
      const covered = new Set(skuDecisions.map((decision) => decision.skuId));
      const missingDecisions = providedSkus
        .filter((skuId) => !covered.has(skuId))
        .map((skuId) => ({
          skuId,
          matchStatus: 'UNCERTAIN' as const,
          reason: 'AI 未返回该 SKU 的判断，已标记待确认',
        }));
      if (missingDecisions.length > 0) {
        skuDecisions = [...skuDecisions, ...missingDecisions];
        warnings.push('AI 未逐一判断全部 SKU，缺失项已标记待确认');
      }
    }

    // matchedSkuIds 必须与 AI 自己的 SKU 判断一致：被判为 NO_MATCH/UNCERTAIN 的 SKU 不能出现在“符合的 SKU”里
    const decisionById = new Map(skuDecisions.map((decision) => [decision.skuId, decision]));
    const reconciledSkuIds = matchedSkuIds.filter(
      (id) => decisionById.get(id)?.matchStatus === 'MATCH',
    );
    if (reconciledSkuIds.length !== matchedSkuIds.length) {
      blockers.push('AI 返回的匹配 SKU 与其 SKU 判断不一致，已收紧为一致结果');
      needsManualReview = true;
      matchedSkuIds = reconciledSkuIds;
    }

    const availableEvidenceSources = new Set<EvidenceEntry['sourceField']>(['title']);
    if (candidate.description) availableEvidenceSources.add('description');
    if (candidate.skuOptions.length > 0) availableEvidenceSources.add('sku');
    if (imageCount > 0) availableEvidenceSources.add('image');
    const evidence = result.evidence.filter((entry) =>
      availableEvidenceSources.has(entry.sourceField),
    );
    if (evidence.length !== result.evidence.length) {
      warnings.push('AI 提供了输入中不存在的证据来源，已剔除');
    }

    // v2 明确：candidateRelevance 为 NONE 时 matchStatus 必须是 NO_MATCH
    if (
      result.candidateRelevance === CandidateRelevanceEnum.NONE &&
      matchStatus !== MatchStatusEnum.NO_MATCH
    ) {
      blockers.push('候选相关性为 NONE，按规则判为不匹配');
      matchStatus = MatchStatusEnum.NO_MATCH;
      needsManualReview = true;
    }

    if (matchStatus === MatchStatusEnum.NO_MATCH) {
      matchType = MatchTypeEnum.NOT_MATCH;
    } else if (matchStatus === MatchStatusEnum.UNCERTAIN) {
      matchType = MatchTypeEnum.UNCERTAIN;
      needsManualReview = true;
    } else if (matchStatus === MatchStatusEnum.MATCH) {
      if (imageConfidencePenalty > 0) {
        confidence = Math.max(
          0,
          Math.round((confidence - imageConfidencePenalty) * 1000) / 1000,
        );
        warnings.push(`视觉证据不足，置信度下调 ${imageConfidencePenalty.toFixed(2)}`);
      }

      const validTypes = new Set<MatchTypeEnum>([
        MatchTypeEnum.EXACT_SINGLE,
        MatchTypeEnum.TARGET_VARIANT,
        MatchTypeEnum.CONTAINS_TARGET_BUNDLE,
        MatchTypeEnum.CONTAINS_TARGET_FULL_SET,
      ]);
      if (!matchType || !validTypes.has(matchType)) {
        blockers.push('AI 判为 MATCH 但未给出有效的匹配类型');
      }
      if (evidence.length === 0) {
        blockers.push('AI 判为 MATCH 但未提供判断依据');
      }
      if (result.categoryMatch === MatchAssessmentEnum.CONFLICT) {
        blockers.push('AI 判为 MATCH 但商品类别与目标类别冲突');
      }
      if (result.targetItemMatch !== MatchAssessmentEnum.MATCH) {
        blockers.push('AI 判为 MATCH 但目标款式未确认匹配');
      }
      if (
        result.seriesMatch === MatchAssessmentEnum.CONFLICT &&
        (matchType === MatchTypeEnum.EXACT_SINGLE ||
          matchType === MatchTypeEnum.TARGET_VARIANT)
      ) {
        blockers.push('AI 判为 MATCH 但目标系列与候选系列冲突');
      }
      if (confidence < minConfidence) {
        blockers.push(`置信度 ${confidence.toFixed(2)} 低于阈值 ${minConfidence}`);
      }
      if (matchType === MatchTypeEnum.TARGET_VARIANT) {
        if (candidate.skuOptions.length === 0) {
          blockers.push('AI 判为指定 SKU 匹配，但商品没有 SKU 详情，无法确认具体售卖内容');
        } else if (matchedSkuIds.length === 0) {
          blockers.push('AI 判为指定 SKU 匹配但未指出符合的 SKU');
        }
      } else if (
        matchType === MatchTypeEnum.CONTAINS_TARGET_BUNDLE ||
        matchType === MatchTypeEnum.CONTAINS_TARGET_FULL_SET
      ) {
        if (matchedSkuIds.length === 0 && result.matchedContents.length === 0) {
          blockers.push('AI 判为组合装/全系列匹配，但未给出具体包含内容或 SKU 证据');
        }
      } else if (matchType === MatchTypeEnum.EXACT_SINGLE && candidate.skuOptions.length > 0) {
        const hasMatchedSku =
          matchedSkuIds.length > 0 ||
          skuDecisions.some((decision) => decision.matchStatus === 'MATCH');
        if (!hasMatchedSku) {
          blockers.push('商品存在 SKU 详情，但没有任何 SKU 被判为包含目标贴纸，无法确认售卖内容');
        }
      }
      if (blockers.length > 0) {
        matchStatus = MatchStatusEnum.UNCERTAIN;
        matchType = MatchTypeEnum.UNCERTAIN;
        needsManualReview = true;
      }
    }

    let nextAction = result.nextAction as NextActionEnum;
    if (
      matchStatus === MatchStatusEnum.UNCERTAIN &&
      nextAction === NextActionEnum.NONE
    ) {
      nextAction = NextActionEnum.MANUAL_REVIEW;
    }
    if (nextAction === NextActionEnum.MANUAL_REVIEW) {
      needsManualReview = true;
    }

    const skuById = new Map(
      candidate.skuOptions.map((sku, index) => [
        sku.skuId ?? `sku-${index + 1}`,
        sku,
      ]),
    );
    const matchedSkuOptions = matchedSkuIds
      .map((id) => skuById.get(id))
      .filter((sku): sku is SkuOption => Boolean(sku));

    let skuVerificationStatus = SkuVerificationStatusEnum.PENDING;
    let priceVerificationStatus = PriceVerificationStatusEnum.UNVERIFIED;

    if (candidate.skuOptions.length === 0) {
      skuVerificationStatus = SkuVerificationStatusEnum.NOT_AVAILABLE;
    } else if (detailEnriched && matchStatus === MatchStatusEnum.MATCH) {
      if (matchedSkuOptions.length > 0) {
        skuVerificationStatus = SkuVerificationStatusEnum.VERIFIED;
        const pricedSkuCount = matchedSkuOptions.filter(
          (sku) => typeof sku.price === 'number',
        ).length;
        if (pricedSkuCount === matchedSkuOptions.length) {
          priceVerificationStatus = PriceVerificationStatusEnum.VERIFIED;
        } else if (pricedSkuCount > 0) {
          priceVerificationStatus = PriceVerificationStatusEnum.PARTIAL;
        }
      } else if (
        (matchType === MatchTypeEnum.CONTAINS_TARGET_BUNDLE ||
          matchType === MatchTypeEnum.CONTAINS_TARGET_FULL_SET) &&
        result.matchedContents.length > 0
      ) {
        // 组合装/全系列以内容清单确认，未必能一一对应到 SKU
        skuVerificationStatus = SkuVerificationStatusEnum.PARTIAL;
      } else {
        skuVerificationStatus = SkuVerificationStatusEnum.PENDING;
      }
    } else if (matchStatus === MatchStatusEnum.NO_MATCH) {
      skuVerificationStatus = SkuVerificationStatusEnum.NOT_AVAILABLE;
    } else {
      const matchSkuCount = skuDecisions.filter(
        (decision) => decision.matchStatus === 'MATCH',
      ).length;
      const uncertainSkuCount = skuDecisions.filter(
        (decision) => decision.matchStatus === 'UNCERTAIN',
      ).length;
      if (matchSkuCount > 0 && uncertainSkuCount > 0) {
        skuVerificationStatus = SkuVerificationStatusEnum.PARTIAL;
      } else if (matchSkuCount > 0) {
        // 已通过文字/SKU 名称定位，仍等待详情接口核验
        skuVerificationStatus = SkuVerificationStatusEnum.PENDING;
      } else {
        skuVerificationStatus = SkuVerificationStatusEnum.NOT_AVAILABLE;
      }
    }

    const reasonParts = [result.reason.trim()];
    if (blockers.length > 0) {
      reasonParts.push(`系统阻断：${blockers.join('；')}`);
    }
    if (warnings.length > 0) {
      reasonParts.push(`系统警告：${warnings.join('；')}`);
    }

    return {
      matchStatus,
      matchType,
      candidateRelevance: result.candidateRelevance as CandidateRelevanceEnum,
      categoryMatch: result.categoryMatch as MatchAssessmentEnum,
      seriesMatch: result.seriesMatch as MatchAssessmentEnum,
      targetItemMatch: result.targetItemMatch as MatchAssessmentEnum,
      visualMatch: result.visualMatch as VisualMatchEnum,
      confidence: Math.round(confidence * 1000) / 1000,
      summary: result.productContentSummary.trim() || result.reason.trim(),
      reason: reasonParts.join(' '),
      matchedContents: result.matchedContents,
      matchedSkuIds,
      skuDecisions,
      evidence,
      nextAction,
      rawMatchStatus,
      rawConfidence,
      safetyWarnings: warnings,
      safetyBlockers: blockers,
      skuVerificationStatus,
      priceVerificationStatus,
      needsManualReview,
    };
  }

  private cacheKey(
    target: TargetDescriptor,
    candidate: NormalizedProduct,
    visionEnabled: boolean,
    detailEnriched: boolean,
  ): string {
    const material = {
      promptVersion: PROMPT_VERSION,
      model: this.deepseek.model,
      visionEnabled,
      detailEnriched,
      target: {
        name: target.name,
        seriesName: target.seriesName ?? null,
        aliases: target.aliases,
        seriesAliases: target.seriesAliases ?? [],
        brandNames: target.brandNames ?? [],
        category: TARGET_CATEGORY,
        referenceImagePath: target.referenceImagePath ?? null,
      },
      candidate: {
        platform: candidate.platform,
        platformProductId: candidate.platformProductId ?? null,
        title: candidate.title,
        description: candidate.description ?? null,
        shopName: candidate.shopName ?? null,
        skuOptions: candidate.skuOptions,
        imageUrls: visionEnabled ? candidate.imageUrls.slice(0, 2) : [],
      },
    };
    return createHash('sha256').update(JSON.stringify(material)).digest('hex');
  }

  private remember(key: string, outcome: ClassificationOutcome): void {
    if (outcome.aiStatus !== AiStatusEnum.OK) return;
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, outcome);
  }
}
