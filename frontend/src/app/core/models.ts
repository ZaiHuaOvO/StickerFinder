export type Platform = 'taobao' | 'douyin' | 'xiaohongshu' | 'pinduoduo';

export const PLATFORM_ORDER: Platform[] = ['taobao', 'douyin', 'xiaohongshu', 'pinduoduo'];

export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'EMPTY'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'BLOCKED';

export type PlatformStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'EMPTY'
  | 'FAILED'
  | 'NOT_CONFIGURED';

export type SearchRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';

export type MatchStatus = 'MATCH' | 'NO_MATCH' | 'UNCERTAIN';

export type MatchType =
  | 'EXACT_SINGLE'
  | 'TARGET_VARIANT'
  | 'CONTAINS_TARGET_BUNDLE'
  | 'CONTAINS_TARGET_FULL_SET'
  | 'NOT_MATCH'
  | 'UNCERTAIN';

export type PriceType =
  | 'TARGET_SKU'
  | 'BUNDLE'
  | 'FULL_SET'
  | 'LOWEST_SKU'
  | 'LISTING'
  | 'UNKNOWN';

export type AiStatus = 'OK' | 'FAILED' | 'SKIPPED';
export type ManualDecision = 'PENDING' | 'MATCH' | 'NO_MATCH';
export type SourceType = 'official_api' | 'browser' | 'third_party';
export type ObservationSource = 'official_api' | 'third_party_api' | 'playwright';

export interface PriceInfo {
  amount: number | null;
  currency: string;
  displayText: string;
  priceType: PriceType;
  priceSource: string;
  observedAt: string;
  shippingIncluded: string;
  originalAmount?: number | null;
  originalDisplayText?: string | null;
  note?: string;
  groupPrice?: PriceInfo | null;
}

export interface SkuOption {
  skuId?: string;
  name: string;
  price?: number;
  imageUrl?: string;
}

export interface SkuDecision {
  skuId: string;
  matchStatus: 'MATCH' | 'NO_MATCH' | 'UNCERTAIN';
  reason: string;
}

export interface ProductMatch {
  aiStatus: AiStatus;
  matchStatus: MatchStatus;
  matchType: MatchType | null;
  confidence: number | null;
  summary: string | null;
  reason: string | null;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: string[];
  needsManualReview: boolean;
  manualDecision: ManualDecision;
  manualNote: string | null;
  reviewedAt: string | null;
  aiModel: string | null;
  aiError: string | null;
}

export interface ProductObservation {
  id: string;
  provider: string;
  providerLabel: string;
  source: ObservationSource;
  sourceLabel: string;
  sourceProductId: string | null;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrls: string[];
  price: PriceInfo | null;
  originalPrice: PriceInfo | null;
  groupPrice: PriceInfo | null;
  salesText: string | null;
  rating: number | null;
  region: string | null;
  regionNote: string | null;
  matchReason: string | null;
  observedAt: string;
  collectedAt: string;
  rawData: Record<string, unknown> | null;
}

export interface Product {
  id: string;
  platform: Platform;
  platformProductId: string | null;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrls: string[];
  description: string | null;
  skuOptions: SkuOption[];
  price: PriceInfo | null;
  groupPrice: PriceInfo | null;
  sourceType: SourceType;
  collectedAt: string;
  effectiveMatchStatus: MatchStatus;
  match: ProductMatch | null;
  observations: ProductObservation[];
  priceConflict: boolean;
}

export interface ChannelResult {
  taskId: string;
  provider: string;
  providerLabel: string;
  source: ObservationSource;
  sourceLabel: string;
  providerType: SourceType | null;
  status: TaskStatus;
  resultCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface PlatformResult {
  platform: Platform;
  status: PlatformStatus;
  providerType: SourceType | null;
  resultCount: number;
  matchedCount: number;
  uncertainCount: number;
  excludedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  startedAt: string | null;
  completedAt: string | null;
  channels: ChannelResult[];
  products: Product[];
  uncertainProducts: Product[];
}

export interface SearchDetail {
  searchId: string;
  status: SearchRunStatus;
  targetName: string;
  seriesName: string | null;
  aliases: string[];
  referenceImageProvided: boolean;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  platforms: PlatformResult[];
}

export interface ProviderChannelStatusInfo {
  key: string;
  label: string;
  configured: boolean;
  providerType: SourceType;
  source: ObservationSource;
  reason?: string;
}

export interface ProviderStatusInfo {
  platform: Platform;
  configured: boolean;
  provider: SourceType | null;
  reason?: string;
  channels?: ProviderChannelStatusInfo[];
}

export interface AiStatusInfo {
  configured: boolean;
  model: string;
  visionEnabled: boolean;
  reason: string;
}

export interface ProvidersStatusResponse {
  ai: AiStatusInfo;
  platforms: Record<Platform, ProviderStatusInfo>;
}

export interface CreateSearchPayload {
  targetName: string;
  seriesName?: string;
  aliases?: string[];
  referenceImageId?: string | null;
}

export interface UploadedImage {
  referenceImageId: string;
  url: string;
}

export interface ReviewPayload {
  decision: 'MATCH' | 'NO_MATCH' | 'PENDING';
  note?: string;
}

export interface SearchFormPayload {
  targetName: string;
  seriesName?: string;
  aliases: string[];
  referenceImageId: string | null;
}

export interface SearchRunSummary {
  searchId: string;
  targetName: string;
  seriesName: string | null;
  status: SearchRunStatus;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}
