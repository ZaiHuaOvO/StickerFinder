import {
  ManualDecisionEnum,
  MatchStatusEnum,
  PlatformTaskStatusEnum,
} from '../../common/enums';
import { PriceInfo, SkuOption } from '../../common/interfaces/price.interface';
import type { SkuDecision } from '../../entities/product-match-result.entity';
import { PlatformSearchTask, ProductCandidate, SearchRun } from '../../entities';

export interface MatchDto {
  aiStatus: string;
  matchStatus: MatchStatusEnum;
  matchType: string | null;
  confidence: number | null;
  summary: string | null;
  reason: string | null;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: string[];
  needsManualReview: boolean;
  manualDecision: ManualDecisionEnum;
  manualNote: string | null;
  reviewedAt: Date | null;
  aiModel: string | null;
  aiError: string | null;
}

export interface ProductDto {
  id: string;
  platform: string;
  platformProductId: string | null;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrls: string[];
  description: string | null;
  skuOptions: SkuOption[];
  price: PriceInfo | null;
  groupPrice: PriceInfo | null;
  sourceType: string;
  collectedAt: Date;
  effectiveMatchStatus: MatchStatusEnum;
  match: MatchDto | null;
}

export interface PlatformResultDto {
  platform: string;
  status: PlatformTaskStatusEnum;
  providerType: string | null;
  resultCount: number;
  matchedCount: number;
  uncertainCount: number;
  excludedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  products: ProductDto[];
  uncertainProducts: ProductDto[];
}

export interface SearchDetailDto {
  searchId: string;
  status: string;
  targetName: string;
  seriesName: string | null;
  aliases: string[];
  referenceImageProvided: boolean;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  platforms: PlatformResultDto[];
}

export function effectiveMatchStatus(match: MatchDto | null): MatchStatusEnum {
  if (!match) return MatchStatusEnum.UNCERTAIN;
  if (match.manualDecision === ManualDecisionEnum.MATCH) return MatchStatusEnum.MATCH;
  if (match.manualDecision === ManualDecisionEnum.NO_MATCH) return MatchStatusEnum.NO_MATCH;
  return match.matchStatus;
}

export function toProductDto(candidate: ProductCandidate): ProductDto {
  const result = candidate.matchResult;
  const match: MatchDto | null = result
    ? {
        aiStatus: result.aiStatus,
        matchStatus: result.matchStatus,
        matchType: result.matchType,
        confidence: result.confidence,
        summary: result.summary,
        reason: result.reason,
        matchedContents: result.matchedContents ?? [],
        matchedSkuIds: result.matchedSkuIds ?? [],
        skuDecisions: result.skuDecisions ?? [],
        evidence: result.evidence ?? [],
        needsManualReview: result.needsManualReview,
        manualDecision: result.manualDecision,
        manualNote: result.manualNote,
        reviewedAt: result.reviewedAt,
        aiModel: result.aiModel,
        aiError: result.aiError,
      }
    : null;

  return {
    id: candidate.id,
    platform: candidate.platform,
    platformProductId: candidate.platformProductId,
    title: candidate.title,
    shopName: candidate.shopName,
    productUrl: candidate.productUrl,
    imageUrls: candidate.imageUrls ?? [],
    description: candidate.description,
    skuOptions: candidate.skuData ?? [],
    price: candidate.priceData,
    groupPrice: candidate.groupPriceData,
    sourceType: candidate.sourceType,
    collectedAt: candidate.collectedAt,
    effectiveMatchStatus: effectiveMatchStatus(match),
    match,
  };
}

export function toPlatformResultDto(
  task: PlatformSearchTask,
  candidates: ProductCandidate[],
): PlatformResultDto {
  const products = candidates
    .map(toProductDto)
    .sort((a, b) => {
      const ca = a.match?.confidence ?? -1;
      const cb = b.match?.confidence ?? -1;
      return cb - ca;
    });

  const matched = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.MATCH,
  );
  const uncertain = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.UNCERTAIN,
  );
  const excluded = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.NO_MATCH,
  );

  return {
    platform: task.platform,
    status: task.status,
    providerType: task.providerType,
    resultCount: task.resultCount,
    matchedCount: matched.length,
    uncertainCount: uncertain.length,
    excludedCount: excluded.length,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    note: task.note,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    products: matched,
    uncertainProducts: uncertain,
  };
}

export function toSearchDetailDto(
  run: SearchRun,
  tasks: PlatformSearchTask[],
  candidates: ProductCandidate[],
): SearchDetailDto {
  const byPlatform = new Map<string, ProductCandidate[]>();
  for (const candidate of candidates) {
    const list = byPlatform.get(candidate.platform) ?? [];
    list.push(candidate);
    byPlatform.set(candidate.platform, list);
  }

  return {
    searchId: run.id,
    status: run.status,
    targetName: run.targetName,
    seriesName: run.seriesName,
    aliases: run.aliases ?? [],
    referenceImageProvided: Boolean(run.referenceImage),
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    platforms: tasks.map((task) =>
      toPlatformResultDto(task, byPlatform.get(task.platform) ?? []),
    ),
  };
}
