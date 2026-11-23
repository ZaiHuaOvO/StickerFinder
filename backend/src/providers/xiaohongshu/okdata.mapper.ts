import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { PriceInfo } from '../../common/interfaces/price.interface';
import { nowIso } from '../../common/utils/date.util';
import { toHttpUrl } from '../../common/utils/url.util';

export interface OkDataProduct {
  id?: string;
  url?: string;
  title?: string;
  price?: number | null;
  original_price?: number | null;
  currency?: string | null;
  sold?: number | null;
  rating?: number | null;
  reviews?: number | null;
  images?: string[] | null;
  shop?: {
    id?: string | null;
    name?: string | null;
    url?: string | null;
  } | null;
  ext?: Record<string, unknown>;
}

function currencyDisplay(amount: number, currency: string): string {
  if (currency === 'CNY') return `¥${amount.toFixed(2)}`;
  if (currency === 'UNKNOWN') return `${amount.toFixed(2)}（币种未知）`;
  return `${currency} ${amount.toFixed(2)}`;
}

export function mapOkDataProduct(raw: OkDataProduct): NormalizedProduct | null {
  const productId = raw.id?.trim();
  const title = raw.title?.trim();
  if (!productId || !title) return null;

  const productUrl =
    toHttpUrl(raw.url) ??
    `https://www.xiaohongshu.com/goods-detail/${encodeURIComponent(productId)}`;
  const images = (raw.images ?? [])
    .map((url) => toHttpUrl(url))
    .filter((url): url is string => Boolean(url));
  const currency = raw.currency?.trim() || 'UNKNOWN';
  const observedAt = nowIso();

  const priceAmount =
    typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price > 0
      ? Math.round(raw.price * 100) / 100
      : null;
  const price: PriceInfo = {
    amount: priceAmount,
    currency,
    displayText:
      priceAmount !== null ? currencyDisplay(priceAmount, currency) : '未获取',
    priceType:
      priceAmount !== null ? PriceTypeEnum.LOWEST_SKU : PriceTypeEnum.UNKNOWN,
    priceSource: 'okdata_api',
    observedAt,
    shippingIncluded: 'unknown',
    note:
      priceAmount !== null
        ? 'OKData 返回的最低规格现价，未确认是否为目标 SKU；促销可能与大陆用户不同'
        : 'OKData 未返回可解析的价格',
  };

  const originalAmount =
    typeof raw.original_price === 'number' &&
    Number.isFinite(raw.original_price) &&
    raw.original_price > 0
      ? Math.round(raw.original_price * 100) / 100
      : null;
  const originalPrice: PriceInfo | null =
    originalAmount !== null
      ? {
          amount: originalAmount,
          currency,
          displayText: currencyDisplay(originalAmount, currency),
          priceType: PriceTypeEnum.LISTING,
          priceSource: 'okdata_api',
          observedAt,
          shippingIncluded: 'unknown',
          note: 'OKData 返回的折前原价',
        }
      : null;
  if (originalPrice) {
    price.originalAmount = originalPrice.amount;
    price.originalDisplayText = originalPrice.displayText;
  }

  return {
    platform: PlatformEnum.XIAOHONGSHU,
    platformProductId: productId,
    title,
    shopName: raw.shop?.name?.trim() || undefined,
    productUrl,
    imageUrls: [...new Set(images)].slice(0, 10),
    skuOptions: [],
    price,
    originalPrice,
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.OKDATA,
    sourceProductId: productId,
    salesText:
      typeof raw.sold === 'number' && Number.isFinite(raw.sold)
        ? `销量 ${raw.sold}`
        : undefined,
    rating: typeof raw.rating === 'number' ? raw.rating : null,
    region: 'overseas_app_view',
    regionNote:
      'OKData 文档说明其小红书商品详情为海外 App 用户视角，促销可能与大陆用户不同；未确认中国大陆可购买性',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}

export function mapOkDataItems(
  items: OkDataProduct[] | null | undefined,
): NormalizedProduct[] {
  const products: NormalizedProduct[] = [];
  for (const item of items ?? []) {
    const product = mapOkDataProduct(item);
    if (product) products.push(product);
  }
  return products;
}
