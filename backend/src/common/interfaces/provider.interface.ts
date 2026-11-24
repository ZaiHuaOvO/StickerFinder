import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../enums';
import { NormalizedProduct } from './normalized-product.interface';

export interface SearchOptions {
  maxResults: number;
  maxPages: number;
  requestDelayMs: number;
}

export interface ProviderUsageStats {
  apiRequestCount: number;
  /** 服务商 billing 中实际扣费金额；没有 billing 时为 null，不做本地估算 */
  chargedUsd: number | null;
  requestIds: string[];
}

export interface ProviderSearchResult {
  products: NormalizedProduct[];
  /** SUCCESS 表示至少返回一个商品；EMPTY 表示平台可访问但没有结果 */
  status: 'SUCCESS' | 'EMPTY';
  warnings?: string[];
  usage?: ProviderUsageStats;
}

export interface ProviderDetailResult {
  /** 详情失败时返回 null，调用方保留原搜索结果 */
  product: NormalizedProduct | null;
  warnings?: string[];
  usage?: ProviderUsageStats;
}

export interface ProviderChannelStatus {
  key: ProviderKeyEnum;
  label: string;
  configured: boolean;
  providerType: SourceTypeEnum;
  source: ObservationSourceEnum;
  reason?: string;
}

export interface ProviderStatus {
  platform: PlatformEnum;
  configured: boolean;
  provider: SourceTypeEnum | null;
  reason?: string;
  channels?: ProviderChannelStatus[];
}

export interface PlatformProvider {
  readonly platform: PlatformEnum;
  readonly key: ProviderKeyEnum;
  readonly providerType: SourceTypeEnum;
  readonly source: ObservationSourceEnum;

  isConfigured(): boolean;

  getStatus(): ProviderStatus;

  search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult>;

  /** 可选：为单个候选补充详情；未实现的渠道不需要提供。 */
  fetchDetail?(product: NormalizedProduct): Promise<ProviderDetailResult>;
}
