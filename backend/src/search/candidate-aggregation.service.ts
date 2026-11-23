import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProductClassifierService,
  TargetDescriptor,
} from '../ai/product-classifier.service';
import { SameProductDescriptor, SameProductService } from '../ai/same-product.service';
import {
  MatchStatusEnum,
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SkuOption } from '../common/interfaces/price.interface';
import {
  isAmbiguousSameProduct,
  strongProductMatch,
  StrongMatchReason,
  titleSimilarity,
  imageOverlap,
} from '../common/utils/product-dedupe.util';
import { sanitizeRawData } from '../common/utils/sanitize.util';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  ProductObservation,
} from '../entities';

export interface AiMatchBudget {
  remaining: number;
}

export interface IngestResult {
  candidate: ProductCandidate;
  matchReason: string;
  aiUsed: boolean;
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function mergeSkuOptions(existing: SkuOption[], incoming: SkuOption[]): SkuOption[] {
  const result = [...existing];
  const keys = new Set(
    existing.map((sku, index) => `${sku.skuId ?? ''}|${sku.name}|${index}`),
  );
  const nameKeys = new Set(existing.map((sku) => `${sku.skuId ?? ''}|${sku.name}`));
  for (const sku of incoming) {
    const key = `${sku.skuId ?? ''}|${sku.name}`;
    if (nameKeys.has(key) || keys.has(key)) continue;
    nameKeys.add(key);
    result.push(sku);
  }
  return result.slice(0, 100);
}

@Injectable()
export class CandidateAggregationService {
  private readonly logger = new Logger(CandidateAggregationService.name);

  constructor(
    private readonly classifier: ProductClassifierService,
    private readonly sameProduct: SameProductService,
    @InjectRepository(ProductCandidate)
    private readonly candidateRepo: Repository<ProductCandidate>,
    @InjectRepository(ProductObservation)
    private readonly observationRepo: Repository<ProductObservation>,
    @InjectRepository(ProductMatchResult)
    private readonly matchRepo: Repository<ProductMatchResult>,
  ) {}

  async loadCandidates(
    searchRunId: string,
    platform: PlatformEnum,
  ): Promise<ProductCandidate[]> {
    const candidates = await this.candidateRepo.find({
      where: { searchRunId, platform },
      relations: { observations: true, matchResult: true },
      order: { collectedAt: 'ASC' },
    });
    for (const candidate of candidates) {
      candidate.observations = candidate.observations ?? [];
    }
    return candidates;
  }

  async ingest(
    searchRunId: string,
    platform: PlatformEnum,
    product: NormalizedProduct,
    task: PlatformSearchTask,
    candidates: ProductCandidate[],
    aiBudget: AiMatchBudget,
  ): Promise<IngestResult> {
    const providerKey = product.providerKey ?? ProviderKeyEnum.PLAYWRIGHT;
    let matched: ProductCandidate | undefined;
    let matchReason: StrongMatchReason | 'ai_same_product' | 'new' = null;
    let aiUsed = false;

    for (const candidate of candidates) {
      const reason = strongProductMatch(product, candidate);
      if (reason === 'strong:id' || reason === 'strong:url') {
        matched = candidate;
        matchReason = reason;
        break;
      }
      if (reason === 'strong:title_shop' && this.isCrossProvider(candidate, providerKey)) {
        matched = candidate;
        matchReason = reason;
        break;
      }
    }

    if (!matched && this.sameProduct.isConfigured() && aiBudget.remaining > 0) {
      const ambiguous = candidates
        .filter((candidate) => this.isCrossProvider(candidate, providerKey))
        .map((candidate) => ({
          candidate,
          score: Math.max(
            titleSimilarity(product.title, candidate.title),
            imageOverlap(product.imageUrls, candidate.imageUrls ?? []),
          ),
        }))
        .filter(({ candidate }) => isAmbiguousSameProduct(product, candidate))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      for (const { candidate } of ambiguous) {
        if (aiBudget.remaining <= 0) break;
        aiBudget.remaining -= 1;
        aiUsed = true;
        const outcome = await this.sameProduct.compare(
          this.descriptorFromProduct(product),
          this.descriptorFromCandidate(candidate),
        );
        this.logger.log(
          `同款判断 candidate=${candidate.id} provider=${providerKey} verdict=${outcome.verdict} confidence=${outcome.confidence}`,
        );
        if (outcome.isSame) {
          matched = candidate;
          matchReason = 'ai_same_product';
          break;
        }
      }
    }

    if (!matched) {
      const candidate = await this.createCandidate(searchRunId, platform, product);
      candidates.push(candidate);
      const observation = await this.createObservation(
        searchRunId,
        task,
        candidate,
        product,
        'new',
      );
      candidate.observations = [...(candidate.observations ?? []), observation];
      return { candidate, matchReason: 'new', aiUsed };
    }

    await this.mergeCandidate(matched, product);
    const observation = await this.createObservation(
      searchRunId,
      task,
      matched,
      product,
      matchReason ?? 'new',
    );
    matched.observations = [...(matched.observations ?? []), observation];
    return { candidate: matched, matchReason: matchReason ?? 'new', aiUsed };
  }

  async classifyPending(
    searchRunId: string,
    platform: PlatformEnum,
    target: TargetDescriptor,
  ): Promise<{ classified: number; failed: number }> {
    const candidates = await this.loadCandidates(searchRunId, platform);
    let classified = 0;
    let failed = 0;
    for (const candidate of candidates) {
      if (candidate.matchResult) continue;
      const representative = this.representativeProduct(candidate);
      try {
        const outcome = await this.classifier.classify(
          target,
          representative,
          candidate.id,
        );
        const match = this.matchRepo.create({
          candidateId: candidate.id,
          matchStatus: outcome.matchStatus,
          matchType: outcome.matchType,
          confidence: outcome.confidence,
          summary: outcome.summary,
          reason: outcome.reason,
          matchedContents: outcome.matchedContents,
          matchedSkuIds: outcome.matchedSkuIds,
          skuDecisions: outcome.skuDecisions,
          evidence: outcome.evidence,
          aiStatus: outcome.aiStatus,
          aiModel: outcome.model,
          aiRawResponse: outcome.rawResponse,
          aiError: outcome.error,
          needsManualReview: outcome.needsManualReview,
          classifiedAt: new Date(),
        });
        await this.matchRepo.save(match);
        candidate.matchResult = match;
        classified += 1;
        if (outcome.matchStatus === MatchStatusEnum.UNCERTAIN) {
          // 识别不确定属于正常安全结果，不计为失败
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `候选商品识别保存失败 candidate=${candidate.id}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { classified, failed };
  }

  private async createCandidate(
    searchRunId: string,
    platform: PlatformEnum,
    product: NormalizedProduct,
  ): Promise<ProductCandidate> {
    const candidate = this.candidateRepo.create({
      searchRunId,
      platform,
      platformProductId: product.platformProductId?.slice(0, 200) ?? null,
      title: product.title.slice(0, 500),
      shopName: product.shopName ? product.shopName.slice(0, 250) : null,
      productUrl: product.productUrl,
      imageUrls: product.imageUrls.slice(0, 10),
      description: product.description ?? null,
      skuData: product.skuOptions ?? [],
      priceData: product.price ?? null,
      groupPriceData: product.groupPrice ?? null,
      sourceType: product.sourceType,
      rawData: (sanitizeRawData(product.rawData) as Record<string, unknown>) ?? null,
      collectedAt: toDate(product.collectedAt),
      observations: [],
    });
    return this.candidateRepo.save(candidate);
  }

  private async mergeCandidate(
    candidate: ProductCandidate,
    product: NormalizedProduct,
  ): Promise<void> {
    if (!candidate.shopName && product.shopName) candidate.shopName = product.shopName;
    if (
      product.description &&
      (!candidate.description || product.description.length > candidate.description.length)
    ) {
      candidate.description = product.description;
    }
    if (!candidate.priceData && product.price) candidate.priceData = product.price;
    if (!candidate.groupPriceData && product.groupPrice) {
      candidate.groupPriceData = product.groupPrice;
    }
    if (!candidate.rawData && product.rawData) {
      candidate.rawData = sanitizeRawData(product.rawData) as Record<string, unknown>;
    }
    candidate.imageUrls = [
      ...new Set([
        ...(candidate.imageUrls ?? []),
        ...(product.imageUrls ?? []),
      ]),
    ].slice(0, 10);
    if (product.skuOptions?.length) {
      candidate.skuData = mergeSkuOptions(candidate.skuData ?? [], product.skuOptions);
    }
    await this.candidateRepo.save(candidate);
  }

  private async createObservation(
    searchRunId: string,
    task: PlatformSearchTask,
    candidate: ProductCandidate,
    product: NormalizedProduct,
    matchReason: string,
  ): Promise<ProductObservation> {
    const observedAt = toDate(product.collectedAt);
    const observation = this.observationRepo.create({
      searchRunId,
      candidateId: candidate.id,
      providerTaskId: task.id,
      platform: product.platform,
      provider: product.providerKey ?? ProviderKeyEnum.PLAYWRIGHT,
      source: product.source ?? this.sourceFromProviderType(task.providerType),
      sourceProductId:
        product.sourceProductId?.slice(0, 200) ??
        product.platformProductId?.slice(0, 200) ??
        null,
      title: product.title.slice(0, 500),
      shopName: product.shopName ? product.shopName.slice(0, 250) : null,
      productUrl: product.productUrl,
      imageUrls: product.imageUrls.slice(0, 10),
      description: product.description ?? null,
      skuData: product.skuOptions ?? [],
      priceData: product.price ?? null,
      originalPriceData: product.originalPrice ?? null,
      groupPriceData: product.groupPrice ?? null,
      salesText: product.salesText?.slice(0, 100) ?? null,
      rating: typeof product.rating === 'number' ? product.rating : null,
      region: product.region?.slice(0, 50) ?? null,
      regionNote: product.regionNote ?? null,
      matchReason,
      rawData: (sanitizeRawData(product.rawData) as Record<string, unknown>) ?? null,
      observedAt,
      collectedAt: new Date(),
    });
    return this.observationRepo.save(observation);
  }

  private representativeProduct(candidate: ProductCandidate): NormalizedProduct {
    const observation = (candidate.observations ?? [])[0];
    const observationTitles = [
      ...new Set(
        (candidate.observations ?? [])
          .map((item) => item.title?.trim())
          .filter((title): title is string => Boolean(title)),
      ),
    ];
    const description =
      observationTitles.length > 1
        ? [candidate.description, `其他来源标题：${observationTitles.join(' | ')}`]
            .filter(Boolean)
            .join('\n')
        : candidate.description;
    return {
      platform: candidate.platform,
      platformProductId: candidate.platformProductId ?? undefined,
      title: candidate.title,
      shopName: candidate.shopName ?? undefined,
      productUrl: candidate.productUrl,
      imageUrls: candidate.imageUrls ?? [],
      description: description ?? undefined,
      skuOptions: candidate.skuData ?? [],
      price: candidate.priceData ?? undefined,
      groupPrice: candidate.groupPriceData,
      sourceType: candidate.sourceType,
      source: observation?.source,
      providerKey: (observation?.provider as ProviderKeyEnum | undefined) ?? undefined,
      sourceProductId: observation?.sourceProductId ?? undefined,
      collectedAt: candidate.collectedAt.toISOString(),
    };
  }

  private isCrossProvider(
    candidate: ProductCandidate,
    providerKey: ProviderKeyEnum,
  ): boolean {
    const providers = new Set((candidate.observations ?? []).map((obs) => obs.provider));
    return providers.size === 0 || !providers.has(providerKey);
  }

  private descriptorFromProduct(product: NormalizedProduct): SameProductDescriptor {
    return {
      platform: product.platform,
      provider: product.providerKey ?? 'unknown',
      title: product.title,
      shopName: product.shopName ?? null,
      productUrl: product.productUrl,
      platformProductId: product.platformProductId ?? null,
      imageUrls: product.imageUrls ?? [],
      skuOptions: (product.skuOptions ?? []).slice(0, 20).map((sku) => ({
        name: sku.name,
        price: sku.price,
      })),
      description: product.description ?? null,
    };
  }

  private descriptorFromCandidate(candidate: ProductCandidate): SameProductDescriptor {
    const observation = (candidate.observations ?? [])[0];
    return {
      platform: candidate.platform,
      provider: observation?.provider ?? 'unknown',
      title: candidate.title,
      shopName: candidate.shopName,
      productUrl: candidate.productUrl,
      platformProductId: candidate.platformProductId,
      imageUrls: candidate.imageUrls ?? [],
      skuOptions: (candidate.skuData ?? []).slice(0, 20).map((sku) => ({
        name: sku.name,
        price: sku.price,
      })),
      description: candidate.description,
    };
  }

  private sourceFromProviderType(
    providerType: SourceTypeEnum | null | undefined,
  ): ObservationSourceEnum {
    if (providerType === SourceTypeEnum.BROWSER) return ObservationSourceEnum.PLAYWRIGHT;
    if (providerType === SourceTypeEnum.THIRD_PARTY) {
      return ObservationSourceEnum.THIRD_PARTY_API;
    }
    return ObservationSourceEnum.OFFICIAL_API;
  }
}
