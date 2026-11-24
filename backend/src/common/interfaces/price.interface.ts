import { PriceTypeEnum } from '../enums';

export type ShippingIncluded = 'unknown' | 'included' | 'not_included';

export interface PriceInfo {
  /** 无法提取时必须为 null，禁止用 0 代替 */
  amount: number | null;
  currency: string;
  displayText: string;
  priceType: PriceTypeEnum;
  priceSource: string;
  /** ISO 8601，带本地时区偏移 */
  observedAt: string;
  shippingIncluded: ShippingIncluded;
  /** 折前原价（有则保留） */
  originalAmount?: number | null;
  originalDisplayText?: string | null;
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
  /** 接口明确返回的该 SKU 券后价；没有返回时为 undefined，不推算 */
  couponPrice?: number;
  /** 接口返回的 SKU 优惠说明原文 */
  couponText?: string;
}
