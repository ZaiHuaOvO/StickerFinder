import { ObservationSourceEnum, PlatformEnum, ProviderKeyEnum, SourceTypeEnum } from '../enums';
import { PriceInfo, SkuOption } from './price.interface';
import { WholesalePriceInfo } from './wholesale-price.interface';

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
  /** 1688 等批发平台的采购价格，不能覆盖零售 price */
  wholesalePrice?: WholesalePriceInfo | null;
  sourceType: SourceTypeEnum;
  source?: ObservationSourceEnum;
  providerKey?: ProviderKeyEnum;
  sourceProductId?: string;
  /** 触发本次采集的关键词，便于回溯搜索来源 */
  sourceKeyword?: string;
  salesText?: string;
  rating?: number | null;
  region?: string | null;
  regionNote?: string | null;
  /** ISO 8601，带本地时区偏移 */
  collectedAt: string;
  rawData?: Record<string, unknown>;
}
