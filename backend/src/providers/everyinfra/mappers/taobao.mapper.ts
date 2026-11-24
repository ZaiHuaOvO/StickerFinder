import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../../common/enums';
import { NormalizedProduct } from '../../../common/interfaces/normalized-product.interface';
import { nowIso } from '../../../common/utils/date.util';
import { toHttpUrl } from '../../../common/utils/url.util';
import {
  buildRetailPrice,
  collectUrls,
  firstString,
  mapSkuOptions,
  meaningfulOriginal,
  normalizeCurrency,
  toNumber,
  toPositivePrice,
  unwrapProduct,
} from './mapper.util';

function taobaoUrl(id: string | null, raw: Record<string, unknown>): string | null {
  return (
    toHttpUrl(
      firstString(raw, ['url', 'item_url', 'detail_url', 'click_url']),
    ) ??
    (id ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(id)}` : null)
  );
}

const PRICE_BASIS_LABELS: Record<string, string> = {
  page: '页面现价',
  promotion: '推广价',
  coupon: '券后价',
  activity: '活动价',
};

function priceBasisLabel(value: string | null): string | null {
  if (!value) return null;
  const label = PRICE_BASIS_LABELS[value.trim().toLowerCase()];
  return label ? `${label}（${value}）` : value;
}

export function mapTaobaoProduct(
  input: unknown,
  base: NormalizedProduct | null = null,
  fromDetail = false,
): NormalizedProduct | null {
  const raw = unwrapProduct(input);
  if (!raw) return null;

  const id = firstString(raw, ['item_id', 'id', 'product_id', 'num_iid']);
  const title = firstString(raw, ['title', 'item_title', 'name']) ?? base?.title ?? null;
  const productUrl = taobaoUrl(id, raw) ?? base?.productUrl ?? null;
  if (!title || !productUrl) return null;

  const observedAt = nowIso();
  const currency = normalizeCurrency(raw['currency']) ?? 'CNY';
  const amount = toPositivePrice(
    raw['price'] ??
      raw['price_cny'] ??
      raw['zk_final_price'] ??
      raw['current_price'] ??
      raw['promotion_price'],
  );
  const originalAmount = meaningfulOriginal(
    amount,
    toPositivePrice(
      raw['original_price'] ??
        raw['reserve_price'] ??
        raw['list_price'] ??
        raw['market_price'],
    ),
  );
  const priceBasis = priceBasisLabel(
    firstString(raw, ['price_basis', 'price_type', 'price_desc']),
  );
  const stock = toNumber(raw['stock']);
  const price =
    amount !== null || originalAmount !== null
      ? buildRetailPrice({
          amount,
          currency,
          source: 'everyinfra_taobao',
          priceType: PriceTypeEnum.LISTING,
          originalAmount,
          observedAt,
          note: [
            priceBasis ??
              (amount !== null
                ? fromDetail
                  ? 'EveryInfra 淘宝详情返回的价格，未确认是否为目标 SKU 结算价'
                  : 'EveryInfra 淘宝搜索返回的展示价，未确认具体 SKU'
                : '接口未返回可解析的价格'),
            stock !== null ? `库存 ${stock}` : null,
          ]
            .filter(Boolean)
            .join('；'),
        })
      : undefined;

  const images = [
    ...collectUrls(raw['images']),
    ...collectUrls(raw['image_urls']),
    ...collectUrls(raw['pics']),
    ...collectUrls(raw['small_images']),
    ...collectUrls(raw['pic_url']),
    ...collectUrls(raw['image_url']),
    ...collectUrls(raw['main_image']),
    ...collectUrls(raw['main_image_url']),
    ...collectUrls(raw['description_images']),
    ...collectUrls(raw['image']),
    ...(base?.imageUrls ?? []),
  ];
  const shopName =
    firstString(raw, ['shop_name', 'shop_title', 'seller_name', 'nick']) ??
    firstString(raw['shop'] && typeof raw['shop'] === 'object'
      ? (raw['shop'] as Record<string, unknown>)
      : null, ['name', 'title']) ??
    base?.shopName ??
    undefined;
  const skus = mapSkuOptions(raw['skus'] ?? raw['sku_list'] ?? raw['sku']);

  return {
    platform: PlatformEnum.TAOBAO,
    platformProductId: id ?? base?.platformProductId,
    title,
    shopName,
    productUrl,
    imageUrls: [...new Set(images)].slice(0, 10),
    description:
      firstString(raw, ['description', 'desc', 'text', 'detail']) ??
      base?.description,
    skuOptions: skus.length > 0 ? skus : (base?.skuOptions ?? []),
    price: price ?? base?.price,
    originalPrice:
      price &&
      typeof price.originalAmount === 'number' &&
      price.originalDisplayText
        ? {
            amount: price.originalAmount,
            currency: price.currency,
            displayText: price.originalDisplayText,
            priceType: PriceTypeEnum.LISTING,
            priceSource: 'everyinfra_taobao',
            observedAt,
            shippingIncluded: 'unknown',
            note: '接口返回的折前原价',
          }
        : (base?.originalPrice ?? null),
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.EVERYINFRA_TAOBAO,
    sourceProductId: id ?? base?.sourceProductId,
    salesText:
      firstString(raw, ['sales_text']) ??
      (toNumber(raw['sales'] ?? raw['volume'] ?? raw['sold']) !== null
        ? `销量 ${toNumber(raw['sales'] ?? raw['volume'] ?? raw['sold'])}`
        : base?.salesText),
    rating: toNumber(raw['rating']) ?? base?.rating ?? null,
    region: firstString(raw, ['location', 'region']) ?? base?.region ?? null,
    regionNote: 'EveryInfra 第三方数据服务；价格与库存以淘宝页面当前展示为准',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}

export function mapTaobaoDetail(
  input: unknown,
  base: NormalizedProduct,
): NormalizedProduct | null {
  return mapTaobaoProduct(input, base, true);
}
