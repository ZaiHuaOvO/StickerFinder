import { PromotionTypeEnum } from '../enums';
import { PromotionInfo } from '../interfaces/promotion.interface';

/**
 * 优惠字段解析工具。
 * 只读取接口明确返回的字段；缺失、无法确认或格式异常时保持 null，
 * 不根据标题、价格或描述文本推算优惠金额、门槛与有效期。
 */

export function asRecordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * 优惠金额/门槛的严格解析：只接受数值或纯数值字符串。
 * "满20减3" 这类文本不能被压成 203。
 */
export function parsePromotionAmount(value: unknown): number | null {
  let parsed: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/[,\s¥￥$]/g, '');
    if (/^\d+(\.\d+)?$/.test(cleaned)) parsed = Number(cleaned);
  }
  if (parsed === null || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

function pickNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const parsed = parsePromotionAmount(record[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** 折扣比例统一为 0–1；无法确认时返回 null。 */
export function parseDiscountRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 0 && value < 1) return Math.round(value * 1000) / 1000;
    if (value >= 1 && value <= 10) return Math.round((value / 10) * 1000) / 1000;
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    const discount = text.match(/(\d+(?:\.\d+)?)\s*折/);
    if (discount) {
      const parsed = Number(discount[1]);
      return parsed > 0 && parsed <= 10
        ? Math.round((parsed / 10) * 1000) / 1000
        : null;
    }
    const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percent) {
      const parsed = Number(percent[1]);
      return parsed > 0 && parsed < 100
        ? Math.round((parsed / 100) * 1000) / 1000
        : null;
    }
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parseDiscountRate(parsed);
  }
  return null;
}

/** 接受 ISO、常见日期字符串、Unix 秒/毫秒；无法解析时返回 null。 */
export function parsePromotionTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{10}$/.test(text) || /^\d{13}$/.test(text)) {
    return parsePromotionTime(Number(text));
  }
  const date = new Date(text.includes('T') ? text : text.replace(/-/g, '/'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 只有日期没有时间的结束时间按当天 23:59:59.999 处理，避免当天被误判为已过期。 */
export function parsePromotionEndTime(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const date = new Date(`${value.trim()}T23:59:59.999`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return parsePromotionTime(value);
}

function inferPromotionType(
  rawType: string | null,
  fallback: PromotionTypeEnum,
): PromotionTypeEnum {
  if (!rawType) return fallback;
  const text = rawType.trim().toLowerCase();
  // 店铺券/平台券仍然属于优惠券，先于活动类型判断。
  if (text.includes('coupon') || rawType.includes('券')) {
    return PromotionTypeEnum.COUPON;
  }
  if (text.includes('platform') || rawType.includes('平台')) {
    return PromotionTypeEnum.PLATFORM_ACTIVITY;
  }
  if (
    text.includes('shop') ||
    text.includes('store') ||
    rawType.includes('店铺') ||
    rawType.includes('商家')
  ) {
    return PromotionTypeEnum.SHOP_ACTIVITY;
  }
  if (
    text.includes('discount') ||
    text.includes('reduce') ||
    rawType.includes('折') ||
    rawType.includes('减')
  ) {
    return PromotionTypeEnum.DISCOUNT;
  }
  return fallback;
}

const DEFAULT_NAMES: Record<PromotionTypeEnum, string> = {
  [PromotionTypeEnum.COUPON]: '优惠券',
  [PromotionTypeEnum.SHOP_ACTIVITY]: '店铺活动',
  [PromotionTypeEnum.PLATFORM_ACTIVITY]: '平台活动',
  [PromotionTypeEnum.DISCOUNT]: '优惠',
  [PromotionTypeEnum.OTHER]: '优惠',
};

export interface PromotionParseOptions {
  fallbackType: PromotionTypeEnum;
  skuId?: string | null;
  currency?: string | null;
  /** 1688 的 promotions 是纯文字数组；只有这类字段才接受字符串条目 */
  acceptPlainText?: boolean;
}

export function parsePromotionEntry(
  value: unknown,
  options: PromotionParseOptions,
): PromotionInfo | null {
  const record = asRecordValue(value);
  if (!record) return null;

  const rawType = pickString(record, [
    'type',
    'promotion_type',
    'activity_type',
    'coupon_type',
    'promotionType',
  ]);
  const promotionType = inferPromotionType(rawType, options.fallbackType);

  const explicitName = pickString(record, [
    'name',
    'title',
    'coupon_name',
    'coupon_title',
    'promotion_name',
    'activity_name',
  ]);
  const name = explicitName ?? DEFAULT_NAMES[promotionType];

  const amount = pickNumber(record, [
    'amount',
    'discount_amount',
    'coupon_amount',
    'reduce_amount',
    'face_value',
    'money',
    'value',
  ]);
  const minimumSpend = pickNumber(record, [
    'minimum_spend',
    'min_spend',
    'threshold',
    'min_amount',
    'condition_amount',
    'use_threshold',
    'limit_amount',
    'order_amount',
  ]);
  const discountRate =
    parseDiscountRate(
      record['discount_rate'] ??
        record['discountRate'] ??
        record['discount'] ??
        record['rate'],
    ) ?? null;

  if (amount === null && discountRate === null) {
    // 名称、金额、折扣、说明都没有的条目没有任何可用数据，直接丢弃；
    // 接口明确给出名称但没有金额的白名单券仍然保留。
    if (
      !explicitName &&
      !pickString(record, [
        'description',
        'desc',
        'rule',
        'use_rule',
        'rule_text',
        'content',
        'summary',
        'brief',
      ])
    ) {
      return null;
    }
  }

  const description = pickString(record, [
    'description',
    'desc',
    'rule',
    'use_rule',
    'rule_text',
    'content',
    'summary',
    'brief',
    'scope',
    'applicable_scope',
  ]);
  const promotionUrl = pickString(record, [
    'url',
    'link',
    'coupon_url',
    'receive_url',
    'activity_url',
    'jump_url',
  ]);
  const startTime = parsePromotionTime(
    record['start_time'] ??
      record['startTime'] ??
      record['start_at'] ??
      record['begin_time'] ??
      record['valid_from'] ??
      record['effective_time'],
  );
  const endTime = parsePromotionEndTime(
    record['end_time'] ??
      record['endTime'] ??
      record['end_at'] ??
      record['expire_time'] ??
      record['valid_to'] ??
      record['expired_time'],
  );

  return {
    skuId: pickString(record, ['sku_id', 'skuId', 'spec_id']) ?? options.skuId ?? null,
    promotionType,
    name,
    amount: amount ?? null,
    currency: options.currency ?? null,
    discountRate,
    minimumSpend,
    startTime,
    endTime,
    description,
    promotionUrl,
    rawData: record,
  };
}

export function parsePromotionEntries(
  value: unknown,
  options: PromotionParseOptions,
): PromotionInfo[] {
  if (!Array.isArray(value)) {
    const single = asRecordValue(value);
    if (!single) return [];
    const parsed = parsePromotionEntry(single, options);
    return parsed ? [parsed] : [];
  }
  const result: PromotionInfo[] = [];
  for (const entry of value.slice(0, 50)) {
    if (typeof entry === 'string') {
      if (!options.acceptPlainText) continue;
      // 1688 的 promotions 可能是纯文字数组，例如“满优惠”。
      const text = entry.trim();
      if (!text) continue;
      result.push({
        skuId: options.skuId ?? null,
        promotionType: options.fallbackType,
        name: text.slice(0, 255),
        amount: null,
        currency: options.currency ?? null,
        discountRate: null,
        minimumSpend: null,
        startTime: null,
        endTime: null,
        description: text,
        promotionUrl: null,
        rawData: { text },
      });
      continue;
    }
    const parsed = parsePromotionEntry(entry, options);
    if (parsed) result.push(parsed);
  }
  return result;
}

/** 同一次采集内的去重键；不同采集时间由不同观察记录保留，不在此合并。 */
export function promotionKey(promotion: PromotionInfo): string {
  return [
    promotion.promotionType,
    promotion.skuId ?? '',
    promotion.name,
    promotion.amount ?? '',
    promotion.discountRate ?? '',
    promotion.minimumSpend ?? '',
    promotion.startTime ?? '',
    promotion.endTime ?? '',
    promotion.description ?? '',
  ].join('|');
}

export function dedupePromotions(promotions: PromotionInfo[]): PromotionInfo[] {
  const seen = new Set<string>();
  const result: PromotionInfo[] = [];
  for (const promotion of promotions) {
    const key = promotionKey(promotion);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(promotion);
  }
  return result;
}
