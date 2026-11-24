import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import { SkuOption } from '../common/interfaces/price.interface';
import { mergeWholesale } from '../common/utils/wholesale.util';
import { strongProductMatch, StrongMatchReason } from '../common/utils/product-dedupe.util';
import { sanitizeRawData } from '../common/utils/sanitize.util';
import { dedupePromotions } from '../common/utils/promotion.util';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductObservation,
  ProductPromotion,
  ProductRuleResult,
} from '../entities';
import { evaluateProductRule } from '../rules/rule.engine';
import {
  ProductSearchRule,
  RuleEvaluation,
  RulePriceStatusEnum,
  RuleStatusEnum,
} from '../rules/rule.types';

export interface IngestResult {
  candidate: ProductCandidate;
  matchReason: string;
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

function withSourceKeyword(
  product: NormalizedProduct,
): Record<string, unknown> | null {
  const raw = { ...(product.rawData ?? {}) };
  if (product.sourceKeyword) raw['source_keyword'] = product.sourceKeyword;
  if (Object.keys(raw).length === 0) return null;
  return sanitizeRawData(raw) as Record<string, unknown>;
}

function applyEvaluation(
  row: ProductRuleResult,
  evaluation: RuleEvaluation,
): void {
  row.status = evaluation.status;
  row.priceStatus = evaluation.priceStatus;
  row.titleMatched = evaluation.titleMatched;
  row.detailChecked = evaluation.detailChecked;
  row.matchedTargetKeywords = evaluation.matchedTargetKeywords;
  row.matchedSeriesKeywords = evaluation.matchedSeriesKeywords;
  row.matchedSkuIds = evaluation.matchedSkuIds;
  row.matchedContents = evaluation.matchedContents;
  row.matchType = evaluation.matchType;
  row.reason = evaluation.reason;
  row.detailError = evaluation.detailError;
  row.priceAmount = evaluation.price.amount;
  row.priceCurrency = evaluation.price.currency;
  row.priceSource = evaluation.price.source;
  row.priceSkuId = evaluation.price.skuId;
  row.priceNote = evaluation.price.note;
  row.evaluatedAt = new Date();
}

@Injectable()
export class CandidateAggregationService {
  private readonly logger = new Logger(CandidateAggregationService.name);

  constructor(
    @InjectRepository(ProductCandidate)
    private readonly candidateRepo: Repository<ProductCandidate>,
    @InjectRepository(ProductObservation)
    private readonly observationRepo: Repository<ProductObservation>,
    @InjectRepository(ProductPromotion)
    private readonly promotionRepo: Repository<ProductPromotion>,
    @InjectRepository(ProductRuleResult)
    private readonly ruleRepo: Repository<ProductRuleResult>,
  ) {}

  async loadCandidates(
    searchRunId: string,
    platform: PlatformEnum,
  ): Promise<ProductCandidate[]> {
    const candidates = await this.candidateRepo.find({
      where: { searchRunId, platform },
      relations: {
        observations: { promotions: true },
        ruleResult: true,
      },
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
    rule: ProductSearchRule,
  ): Promise<IngestResult> {
    const providerKey = product.providerKey ?? ProviderKeyEnum.PLAYWRIGHT;
    let matched: ProductCandidate | undefined;
    let matchReason: StrongMatchReason = null;

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
      candidate.ruleResult = await this.updateTitleRule(candidate, product, rule);
      return { candidate, matchReason: 'new' };
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
    matched.ruleResult = await this.updateTitleRule(matched, product, rule);
    return { candidate: matched, matchReason: matchReason ?? 'new' };
  }

  /**
   * 第一阶段规则：标题必须同时命中目标与系列。
   * 已通过详情确认的记录不会被后续渠道的标题结果降级。
   */
  private async updateTitleRule(
    candidate: ProductCandidate,
    product: NormalizedProduct,
    rule: ProductSearchRule,
  ): Promise<ProductRuleResult> {
    let row = await this.ruleRepo.findOne({
      where: { candidateId: candidate.id },
    });
    if (!row) {
      row = this.ruleRepo.create({
        candidateId: candidate.id,
        evaluatedAt: new Date(),
      });
    }
    if (row.detailChecked) return row;

    const evaluation = evaluateProductRule({
      rule,
      searchProduct: {
        title: product.title,
        price: product.price,
        skuOptions: product.skuOptions,
        wholesalePrice: product.wholesalePrice,
      },
      detail: { attempted: false, product: null },
    });

    // 已经标题命中时不因另一个渠道的标题差异而回退。
    if (row.titleMatched && !evaluation.titleMatched) return row;
    applyEvaluation(row, evaluation);
    return this.ruleRepo.save(row);
  }

  /** 详情返回后执行第二阶段确认与价格有效性检查。 */
  async recordDetail(
    searchRunId: string,
    task: PlatformSearchTask,
    candidate: ProductCandidate,
    product: NormalizedProduct,
    rule: ProductSearchRule,
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
    candidate.ruleResult = await this.evaluateDetail(
      candidate,
      product,
      rule,
      null,
    );
    return observation;
  }

  async markDetailFailed(
    candidate: ProductCandidate,
    message: string,
  ): Promise<void> {
    let row = await this.ruleRepo.findOne({
      where: { candidateId: candidate.id },
    });
    if (!row) {
      row = this.ruleRepo.create({
        candidateId: candidate.id,
        evaluatedAt: new Date(),
      });
    }
    row.status = RuleStatusEnum.PENDING_DETAIL;
    row.priceStatus = RulePriceStatusEnum.MISSING;
    row.detailChecked = false;
    row.detailError = message;
    row.reason = `详情获取失败，保留候选：${message}`;
    row.evaluatedAt = new Date();
    candidate.ruleResult = await this.ruleRepo.save(row);
  }

  /** 供 DTO/回归测试复用的纯规则评估。 */
  evaluateCandidate(
    candidate: ProductCandidate,
    detail: NormalizedProduct | null,
    rule: ProductSearchRule,
    detailError: string | null = null,
  ): RuleEvaluation {
    return evaluateProductRule({
      rule,
      searchProduct: {
        title: candidate.title,
        price: candidate.priceData,
        skuOptions: candidate.skuData,
        wholesalePrice: candidate.wholesalePriceData,
      },
      detail: {
        attempted: true,
        product: detail,
        error: detailError,
      },
    });
  }

  private async evaluateDetail(
    candidate: ProductCandidate,
    detail: NormalizedProduct | null,
    rule: ProductSearchRule,
    error: string | null,
  ): Promise<ProductRuleResult> {
    let row = await this.ruleRepo.findOne({
      where: { candidateId: candidate.id },
    });
    if (!row) {
      row = this.ruleRepo.create({
        candidateId: candidate.id,
        evaluatedAt: new Date(),
      });
    }
    const evaluation = evaluateProductRule({
      rule,
      searchProduct: {
        title: candidate.title,
        price: candidate.priceData,
        skuOptions: candidate.skuData,
        wholesalePrice: candidate.wholesalePriceData,
      },
      detail: {
        attempted: true,
        product: detail,
        error,
      },
    });
    applyEvaluation(row, evaluation);
    return this.ruleRepo.save(row);
  }

  /** 历史搜索没有规则结果时，按当前规则重新评估（只读回放使用）。 */
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
   * 不同采集时间由不同观察记录各自保留。
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
