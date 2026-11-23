import { PriceTypeEnum } from '../enums';

export type ShippingIncluded = 'unknown' | 'included' | 'not_included';

export interface PriceInfo {
  /** 无法提取时必须为 null，禁止用 0 代替 */
  amount: number | null;
  currency: 'CNY';
  displayText: string;
  priceType: PriceTypeEnum;
  priceSource: string;
  /** ISO 8601，带本地时区偏移 */
  observedAt: string;
  shippingIncluded: ShippingIncluded;
  /** 价格说明，例如“最低 SKU 起售价”“需拼团” */
  note?: string;
  /** 拼多多等平台的拼团价，作为补充信息单独保留 */
  groupPrice?: PriceInfo | null;
}

export interface SkuOption {
  skuId?: string;
  name: string;
  price?: number;
  imageUrl?: string;
}
