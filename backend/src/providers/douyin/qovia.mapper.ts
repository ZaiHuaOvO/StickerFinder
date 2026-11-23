import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { nowIso } from '../../common/utils/date.util';
import { toHttpUrl } from '../../common/utils/url.util';

export interface QoviaPromotion {
  product_id?: string | number;
  promotion_id?: string | number;
  base_info?: {
    title?: string;
    price?: unknown;
    main_img?: { uri?: string; url_list?: string[] };
    detail_url?: string;
    category?: Record<string, unknown>;
  };
}

export interface QoviaSummaryPromotion {
  product_id?: string | number;
  promotion_id?: string | number;
  base_model?: {
    product_info?: {
      name?: string;
      detail_url?: string;
      month_sale?: { origin?: number };
      good_ratio?: { origin?: number };
    };
    marketing_info?: {
      price_desc?: {
        price?: { origin?: number; integer?: string; decimal?: string };
        price_text?: string;
      };
    };
    shop_info?: {
      shop_id?: string | number;
      shop_name?: string;
    };
  };
}

export interface QoviaSearchData {
  promotions?: QoviaPromotion[];
  summary_promotions?: QoviaSummaryPromotion[];
  has_more?: boolean;
  total?: number;
  extra?: { search_id?: string; [key: string]: unknown };
}

function asString(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function priceFromSummary(summary: QoviaSummaryPromotion | undefined): number | null {
  const price = summary?.base_model?.marketing_info?.price_desc?.price;
  if (!price) return null;
  if (typeof price.origin === 'number' && Number.isFinite(price.origin) && price.origin > 0) {
    return Math.round(price.origin) / 100;
  }
  const integer = Number.parseFloat(String(price.integer ?? ''));
  const decimalText = String(price.decimal ?? '');
  const decimal = Number.parseFloat(decimalText);
  if (!Number.isFinite(integer)) return null;
  const value = integer + (Number.isFinite(decimal) ? decimal / 10 ** decimalText.length : 0);
  return value > 0 ? Math.round(value * 100) / 100 : null;
}

/** 官方文档示例响应字段的防御性映射；字段变化时返回 null 而不是编造商品。 */
export function mapQoviaProduct(
  promotion: QoviaPromotion | undefined,
  summary: QoviaSummaryPromotion | undefined,
): NormalizedProduct | null {
  const productId =
    asString(promotion?.product_id) ?? asString(summary?.product_id);
  const title =
    promotion?.base_info?.title?.trim() ??
    summary?.base_model?.product_info?.name?.trim() ??
    '';
  if (!productId || !title) return null;

  const rawUrl =
    promotion?.base_info?.detail_url ??
    summary?.base_model?.product_info?.detail_url;
  const productUrl =
    toHttpUrl(rawUrl) ??
    `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${encodeURIComponent(
      productId,
    )}`;

  const imageUrls = (promotion?.base_info?.main_img?.url_list ?? [])
    .map((url) => toHttpUrl(url))
    .filter((url): url is string => Boolean(url));

  const amount = priceFromSummary(summary);
  const priceText =
    summary?.base_model?.marketing_info?.price_desc?.price_text?.trim() || '';
  const observedAt = nowIso();
  const salesOrigin = summary?.base_model?.product_info?.month_sale?.origin;
  const goodRatio = summary?.base_model?.product_info?.good_ratio?.origin;

  return {
    platform: PlatformEnum.DOUYIN,
    platformProductId: productId,
    title,
    shopName: summary?.base_model?.shop_info?.shop_name?.trim() || undefined,
    productUrl,
    imageUrls: [...new Set(imageUrls)].slice(0, 10),
    skuOptions: [],
    price: {
      amount,
      currency: 'CNY',
      displayText: amount !== null ? `¥${amount.toFixed(2)}` : '未获取',
      priceType: amount !== null ? PriceTypeEnum.LISTING : PriceTypeEnum.UNKNOWN,
      priceSource: 'qovia_api',
      observedAt,
      shippingIncluded: 'unknown',
      note:
        amount !== null
          ? `Qovia 返回的抖音商品价格${priceText ? `（price_text=${priceText}）` : ''}，未确认具体 SKU`
          : 'Qovia 未返回可解析的价格',
    },
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.QOVIA,
    sourceProductId: productId,
    salesText:
      typeof salesOrigin === 'number' && Number.isFinite(salesOrigin)
        ? `月销 ${salesOrigin}`
        : undefined,
    rating: null,
    region: null,
    regionNote:
      'Qovia 为第三方数据服务，官方文档未声明数据地区；未确认中国大陆用户可购买性',
    collectedAt: observedAt,
    rawData: {
      promotions: promotion ?? null,
      summary_promotions:
        summary && goodRatio !== undefined
          ? { ...summary, good_ratio_origin: goodRatio }
          : (summary ?? null),
    },
  };
}

export function mapQoviaData(data: QoviaSearchData | null | undefined): {
  products: NormalizedProduct[];
  hasMore: boolean;
  searchId?: string;
  total?: number;
} {
  const promotions = Array.isArray(data?.promotions) ? data.promotions : [];
  const summaries = Array.isArray(data?.summary_promotions)
    ? data.summary_promotions
    : [];
  const byId = new Map<
    string,
    { promotion?: QoviaPromotion; summary?: QoviaSummaryPromotion }
  >();

  for (const promotion of promotions) {
    const id = asString(promotion.product_id);
    if (!id) continue;
    const entry = byId.get(id) ?? {};
    entry.promotion = promotion;
    byId.set(id, entry);
  }
  for (const summary of summaries) {
    const id = asString(summary.product_id);
    if (!id) continue;
    const entry = byId.get(id) ?? {};
    entry.summary = summary;
    byId.set(id, entry);
  }

  const products: NormalizedProduct[] = [];
  for (const entry of byId.values()) {
    const product = mapQoviaProduct(entry.promotion, entry.summary);
    if (product) products.push(product);
  }

  return {
    products,
    hasMore: Boolean(data?.has_more),
    searchId: data?.extra?.search_id,
    total: data?.total,
  };
}
