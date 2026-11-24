export enum PlatformEnum {
  TAOBAO = 'taobao',
  DOUYIN = 'douyin',
  XIAOHONGSHU = 'xiaohongshu',
  ALIBABA1688 = 'alibaba1688',
  PINDUODUO = 'pinduoduo',
}

export const ALL_PLATFORMS: PlatformEnum[] = [
  PlatformEnum.TAOBAO,
  PlatformEnum.DOUYIN,
  PlatformEnum.XIAOHONGSHU,
  PlatformEnum.ALIBABA1688,
  PlatformEnum.PINDUODUO,
];

/**
 * 数据源选择模式：
 * - PRIMARY：每个平台只运行主数据源。
 * - PARALLEL：平台下所有渠道同时运行，便于人工对照。
 * - FALLBACK：主数据源失败/未配置时，按渠道顺序逐个尝试备用数据源（每个渠道最多一次）。
 */
export enum SourceSelectionModeEnum {
  PRIMARY = 'PRIMARY',
  PARALLEL = 'PARALLEL',
  FALLBACK = 'FALLBACK',
}

export enum SourceTypeEnum {
  OFFICIAL_API = 'official_api',
  BROWSER = 'browser',
  THIRD_PARTY = 'third_party',
}

/** 统一商品观察来源，用于 ProductObservation */
export enum ObservationSourceEnum {
  OFFICIAL_API = 'official_api',
  THIRD_PARTY_API = 'third_party_api',
  PLAYWRIGHT = 'playwright',
}

/** 具体数据服务/采集器标识 */
export enum ProviderKeyEnum {
  TAOBAO_TBK = 'taobao_tbk',
  PDD_DDK = 'pdd_ddk',
  QOVIA = 'qovia',
  BAMBOO = 'bamboo',
  OKDATA = 'okdata',
  SOCIALTOAI = 'socialtoai',
  PLAYWRIGHT = 'playwright',
  EVERYINFRA_TAOBAO = 'everyinfra_taobao',
  EVERYINFRA_DOUYIN = 'everyinfra_douyin',
  EVERYINFRA_XIAOHONGSHU = 'everyinfra_xiaohongshu',
  EVERYINFRA_ALIBABA1688 = 'everyinfra_alibaba1688',
}

export enum PriceTypeEnum {
  TARGET_SKU = 'TARGET_SKU',
  BUNDLE = 'BUNDLE',
  FULL_SET = 'FULL_SET',
  LOWEST_SKU = 'LOWEST_SKU',
  LISTING = 'LISTING',
  UNKNOWN = 'UNKNOWN',
}

export enum SearchRunStatusEnum {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  INTERRUPTED = 'INTERRUPTED',
  CANCELLED = 'CANCELLED',
  /** 某个浏览器渠道被验证码/登录拦截，等待人工在可见浏览器中处理后继续 */
  WAITING_MANUAL_VERIFICATION = 'WAITING_MANUAL_VERIFICATION',
}

export enum PlatformTaskStatusEnum {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  EMPTY = 'EMPTY',
  FAILED = 'FAILED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  BLOCKED = 'BLOCKED',
  CANCELLED = 'CANCELLED',
  /** 任务已暂停，等待人工完成验证码/登录；不是失败 */
  WAITING_MANUAL_VERIFICATION = 'WAITING_MANUAL_VERIFICATION',
}

/** 平台级聚合状态（由该平台下多个渠道任务得出） */
export enum PlatformStatusEnum {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
  EMPTY = 'EMPTY',
  FAILED = 'FAILED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  CANCELLED = 'CANCELLED',
  WAITING_MANUAL_VERIFICATION = 'WAITING_MANUAL_VERIFICATION',
}

/** 采集渠道错误码。新增浏览器/平台限制时使用同一套值，避免各处硬编码字符串。 */
export enum ProviderErrorCodeEnum {
  PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED',
  PLAYWRIGHT_NOT_INSTALLED = 'PLAYWRIGHT_NOT_INSTALLED',
  BROWSER_URL_NOT_ALLOWED = 'BROWSER_URL_NOT_ALLOWED',
  BROWSER_ERROR = 'BROWSER_ERROR',
  BROWSER_PROFILE_BUSY = 'BROWSER_PROFILE_BUSY',
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  LOGIN_REQUIRED = 'LOGIN_REQUIRED',
  BLOCKED_BY_PLATFORM = 'BLOCKED_BY_PLATFORM',
  PARSE_FAILED = 'PARSE_FAILED',
  GOODS_SEARCH_UNAVAILABLE = 'GOODS_SEARCH_UNAVAILABLE',
  INTERRUPTED = 'INTERRUPTED',
  EVERYINFRA_API_ERROR = 'EVERYINFRA_API_ERROR',
  EVERYINFRA_AUTH_ERROR = 'EVERYINFRA_AUTH_ERROR',
  EVERYINFRA_INSUFFICIENT_BALANCE = 'EVERYINFRA_INSUFFICIENT_BALANCE',
  EVERYINFRA_RATE_LIMITED = 'EVERYINFRA_RATE_LIMITED',
  EVERYINFRA_TIMEOUT = 'EVERYINFRA_TIMEOUT',
  EVERYINFRA_BAD_RESPONSE = 'EVERYINFRA_BAD_RESPONSE',
  EVERYINFRA_IMAGE_SEARCH_DISABLED = 'EVERYINFRA_IMAGE_SEARCH_DISABLED',
  CANCELLED = 'CANCELLED',
}

export enum MatchStatusEnum {
  MATCH = 'MATCH',
  NO_MATCH = 'NO_MATCH',
  UNCERTAIN = 'UNCERTAIN',
}

export enum MatchTypeEnum {
  EXACT_SINGLE = 'EXACT_SINGLE',
  TARGET_VARIANT = 'TARGET_VARIANT',
  CONTAINS_TARGET_BUNDLE = 'CONTAINS_TARGET_BUNDLE',
  CONTAINS_TARGET_FULL_SET = 'CONTAINS_TARGET_FULL_SET',
  NOT_MATCH = 'NOT_MATCH',
  UNCERTAIN = 'UNCERTAIN',
}

export enum CandidateRelevanceEnum {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  NONE = 'NONE',
}

/** 类别、系列、目标款式三个维度的匹配结论 */
export enum MatchAssessmentEnum {
  MATCH = 'MATCH',
  CONFLICT = 'CONFLICT',
  UNKNOWN = 'UNKNOWN',
}

export enum VisualMatchEnum {
  VISUAL_EXACT = 'VISUAL_EXACT',
  VISUAL_SIMILAR = 'VISUAL_SIMILAR',
  VISUAL_ABSENT = 'VISUAL_ABSENT',
  VISUAL_UNAVAILABLE = 'VISUAL_UNAVAILABLE',
}

export enum NextActionEnum {
  NONE = 'NONE',
  FETCH_PRODUCT_DETAIL = 'FETCH_PRODUCT_DETAIL',
  FETCH_SKU = 'FETCH_SKU',
  FETCH_IMAGES = 'FETCH_IMAGES',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

export enum AiStatusEnum {
  OK = 'OK',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** 目标 SKU 的核验状态，与商品匹配状态分离 */
export enum SkuVerificationStatusEnum {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  PARTIAL = 'PARTIAL',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
  FAILED = 'FAILED',
}

/** 目标 SKU 价格的核验状态，不能由商品 MATCH 直接推导 */
export enum PriceVerificationStatusEnum {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  PARTIAL = 'PARTIAL',
  UNVERIFIED = 'UNVERIFIED',
  FAILED = 'FAILED',
}

export enum ManualDecisionEnum {
  PENDING = 'PENDING',
  MATCH = 'MATCH',
  NO_MATCH = 'NO_MATCH',
}
