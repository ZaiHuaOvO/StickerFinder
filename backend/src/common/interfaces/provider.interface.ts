import { PlatformEnum, SourceTypeEnum } from '../enums';
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

export interface ProviderStatus {
  platform: PlatformEnum;
  configured: boolean;
  provider: SourceTypeEnum | null;
  reason?: string;
}

export interface PlatformProvider {
  readonly platform: PlatformEnum;
  readonly providerType: SourceTypeEnum;

  isConfigured(): boolean;

  getStatus(): ProviderStatus;

  search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult>;
}
