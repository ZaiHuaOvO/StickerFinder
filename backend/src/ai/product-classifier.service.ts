import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AiStatusEnum,
  MatchStatusEnum,
  MatchTypeEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import type { SkuDecision } from '../entities/product-match-result.entity';
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
} from './prompts/product-classification.prompt';

export interface TargetDescriptor {
  name: string;
  seriesName?: string | null;
  aliases: string[];
  referenceImagePath?: string | null;
}

export interface ClassificationOutcome {
  aiStatus: AiStatusEnum;
  matchStatus: MatchStatusEnum;
  matchType: MatchTypeEnum | null;
  confidence: number | null;
  summary: string;
  reason: string;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: string[];
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
  ): Promise<ClassificationOutcome> {
    if (!this.deepseek.isConfigured()) {
      return this.skippedOutcome();
    }

    const visionEnabled = this.imageFetcher.isVisionEnabled();
    const cacheKey = this.cacheKey(target, candidate, visionEnabled);
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
      confidence: null,
      summary: 'AI 识别失败，已保留原始商品信息，请人工确认',
      reason: 'AI 识别失败，商品保留在待确认区域，请人工核对原始商品页面',
      matchedContents: [],
      matchedSkuIds: [],
      skuDecisions: [],
      evidence: [],
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
      confidence: null,
      summary: 'AI 识别未配置，商品已保留在待确认区域',
      reason: 'AI 识别未配置（缺少 DEEPSEEK_API_KEY 或已禁用），未对商品做自动判断',
      matchedContents: [],
      matchedSkuIds: [],
      skuDecisions: [],
      evidence: [],
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
    imageInput: { imageCount: number; referenceImageIncluded: boolean },
  ) {
    const skuOptions = candidate.skuOptions.slice(0, 50).map((sku, index) => ({
      skuId: sku.skuId ?? `sku-${index + 1}`,
      name: sku.name.slice(0, 200),
      price: sku.price ?? null,
    }));
    return {
      target: {
        name: target.name,
        seriesName: target.seriesName ?? null,
        aliases: target.aliases,
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
    };
  }

  private applySafety(
    result: ClassificationResult,
    candidate: NormalizedProduct,
    minConfidence: number,
    missingInformation: string[],
    imageConfidencePenalty: number,
  ): Omit<ClassificationOutcome, 'aiStatus' | 'rawResponse' | 'error' | 'model'> {
    const notes: string[] = [];
    let matchStatus = result.matchStatus as MatchStatusEnum;
    let matchType: MatchTypeEnum | null = result.matchType as MatchTypeEnum | null;
    let confidence = Math.max(0, Math.min(1, result.confidence));
    let needsManualReview = result.needsManualReview;

    const providedSkus = candidate.skuOptions.map(
      (sku, index) => sku.skuId ?? `sku-${index + 1}`,
    );
    const knownSkuIds = new Set(providedSkus);

    let matchedSkuIds = result.matchedSkuIds.filter((id) => knownSkuIds.has(id));
    if (matchedSkuIds.length !== result.matchedSkuIds.length) {
      notes.push('AI 返回了输入中不存在的 SKU ID，已剔除');
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
        needsManualReview = true;
      }
    }

    // matchedSkuIds 必须与 AI 自己的 SKU 判断一致：被判为 NO_MATCH/UNCERTAIN 的 SKU 不能出现在“符合的 SKU”里
    const decisionById = new Map(skuDecisions.map((decision) => [decision.skuId, decision]));
    const reconciledSkuIds = matchedSkuIds.filter(
      (id) => decisionById.get(id)?.matchStatus === 'MATCH',
    );
    if (reconciledSkuIds.length !== matchedSkuIds.length) {
      notes.push('AI 返回的匹配 SKU 与其 SKU 判断不一致，已收紧为一致结果');
      needsManualReview = true;
      matchedSkuIds = reconciledSkuIds;
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
        needsManualReview = true;
        notes.push(`视觉证据不足，置信度下调 ${imageConfidencePenalty.toFixed(2)}`);
      }

      const validTypes = new Set<MatchTypeEnum>([
        MatchTypeEnum.EXACT_SINGLE,
        MatchTypeEnum.TARGET_VARIANT,
        MatchTypeEnum.CONTAINS_TARGET_BUNDLE,
        MatchTypeEnum.CONTAINS_TARGET_FULL_SET,
      ]);
      if (!matchType || !validTypes.has(matchType)) {
        notes.push('AI 判为 MATCH 但未给出有效的匹配类型');
      }
      if (result.evidence.length === 0) {
        notes.push('AI 判为 MATCH 但未提供判断依据');
      }
      if (confidence < minConfidence) {
        notes.push(`置信度 ${confidence.toFixed(2)} 低于阈值 ${minConfidence}`);
      }
      if (matchType === MatchTypeEnum.TARGET_VARIANT) {
        if (candidate.skuOptions.length === 0) {
          notes.push('AI 判为指定 SKU 匹配，但商品没有 SKU 详情，无法确认具体售卖内容');
        } else if (matchedSkuIds.length === 0) {
          notes.push('AI 判为指定 SKU 匹配但未指出符合的 SKU');
        }
      } else if (
        (matchType === MatchTypeEnum.CONTAINS_TARGET_BUNDLE ||
          matchType === MatchTypeEnum.CONTAINS_TARGET_FULL_SET) &&
        candidate.skuOptions.length > 0 &&
        matchedSkuIds.length === 0
      ) {
        notes.push('商品存在多个 SKU，但 AI 未指出包含目标贴纸的 SKU');
      } else if (matchType === MatchTypeEnum.EXACT_SINGLE && candidate.skuOptions.length > 0) {
        const hasMatchedSku =
          matchedSkuIds.length > 0 ||
          skuDecisions.some((decision) => decision.matchStatus === 'MATCH');
        if (!hasMatchedSku) {
          notes.push('商品存在 SKU 详情，但没有任何 SKU 被判为包含目标贴纸，无法确认售卖内容');
        }
      }
      if (notes.length > 0) {
        matchStatus = MatchStatusEnum.UNCERTAIN;
        matchType = MatchTypeEnum.UNCERTAIN;
        needsManualReview = true;
      }
    }

    const reasonParts = [result.reason.trim()];
    if (notes.length > 0) {
      reasonParts.push(`系统校验：${notes.join('；')}`);
    }
    if (missingInformation.length > 0) {
      reasonParts.push(`信息缺失：${missingInformation.join('；')}`);
    }

    return {
      matchStatus,
      matchType,
      confidence: Math.round(confidence * 1000) / 1000,
      summary: result.productContentSummary.trim() || result.reason.trim(),
      reason: reasonParts.join(' '),
      matchedContents: result.matchedContents,
      matchedSkuIds,
      skuDecisions,
      evidence: result.evidence,
      needsManualReview,
    };
  }

  private cacheKey(
    target: TargetDescriptor,
    candidate: NormalizedProduct,
    visionEnabled: boolean,
  ): string {
    const material = {
      promptVersion: PROMPT_VERSION,
      model: this.deepseek.model,
      visionEnabled,
      target: {
        name: target.name,
        seriesName: target.seriesName ?? null,
        aliases: target.aliases,
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
