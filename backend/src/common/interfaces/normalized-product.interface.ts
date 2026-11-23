import { ObservationSourceEnum, PlatformEnum, ProviderKeyEnum, SourceTypeEnum } from '../enums';
import { PriceInfo, SkuOption } from './price.interface';

export interface NormalizedProduct {
  platform: PlatformEnum;
  platformProductId?: string;
  title: string;
  shopName?: string;
  productUrl: string;
  imageUrls: string[];
  description?: string;
  skuOptions: SkuOption[];
  price?: PriceInfo;
  originalPrice?: PriceInfo | null;
  /** 拼多多等平台单独保留的拼团价 */
  groupPrice?: PriceInfo | null;
  sourceType: SourceTypeEnum;
  source?: ObservationSourceEnum;
  providerKey?: ProviderKeyEnum;
  sourceProductId?: string;
  salesText?: string;
  rating?: number | null;
  region?: string | null;
  regionNote?: string | null;
  /** ISO 8601，带本地时区偏移 */
  collectedAt: string;
  rawData?: Record<string, unknown>;
}
