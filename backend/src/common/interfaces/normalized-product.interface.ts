import { PlatformEnum, SourceTypeEnum } from '../enums';
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
  /** 拼多多等平台单独保留的拼团价 */
  groupPrice?: PriceInfo | null;
  sourceType: SourceTypeEnum;
  /** ISO 8601，带本地时区偏移 */
  collectedAt: string;
  rawData?: Record<string, unknown>;
}
