import { PromotionTypeEnum } from '../enums';

/**
 * 一次采集中接口明确返回的优惠信息。
 * 字段缺失时保持 null，禁止根据商品价格或标题推算优惠金额、门槛或活动规则。
 */
export interface PromotionInfo {
  /** 关联的 SKU；为空表示商品级优惠（接口未说明适用于全部 SKU） */
  skuId?: string | null;
  promotionType: PromotionTypeEnum;
  name: string;
  /** 优惠金额（元/币种单位），不是券后价 */
  amount?: number | null;
  currency?: string | null;
  /** 折扣比例，0–1；接口返回折扣字符串时由解析器换算，无法确认时保留 null */
  discountRate?: number | null;
  /** 使用门槛，接口未返回时为 null */
  minimumSpend?: number | null;
  /** ISO 8601 */
  startTime?: string | null;
  endTime?: string | null;
  description?: string | null;
  promotionUrl?: string | null;
  /** 只保留优惠相关原始字段，不复制整个接口响应 */
  rawData?: Record<string, unknown> | null;
}
