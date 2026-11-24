import {
  PriceTypeEnum,
} from '../../../common/enums';
import { PriceInfo, SkuOption } from '../../../common/interfaces/price.interface';
import { nowIso } from '../../../common/utils/date.util';
import { parsePromotionAmount } from '../../../common/utils/promotion.util';
import { toHttpUrl } from '../../../common/utils/url.util';

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 详情接口可能把商品包在 data/product/item 中，逐层展开。 */
export function unwrapProduct(value: unknown): Record<string, unknown> | null {
  let record = asRecord(value);
  for (let depth = 0; record && depth < 3; depth += 1) {
    const nested =
      asRecord(record['product']) ??
      asRecord(record['item']) ??
      asRecord(record['detail']) ??
      asRecord(record['data']);
    if (!nested) return record;
    record = nested;
  }
  return record;
}

export function firstString(
  record: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toPositivePrice(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

/** 原价等于现价时不算折扣，避免展示无意义的划线价。 */
export function meaningfulOriginal(
  amount: number | null,
  original: number | null,
): number | null {
  if (original === null) return null;
  if (amount === null) return original;
  return original > amount ? original : null;
}

export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  if (trimmed === 'RMB' || trimmed === 'CNY' || trimmed === '¥') return 'CNY';
  if (trimmed === 'USD' || trimmed === '$') return 'USD';
  return trimmed;
}

export function currencyDisplay(amount: number, currency: string | null): string {
  if (currency === 'CNY') return `¥${amount.toFixed(2)}`;
  if (currency === 'USD') return `$${amount.toFixed(2)}`;
  if (!currency) return `${amount.toFixed(2)}（币种未知）`;
  return `${currency} ${amount.toFixed(2)}`;
}

export function collectUrls(value: unknown): string[] {
  const urls: string[] = [];
  const push = (item: unknown): void => {
    if (typeof item === 'string') {
      const url = toHttpUrl(item);
      if (url) urls.push(url);
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) push(entry);
      return;
    }
    const record = asRecord(item);
    if (!record) return;
    push(
      record['url'] ??
        record['image_url'] ??
        record['imageUrl'] ??
        record['src'] ??
        record['image'],
    );
  };
  push(value);
  return [...new Set(urls)];
}

export function firstUrl(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const urls = collectUrls(record[key]);
    if (urls.length > 0) return urls[0];
  }
  return null;
}

export function mapSkuOptions(value: unknown): SkuOption[] {
  if (!Array.isArray(value)) return [];
  const skus: SkuOption[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const name = entry.trim();
      if (name) skus.push({ name });
      continue;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const name = firstString(record, [
      'name',
      'title',
      'sku_name',
      'spec',
      'spec_name',
      'value',
      'label',
    ]);
    if (!name) continue;
    const skuId = firstString(record, ['sku_id', 'skuId', 'id']);
    const price = toPositivePrice(
      record['price'] ?? record['price_cny'] ?? record['sale_price'],
    );
    const imageUrl = firstUrl(record, ['image_url', 'image', 'pic_url', 'url']);
    // 券后价只在接口明确返回、且低于该 SKU 现价时采用；否则不展示，避免把券面额当成价格。
    const couponPrice = parsePromotionAmount(
      record['coupon_price'] ?? record['couponPrice'] ?? record['price_after_coupon'],
    );
    const validCouponPrice =
      couponPrice !== null && (price === null || couponPrice < price)
        ? couponPrice
        : undefined;
    const couponText = firstString(record, [
      'coupon_text',
      'coupon_desc',
      'coupon_note',
      'price_note',
    ]);
    skus.push({
      ...(skuId ? { skuId } : {}),
      name,
      ...(price !== null ? { price } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(validCouponPrice !== undefined ? { couponPrice: validCouponPrice } : {}),
      ...(couponText ? { couponText } : {}),
    });
    if (skus.length >= 100) break;
  }
  return skus;
}

export interface RetailPriceInput {
  amount: number | null;
  currency: string | null;
  source: string;
  priceType: PriceTypeEnum;
  note?: string | null;
  originalAmount?: number | null;
  observedAt?: string;
}

export function buildRetailPrice(input: RetailPriceInput): PriceInfo {
  const observedAt = input.observedAt ?? nowIso();
  const currency = input.currency;
  return {
    amount: input.amount,
    currency: currency ?? 'UNKNOWN',
    displayText:
      input.amount !== null
        ? currencyDisplay(input.amount, currency)
        : '未获取',
    priceType:
      input.amount !== null ? input.priceType : PriceTypeEnum.UNKNOWN,
    priceSource: input.source,
    observedAt,
    shippingIncluded: 'unknown',
    ...(input.originalAmount !== null && input.originalAmount !== undefined
      ? {
          originalAmount: input.originalAmount,
          originalDisplayText: currencyDisplay(input.originalAmount, currency),
        }
      : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}
