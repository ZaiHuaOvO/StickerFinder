import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ClassificationOutcome,
  ProductClassifierService,
  TargetDescriptor,
} from '../ai/product-classifier.service';
import { SameProductDescriptor, SameProductService } from '../ai/same-product.service';
import {
  AiStatusEnum,
  ManualDecisionEnum,
  ObservationSourceEnum,
  PlatformEnum,
  PriceVerificationStatusEnum,
  ProviderKeyEnum,
  SkuVerificationStatusEnum,
  SourceTypeEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SkuOption } from '../common/interfaces/price.interface';
import { mergeWholesale } from '../common/utils/wholesale.util';
import {
  isAmbiguousSameProduct,
  strongProductMatch,
  StrongMatchReason,
  titleSimilarity,
  imageOverlap,
} from '../common/utils/product-dedupe.util';
import { normalizeTargetText } from '../common/utils/text.util';
import { sanitizeRawData } from '../common/utils/sanitize.util';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  ProductObservation,
  ProductPromotion,
  SearchRun,
} from '../entities';
import { dedupePromotions } from '../common/utils/promotion.util';

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

function mergeSkuOptions(existing: SkuOption[], incoming: SkuOption[]): SkuOption[] {  const result = [...existing];
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

/**
 * 详情补充：写入一条独立的详情观察记录，只填补候选缺失字段，
 * 不覆盖搜索结果价格，也不因详情失败影响原结果。
 */

function withSourceKeyword(
  product: NormalizedProduct,
): Record<string, unknown> | null {
  const raw = { ...(product.rawData ?? {}) };
  if (product.sourceKeyword) raw['source_keyword'] = product.sourceKeyword;
  if (Object.keys(raw).length === 0) return null;
  return sanitizeRawData(raw) as Record<string, unknown>;
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
    @InjectRepository(ProductPromotion)
    private readonly promotionRepo: Repository<ProductPromotion>,
    @InjectRepository(ProductMatchResult)
    private readonly matchRepo: Repository<ProductMatchResult>,
  ) {}

  async loadCandidates(
    searchRunId: string,
    platform: PlatformEnum,
  ): Promise<ProductCandidate[]> {
    const candidates = await this.candidateRepo.find({
      where: { searchRunId, platform },
      relations: { observations: { promotions: true }, matchResult: true },
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
    concurrency = 1,
    shouldStop?: () => boolean,
  ): Promise<{ classified: number; failed: number }> {
    const candidates = (
      await this.loadCandidates(searchRunId, platform)
    ).filter((candidate) => !candidate.matchResult);
    let classified = 0;
    let failed = 0;
    let cursor = 0;
    const referenceCases = await this.loadReferenceCases(
      searchRunId,
      target,
      platform,
    );
    const workerCount = Math.min(
      Math.max(1, concurrency),
      Math.max(1, candidates.length),
    );

    const worker = async (): Promise<void> => {
      while (true) {
        if (shouldStop?.()) break;
        const index = cursor;
        cursor += 1;
        if (index >= candidates.length) break;
        const candidate = candidates[index];
        try {
          const representative = this.representativeProduct(candidate);
          const outcome = await this.classifier.classify(
            target,
            representative,
            candidate.id,
            { referenceCases },
          );
          const match = this.matchRepo.create({ candidateId: candidate.id });
          this.applyOutcomeToMatch(match, outcome);
          await this.applyHistoricalManualDecision(candidate, match);
          await this.matchRepo.save(match);
          candidate.matchResult = match;
          classified += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `候选商品识别保存失败 candidate=${candidate.id}：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { classified, failed };
  }

  /**
   * 详情补充后重新识别：用包含详情 SKU/描述的候选再次调用 AI，
   * 并更新已有 matchResult，不新建重复记录。
   */
  async reclassifyCandidate(
    candidate: ProductCandidate,
    target: TargetDescriptor,
  ): Promise<ClassificationOutcome> {
    const representative = this.representativeProduct(candidate);
    const outcome = await this.classifier.classify(
      target,
      representative,
      candidate.id,
      { detailEnriched: true },
    );

    let match = candidate.matchResult;
    if (!match) {
      match = this.matchRepo.create({ candidateId: candidate.id });
      candidate.matchResult = match;
    }

    if (outcome.aiStatus !== AiStatusEnum.OK) {
      // 二次识别失败时保留第一次的有效结论，只记录警告和核验失败。
      match.safetyWarnings = [
        ...(match.safetyWarnings ?? []),
        `详情补充后的 SKU 识别失败：${outcome.error ?? '未知错误'}`,
      ];
      match.skuVerificationStatus = SkuVerificationStatusEnum.FAILED;
      await this.matchRepo.save(match);
      return outcome;
    }

    this.applyOutcomeToMatch(match, outcome);
    await this.applyHistoricalManualDecision(candidate, match);
    await this.matchRepo.save(match);
    return outcome;
  }

  /**
   * 完全相同商品（平台 ID、标题、SKU 与主图未变化）可以复用历史人工判断；
   * 店铺不同或内容变化时不自动继承。
   */
  private async applyHistoricalManualDecision(
    candidate: ProductCandidate,
    match: ProductMatchResult,
  ): Promise<void> {
    if (match.manualDecision !== ManualDecisionEnum.PENDING) return;
    if (!candidate.platformProductId) return;

    const previousCandidates = await this.candidateRepo.find({
      where: {
        platform: candidate.platform,
        platformProductId: candidate.platformProductId,
      },
      relations: { matchResult: true },
      order: { collectedAt: 'DESC' },
      take: 10,
    });
    const currentSkus = JSON.stringify(candidate.skuData ?? []);
    const currentImages = JSON.stringify(candidate.imageUrls ?? []);
    const reusable = previousCandidates.find((item) => {
      if (item.id === candidate.id) return false;
      if (!item.matchResult) return false;
      if (item.matchResult.manualDecision === ManualDecisionEnum.PENDING) return false;
      if (normalizeTargetText(item.title) !== normalizeTargetText(candidate.title)) {
        return false;
      }
      if (JSON.stringify(item.skuData ?? []) !== currentSkus) return false;
      if (JSON.stringify(item.imageUrls ?? []) !== currentImages) return false;
      return true;
    });
    if (!reusable?.matchResult) return;

    match.manualDecision = reusable.matchResult.manualDecision;
    match.manualNote =
      [reusable.matchResult.manualNote, '复用历史人工确认']
        .filter(Boolean)
        .join('；') || null;
    match.manualSkuDecisions = reusable.matchResult.manualSkuDecisions ?? null;
    match.reviewedAt = new Date();
  }

  /** 取同一目标/系列的历史人工确认，作为 AI 的辅助参考（最多 2 条）。 */
  private async loadReferenceCases(
    searchRunId: string,
    target: TargetDescriptor,
    platform: PlatformEnum,
  ): Promise<
    Array<{
      title: string;
      platform: string;
      manualDecision: string;
      note?: string | null;
    }>
  > {
    const runRepo = this.candidateRepo.manager.getRepository(SearchRun);
    const runs = await runRepo.find({
      order: { startedAt: 'DESC' },
      take: 50,
    });
    const targetName = normalizeTargetText(target.name);
    const targetSeries = normalizeTargetText(target.seriesName ?? '');
    const runIds = runs
      .filter(
        (run) =>
          run.id !== searchRunId &&
          normalizeTargetText(run.targetName) === targetName &&
          normalizeTargetText(run.seriesName ?? '') === targetSeries,
      )
      .map((run) => run.id);
    if (runIds.length === 0) return [];

    const candidates = await this.candidateRepo.find({
      where: { platform, searchRunId: In(runIds) },
      relations: { matchResult: true },
      order: { collectedAt: 'DESC' },
      take: 10,
    });
    return candidates
      .filter(
        (candidate) =>
          candidate.matchResult &&
          candidate.matchResult.manualDecision !== ManualDecisionEnum.PENDING,
      )
      .slice(0, 2)
      .map((candidate) => ({
        title: candidate.title,
        platform: candidate.platform,
        manualDecision: candidate.matchResult!.manualDecision,
        note: candidate.matchResult!.manualNote,
      }));
  }

  /** 详情失败或未返回 SKU 时更新核验状态，不覆盖已有匹配结论。 */
  async updateVerificationStatus(
    candidate: ProductCandidate,
    skuStatus: SkuVerificationStatusEnum,
    priceStatus: PriceVerificationStatusEnum,
    warning?: string,
  ): Promise<void> {
    const match = candidate.matchResult;
    if (!match) return;
    match.skuVerificationStatus = skuStatus;
    match.priceVerificationStatus = priceStatus;
    if (warning) {
      match.safetyWarnings = [...(match.safetyWarnings ?? []), warning];
    }
    await this.matchRepo.save(match);
  }

  private applyOutcomeToMatch(
    match: ProductMatchResult,
    outcome: ClassificationOutcome,
  ): void {    match.matchStatus = outcome.matchStatus;
    match.matchType = outcome.matchType;
    match.candidateRelevance = outcome.candidateRelevance;
    match.categoryMatch = outcome.categoryMatch;
    match.seriesMatch = outcome.seriesMatch;
    match.targetItemMatch = outcome.targetItemMatch;
    match.visualMatch = outcome.visualMatch;
    match.confidence = outcome.confidence;
    match.summary = outcome.summary;
    match.reason = outcome.reason;
    match.matchedContents = outcome.matchedContents;
    match.matchedSkuIds = outcome.matchedSkuIds;
    match.skuDecisions = outcome.skuDecisions;
    match.evidence = outcome.evidence;
    match.nextAction = outcome.nextAction;
    match.rawMatchStatus = outcome.rawMatchStatus;
    match.rawConfidence = outcome.rawConfidence;
    match.safetyWarnings = outcome.safetyWarnings;
    match.safetyBlockers = outcome.safetyBlockers;
    match.skuVerificationStatus = outcome.skuVerificationStatus;
    match.priceVerificationStatus = outcome.priceVerificationStatus;
    match.aiStatus = outcome.aiStatus;
    match.aiModel = outcome.model;
    match.aiRawResponse = outcome.rawResponse;
    match.aiError = outcome.error;
    match.needsManualReview = outcome.needsManualReview;
    match.classifiedAt = new Date();
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
      wholesalePriceData: product.wholesalePrice ?? null,
      sourceType: product.sourceType,
      rawData: withSourceKeyword(product),
      collectedAt: toDate(product.collectedAt),
      observations: [],
    });
    return this.candidateRepo.save(candidate);
  }

  private async mergeCandidate(
    candidate: ProductCandidate,
    product: NormalizedProduct,
    preferWholesale = false,
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
    if (product.wholesalePrice) {
      candidate.wholesalePriceData = preferWholesale
        ? product.wholesalePrice
        : candidate.wholesalePriceData
          ? mergeWholesale(candidate.wholesalePriceData, product.wholesalePrice)
          : product.wholesalePrice;
    }
    const rawData = withSourceKeyword(product);
    if (!candidate.rawData && rawData) {
      candidate.rawData = rawData;
    }    candidate.imageUrls = [
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
      couponPriceData: product.couponPrice ?? null,
      wholesalePriceData: product.wholesalePrice ?? null,
      salesText: product.salesText?.slice(0, 100) ?? null,
      rating: typeof product.rating === 'number' ? product.rating : null,
      region: product.region?.slice(0, 50) ?? null,
      regionNote: product.regionNote ?? null,
      matchReason,
      rawData: withSourceKeyword(product),
      observedAt,
      collectedAt: new Date(),
    });
    const saved = await this.observationRepo.save(observation);
    try {
      saved.promotions = await this.savePromotions(saved, product);
    } catch (error) {
      // 优惠是补充数据：保存失败不能让已采集的商品快照丢失，但必须留下明确错误记录。
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `优惠信息保存失败 observation=${saved.id}：${message}`,
      );
      task.note = task.note
        ? `${task.note}\n优惠信息保存失败：${message}`
        : `优惠信息保存失败：${message}`;
      saved.promotions = [];
    }
    return saved;
  }

  /**
   * 优惠信息跟随观察记录保存；同一次采集内的重复条目去重，
   * 不同采集时间由不同观察记录各自保留。保存失败会向上抛出，不能静默丢数据。
   */
  private async savePromotions(
    observation: ProductObservation,
    product: NormalizedProduct,
  ): Promise<ProductPromotion[]> {
    const promotions = dedupePromotions(product.promotions ?? []);
    if (promotions.length === 0) return [];
    const observedAt = toDate(product.collectedAt);
    const rows = promotions.map((promotion) =>
      this.promotionRepo.create({
        observationId: observation.id,
        skuId: promotion.skuId ? promotion.skuId.slice(0, 200) : null,
        platform: product.platform,
        promotionType: promotion.promotionType,
        name: promotion.name.slice(0, 255),
        amount: promotion.amount ?? null,
        currency: promotion.currency ?? null,
        discountRate: promotion.discountRate ?? null,
        minimumSpend: promotion.minimumSpend ?? null,
        startTime: promotion.startTime ? toDate(promotion.startTime) : null,
        endTime: promotion.endTime ? toDate(promotion.endTime) : null,
        description: promotion.description ?? null,
        promotionUrl: promotion.promotionUrl ?? null,
        source: product.providerKey ?? null,
        rawData: promotion.rawData
          ? (sanitizeRawData(promotion.rawData) as Record<string, unknown>)
          : null,
        observedAt,
      }),
    );
    return this.promotionRepo.save(rows);
  }

  /**
   * 详情补充：写入一条独立的详情观察记录，只填补候选缺失字段，
   * 不覆盖搜索结果价格，也不因详情失败影响原结果。
   */
  async recordDetail(
    searchRunId: string,
    task: PlatformSearchTask,
    candidate: ProductCandidate,
    product: NormalizedProduct,
  ): Promise<ProductObservation> {
    await this.mergeCandidate(candidate, product, true);
    const observation = await this.createObservation(
      searchRunId,
      task,
      candidate,
      product,
      'detail_enrichment',
    );
    candidate.observations = [...(candidate.observations ?? []), observation];
    return observation;
  }

  representative(candidate: ProductCandidate): NormalizedProduct {
    return this.representativeProduct(candidate);
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
      wholesalePrice: candidate.wholesalePriceData,
      sourceType: candidate.sourceType,
      source: observation?.source,
      providerKey: (observation?.provider as ProviderKeyEnum | undefined) ?? undefined,
      sourceProductId: observation?.sourceProductId ?? undefined,
      sourceKeyword:
        typeof candidate.rawData?.['source_keyword'] === 'string'
          ? (candidate.rawData['source_keyword'] as string)
          : undefined,
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
