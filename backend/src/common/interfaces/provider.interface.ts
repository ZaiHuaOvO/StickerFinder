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

export interface ProviderSearchResult {
  products: NormalizedProduct[];
  /** SUCCESS 表示至少返回一个商品；EMPTY 表示平台可访问但没有结果 */
  status: 'SUCCESS' | 'EMPTY';
  warnings?: string[];
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
}
