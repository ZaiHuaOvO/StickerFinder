import { Injectable } from '@nestjs/common';
import {
  ManualDecisionEnum,
  ObservationSourceEnum,
  PlatformEnum,
  PlatformTaskStatusEnum,
  ProviderKeyEnum,
  SearchRunStatusEnum,
  SourceTypeEnum,
} from '../common/enums';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductObservation,
  ProductPromotion,
  ProductRuleResult,
  SearchRun,
} from '../entities';
import { buildSearchRule, evaluateProductRule } from '../rules/rule.engine';
import { ProductSearchRule, RuleStatusEnum } from '../rules/rule.types';
import {
  SearchDetailDto,
  toSearchDetailDto,
} from '../search/dto/search-response.mapper';
import { FixtureDataset, FixtureDetailEntry, FixtureService } from './fixture.service';
import { ReplaySearchDto } from './dto/replay-search.dto';

const PLATFORM_ORDER: PlatformEnum[] = [
  PlatformEnum.TAOBAO,
  PlatformEnum.DOUYIN,
  PlatformEnum.XIAOHONGSHU,
  PlatformEnum.ALIBABA1688,
  PlatformEnum.PINDUODUO,
];

@Injectable()
export class ReplayService {
  constructor(private readonly fixtures: FixtureService) {}

  listFixtures() {
    return { items: this.fixtures.list(), externalRequests: 0 };
  }

  /**
   * 使用本地历史商品数据按“当前最新规则”重新评估并返回与在线搜索一致的 DTO。
   * 不写数据库、不调用 EveryInfra、不使用历史 AI 判断。
   */
  replay(dto: ReplaySearchDto): SearchDetailDto {
    const fixture = this.fixtures.get(dto.fixtureId);
    const targetName = dto.targetName?.trim() || fixture.targetName;
    const seriesName =
      dto.seriesName === undefined
        ? fixture.seriesName
        : dto.seriesName.trim() || null;
    const rule = buildSearchRule({
      name: targetName,
      seriesName,
      aliases: dto.aliases ?? [],
      seriesAliases: dto.seriesAliases ?? [],
    });

    const runId = `replay-${fixture.id}`;
    const collectedAt = new Date(fixture.collectedAt);
    const run = Object.assign(new SearchRun(), {
      id: runId,
      targetName,
      seriesName,
      aliases: dto.aliases ?? [],
      seriesAliases: dto.seriesAliases ?? [],
      brandNames: dto.brandNames ?? [],
      referenceImage: null,
      status: SearchRunStatusEnum.COMPLETED,
      errorMessage: null,
      startedAt: collectedAt,
      completedAt: collectedAt,
    });

    const tasks: PlatformSearchTask[] = [];
    const candidates: ProductCandidate[] = [];
    const selectedPlatforms = new Set<PlatformEnum>(
      dto.platforms?.length ? dto.platforms : PLATFORM_ORDER,
    );

    for (const platform of PLATFORM_ORDER) {
      if (!selectedPlatforms.has(platform)) continue;
      const platformKey = String(platform);
      const data = fixture.platforms[platformKey];
      if (!data) continue;

      const task = Object.assign(new PlatformSearchTask(), {
        id: `replay-task-${platformKey}`,
        searchRunId: runId,
        platform,
        provider: 'fixture',
        providerType: SourceTypeEnum.THIRD_PARTY,
        status: data.error
          ? PlatformTaskStatusEnum.FAILED
          : data.products.length > 0
            ? PlatformTaskStatusEnum.SUCCESS
            : PlatformTaskStatusEnum.EMPTY,
        resultCount: data.products.length,
        errorCode: data.error ? 'FIXTURE_PLATFORM_ERROR' : null,
        errorMessage: data.error ?? null,
        note: (data.warnings ?? []).join('\n') || null,
        apiRequestCount: 0,
        chargedUsd: 0,
        lastRequestId: null,
        manualVerification: null,
        startedAt: collectedAt,
        completedAt: collectedAt,
      });
      tasks.push(task);

      data.products.forEach((product, index) => {
        const detail = this.findDetail(data.details, product, index);
        const evaluation = evaluateProductRule({
          rule,
          searchProduct: {
            title: product.title,
            price: product.price,
            skuOptions: product.skuOptions,
            wholesalePrice: product.wholesalePrice,
          },
          detail: {
            attempted: Boolean(detail),
            product: detail?.product ?? null,
            error: detail?.error ?? null,
          },
        });
        if (!detail && evaluation.status === RuleStatusEnum.PENDING_DETAIL) {
          evaluation.reason =
            '本地测试数据未包含该商品详情（未调用外部接口）';
        }

        const candidateId = `${fixture.id}-${platformKey}-${index + 1}`;
        const ruleResult = Object.assign(new ProductRuleResult(), {
          id: `replay-rule-${candidateId}`,
          candidateId,
          status: evaluation.status,
          priceStatus: evaluation.priceStatus,
          titleMatched: evaluation.titleMatched,
          detailChecked: evaluation.detailChecked,
          matchedTargetKeywords: evaluation.matchedTargetKeywords,
          matchedSeriesKeywords: evaluation.matchedSeriesKeywords,
          matchedSkuIds: evaluation.matchedSkuIds,
          matchedContents: evaluation.matchedContents,
          matchType: evaluation.matchType,
          reason: evaluation.reason,
          detailError: evaluation.detailError,
          priceAmount: evaluation.price.amount,
          priceCurrency: evaluation.price.currency,
          priceSource: evaluation.price.source,
          priceSkuId: evaluation.price.skuId,
          priceNote: evaluation.price.note,
          manualDecision: ManualDecisionEnum.PENDING,
          manualNote: null,
          manualSkuDecisions: null,
          reviewedAt: null,
          evaluatedAt: collectedAt,
          createdAt: collectedAt,
          updatedAt: collectedAt,
        });

        const observations: ProductObservation[] = [
          this.toObservation(product, candidateId, runId, platform, 'replay-new'),
        ];
        if (detail?.product) {
          observations.push(
            this.toObservation(
              detail.product,
              candidateId,
              runId,
              platform,
              'detail_enrichment',
            ),
          );
        }

        const candidate = Object.assign(new ProductCandidate(), {
          id: candidateId,
          searchRunId: runId,
          platform,
          platformProductId: product.platformProductId ?? null,
          title: product.title,
          shopName: product.shopName ?? null,
          productUrl: product.productUrl,
          imageUrls: product.imageUrls ?? [],
          description: detail?.product?.description ?? product.description ?? null,
          skuData: this.mergeSkus(product, detail?.product ?? null),
          priceData: detail?.product?.price ?? product.price ?? null,
          groupPriceData: product.groupPrice ?? null,
          wholesalePriceData:
            detail?.product?.wholesalePrice ?? product.wholesalePrice ?? null,
          sourceType: product.sourceType,
          rawData: null,
          collectedAt,
          observations,
          ruleResult,
        });
        observations.forEach((observation) => {
          observation.candidate = candidate;
        });
        candidates.push(candidate);
      });
    }

    const detail = toSearchDetailDto(run, tasks, candidates, {});
    return {
      ...detail,
      searchId: runId,
      dataSource: 'fixture',
      replay: true,
    };
  }

  private findDetail(
    details: FixtureDetailEntry[],
    product: NormalizedProduct,
    index: number,
  ): FixtureDetailEntry | null {
    if (details.length === 0) return null;
    if (product.platformProductId) {
      const byId = details.find(
        (entry) => entry.sourceProductId === product.platformProductId,
      );
      if (byId) return byId;
    }
    return details[index] ?? null;
  }

  private mergeSkus(
    searchProduct: NormalizedProduct,
    detailProduct: NormalizedProduct | null,
  ) {
    const result = [...(searchProduct.skuOptions ?? [])];
    const seen = new Set(
      result.map((sku) => `${sku.skuId ?? ''}|${sku.name}`),
    );
    for (const sku of detailProduct?.skuOptions ?? []) {
      const key = `${sku.skuId ?? ''}|${sku.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(sku);
    }
    return result;
  }

  private toObservation(
    product: NormalizedProduct,
    candidateId: string,
    runId: string,
    platform: PlatformEnum,
    matchReason: string,
  ): ProductObservation {
    const observedAt = new Date(product.collectedAt);
    const observation = Object.assign(new ProductObservation(), {
      id: `replay-obs-${candidateId}-${matchReason}`,
      searchRunId: runId,
      candidateId,
      providerTaskId: `replay-task-${platform}`,
      platform,
      provider: product.providerKey ?? ProviderKeyEnum.PLAYWRIGHT,
      source: product.source ?? ObservationSourceEnum.THIRD_PARTY_API,
      sourceProductId:
        product.sourceProductId ?? product.platformProductId ?? null,
      title: product.title,
      shopName: product.shopName ?? null,
      productUrl: product.productUrl,
      imageUrls: product.imageUrls ?? [],
      description: product.description ?? null,
      skuData: product.skuOptions ?? [],
      priceData: product.price ?? null,
      originalPriceData: product.originalPrice ?? null,
      groupPriceData: product.groupPrice ?? null,
      couponPriceData: product.couponPrice ?? null,
      wholesalePriceData: product.wholesalePrice ?? null,
      salesText: product.salesText ?? null,
      rating: product.rating ?? null,
      region: product.region ?? null,
      regionNote: product.regionNote ?? null,
      matchReason,
      rawData: product.rawData ?? null,
      observedAt,
      collectedAt: observedAt,
      createdAt: observedAt,
      promotions: (product.promotions ?? []).map((promotion, index) =>
        Object.assign(new ProductPromotion(), {
          id: `replay-promo-${candidateId}-${matchReason}-${index + 1}`,
          observationId: `replay-obs-${candidateId}-${matchReason}`,
          skuId: promotion.skuId ?? null,
          platform,
          promotionType: promotion.promotionType,
          name: promotion.name,
          amount: promotion.amount ?? null,
          currency: promotion.currency ?? null,
          discountRate: promotion.discountRate ?? null,
          minimumSpend: promotion.minimumSpend ?? null,
          startTime: promotion.startTime ? new Date(promotion.startTime) : null,
          endTime: promotion.endTime ? new Date(promotion.endTime) : null,
          description: promotion.description ?? null,
          promotionUrl: promotion.promotionUrl ?? null,
          source: product.providerKey ?? null,
          rawData: promotion.rawData ?? null,
          observedAt,
          createdAt: observedAt,
        }),
      ),
    });
    return observation;
  }
}
