export type Platform =
  | 'taobao'
  | 'douyin'
  | 'xiaohongshu'
  | 'alibaba1688'
  | 'pinduoduo';

export const PLATFORM_ORDER: Platform[] = [
  'taobao',
  'douyin',
  'xiaohongshu',
  'alibaba1688',
  'pinduoduo',
];

export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'EMPTY'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'WAITING_MANUAL_VERIFICATION';

export type PlatformStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'EMPTY'
  | 'FAILED'
  | 'NOT_CONFIGURED'
  | 'CANCELLED'
  | 'WAITING_MANUAL_VERIFICATION';

export type SearchRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'INTERRUPTED'
  | 'CANCELLED'
  | 'WAITING_MANUAL_VERIFICATION';

export type MatchStatus = 'MATCH' | 'NO_MATCH' | 'UNCERTAIN';

export type CandidateRelevance = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type MatchAssessment = 'MATCH' | 'CONFLICT' | 'UNKNOWN';

export type VisualMatch =
  | 'VISUAL_EXACT'
  | 'VISUAL_SIMILAR'
  | 'VISUAL_ABSENT'
  | 'VISUAL_UNAVAILABLE';

export type NextAction =
  | 'NONE'
  | 'FETCH_PRODUCT_DETAIL'
  | 'FETCH_SKU'
  | 'FETCH_IMAGES'
  | 'MANUAL_REVIEW';

export type SkuVerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'PARTIAL'
  | 'NOT_AVAILABLE'
  | 'FAILED';

export type PriceVerificationStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'PARTIAL'
  | 'UNVERIFIED'
  | 'FAILED';

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
  | 'COUPON_PRICE'
  | 'UNKNOWN';

export type PromotionType =
  | 'COUPON'
  | 'SHOP_ACTIVITY'
  | 'PLATFORM_ACTIVITY'
  | 'DISCOUNT'
  | 'OTHER';

export interface Promotion {
  id: string;
  skuId: string | null;
  promotionType: PromotionType;
  promotionTypeLabel: string;
  name: string;
  amount: number | null;
  currency: string | null;
  discountRate: number | null;
  minimumSpend: number | null;
  startTime: string | null;
  endTime: string | null;
  description: string | null;
  promotionUrl: string | null;
  expired: boolean;
  source: string | null;
  observedAt: string;
}

export type PriceComparisonGroup =
  | 'TARGET_SINGLE'
  | 'TARGET_BUNDLE'
  | 'TARGET_FULL_SET'
  | 'WHOLESALE';

export interface PriceSummaryItem {
  candidateId: string;
  platform: Platform;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrl: string | null;
  skuId: string | null;
  skuName: string;
  amount: number;
  currency: string;
  comparisonGroup: PriceComparisonGroup;
  priceType: string;
  observedAt: string;
}

export interface PriceGroupSummary {
  group: PriceComparisonGroup;
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  verifiedCount: number;
}

export interface PlatformPriceSummary {
  platform: Platform;
  groups: PriceGroupSummary[];
  wholesale: {
    priceMin: number | null;
    priceMax: number | null;
    currency: string | null;
    unit: string | null;
    minOrderQuantity: number | null;
  } | null;
}

export interface PriceSummary {
  bestPrice: PriceSummaryItem | null;
  bestComparisonGroup: PriceComparisonGroup | null;
  bestByGroup: PriceSummaryItem[];
  groups: PriceGroupSummary[];
  platforms: PlatformPriceSummary[];
  items: PriceSummaryItem[];
  potentialCheaperCandidateIds: string[];
  otherUncertainCount: number;
  unverifiedMatchCount: number;
  totalConfirmed: number;
}

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
  /** 接口明确返回的该 SKU 券后价 */
  couponPrice?: number;
  couponText?: string;
}

export interface PriceTier {
  minQuantity: number;
  price: number;
}

/** 1688 批发采购价，独立于零售 PriceInfo */
export interface WholesalePriceInfo {
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  unit: string | null;
  minOrderQuantity: number | null;
  priceTiers: PriceTier[];
  note?: string | null;
}

export interface SkuDecision {
  skuId: string;
  matchStatus: 'MATCH' | 'NO_MATCH' | 'UNCERTAIN';
  reason: string;
}

export interface SkuManualDecision {
  skuId: string;
  decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED';
  note?: string | null;
  reviewedAt: string;
}

export interface EvidenceEntry {
  sourceField: 'title' | 'description' | 'sku' | 'image';
  content: string;
  interpretation: string;
}

export interface ProductMatch {
  aiStatus: AiStatus;
  matchStatus: MatchStatus;
  matchType: MatchType | null;
  candidateRelevance: CandidateRelevance | null;
  categoryMatch: MatchAssessment | null;
  seriesMatch: MatchAssessment | null;
  targetItemMatch: MatchAssessment | null;
  visualMatch: VisualMatch | null;
  confidence: number | null;
  summary: string | null;
  reason: string | null;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: EvidenceEntry[];
  nextAction: NextAction | null;
  rawMatchStatus: MatchStatus | null;
  rawConfidence: number | null;
  safetyWarnings: string[];
  safetyBlockers: string[];
  skuVerificationStatus: SkuVerificationStatus;
  priceVerificationStatus: PriceVerificationStatus;
  needsManualReview: boolean;
  manualDecision: ManualDecision;
  manualNote: string | null;
  manualSkuDecisions: SkuManualDecision[];
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
  /** 接口明确返回的券后价 */
  couponPrice: PriceInfo | null;
  wholesalePrice: WholesalePriceInfo | null;
  promotions: Promotion[];
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
  wholesalePrice: WholesalePriceInfo | null;
  promotions: Promotion[];
  sourceType: SourceType;
  collectedAt: string;
  effectiveMatchStatus: MatchStatus;
  match: ProductMatch | null;
  observations: ProductObservation[];
  priceConflict: boolean;
}

export interface ManualVerificationProgress {
  completedTasks: number;
  totalTasks: number;
  completedPlatforms: string[];
  remainingPlatforms: string[];
}

export interface ManualVerificationState {
  keyword: string;
  targetUrl: string;
  profileDir: string;
  attempts: number;
  maxAttempts: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  requestedAt: string;
  openedAt: string | null;
  resumedAt: string | null;
  progress: ManualVerificationProgress;
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
  apiRequestCount: number;
  chargedUsd: number | null;
  lastRequestId: string | null;
  manualVerification: ManualVerificationState | null;
  manualBrowserOpen: boolean;
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
  excludedProducts: Product[];
}

export interface SearchDetail {
  searchId: string;
  status: SearchRunStatus;
  targetName: string;
  seriesName: string | null;
  aliases: string[];
  seriesAliases: string[];
  brandNames: string[];
  referenceImageProvided: boolean;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  platforms: PlatformResult[];
  priceSummary: PriceSummary | null;
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
  seriesAliases?: string[];
  brandNames?: string[];
  referenceImageId?: string | null;
  platforms?: Platform[];
}

export interface UploadedImage {
  referenceImageId: string;
  url: string;
}

export interface ReviewPayload {
  decision?: 'MATCH' | 'NO_MATCH' | 'PENDING';
  note?: string;
  skuDecisions?: Array<{
    skuId: string;
    decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED' | 'PENDING';
    note?: string;
  }>;
}

export interface SearchFormPayload {
  targetName: string;
  seriesName?: string;
  aliases: string[];
  seriesAliases: string[];
  brandNames: string[];
  referenceImageId: string | null;
  platforms: Platform[];
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

export interface SearchHistoryItem {
  searchId: string;
  keyword: string;
  targetName: string;
  seriesName: string | null;
  status: SearchRunStatus;
  platforms: Platform[];
  productCount: number;
  matchedCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface SearchHistoryPage {
  items: SearchHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchHistoryQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: SearchRunStatus | '';
  startTime?: string;
  endTime?: string;
}

export interface VerificationBrowserInfo {
  opened: boolean;
  url: string;
  profileDir: string;
  openedAt: string;
  alreadyOpen: boolean;
  message: string;
}

export interface VerificationResumeInfo {
  resumed: boolean;
  status: SearchRunStatus;
  attempts: number;
  maxAttempts: number;
  targetUrl: string | null;
}

export type VerificationAction = 'open' | 'close' | 'resume';

export interface VerificationActionEvent {
  taskId: string;
  action: VerificationAction;
}
