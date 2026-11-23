export enum PlatformEnum {
  TAOBAO = 'taobao',
  DOUYIN = 'douyin',
  XIAOHONGSHU = 'xiaohongshu',
  PINDUODUO = 'pinduoduo',
}

export const ALL_PLATFORMS: PlatformEnum[] = [
  PlatformEnum.TAOBAO,
  PlatformEnum.DOUYIN,
  PlatformEnum.XIAOHONGSHU,
  PlatformEnum.PINDUODUO,
];

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

export enum AiStatusEnum {
  OK = 'OK',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum ManualDecisionEnum {
  PENDING = 'PENDING',
  MATCH = 'MATCH',
  NO_MATCH = 'NO_MATCH',
}
