import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../../common/enums';
import { NormalizedProduct } from '../../../common/interfaces/normalized-product.interface';
import { SkuOption } from '../../../common/interfaces/price.interface';
import { nowIso } from '../../../common/utils/date.util';
import { toHttpUrl } from '../../../common/utils/url.util';
import {
  asRecord,
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

function douyinUrl(id: string | null, raw: Record<string, unknown>): string | null {
  return (
    toHttpUrl(
      firstString(raw, [
        'url',
        'product_url',
        'detail_url',
        'link',
        'share_url',
      ]),
    ) ??
    (id
      ? `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=${encodeURIComponent(id)}`
      : null)
  );
}

/** 详情接口用 variant_groups 返回款式；选项只有名称，没有单价。 */
function mapVariantGroups(value: unknown): SkuOption[] {
  if (!Array.isArray(value)) return [];
  const skus: SkuOption[] = [];
  for (const group of value) {
    const record = asRecord(group);
    if (!record) continue;
    const groupName = firstString(record, ['name', 'group_name', 'title']);
    const options = record['options'];
    if (!Array.isArray(options)) continue;
    for (const option of options) {
      if (typeof option === 'string') {
        const name = option.trim();
        if (name) {
          skus.push({ name: groupName ? `${groupName}：${name}` : name });
        }
        continue;
      }
      const optionRecord = asRecord(option);
      if (!optionRecord) continue;
      const name = firstString(optionRecord, ['name', 'value', 'title']);
      if (!name) continue;
      const skuId = firstString(optionRecord, ['id', 'sku_id']);
      skus.push({
        ...(skuId ? { skuId } : {}),
        name: groupName ? `${groupName}：${name}` : name,
      });
      if (skus.length >= 100) return skus;
    }
  }
  return skus;
}

export function mapDouyinProduct(
  input: unknown,
  base: NormalizedProduct | null = null,
  fromDetail = false,
): NormalizedProduct | null {
  const raw = unwrapProduct(input);
  if (!raw) return null;

  // product_id 与 promotion_id 是不同字段，不能混用；promotion_id 仅保留在 rawData。
  const id = firstString(raw, ['product_id', 'id', 'productId']);
  const title = firstString(raw, ['title', 'name', 'product_name']) ?? base?.title ?? null;
  const productUrl = douyinUrl(id, raw) ?? base?.productUrl ?? null;
  if (!title || !productUrl) return null;

  const observedAt = nowIso();
  const currency =
    normalizeCurrency(raw['currency']) ??
    (raw['price_cny'] !== undefined ? 'CNY' : null);
  const amount = toPositivePrice(
    raw['price_cny'] ?? raw['price'] ?? raw['current_price'],
  );
  const originalAmount = meaningfulOriginal(
    amount,
    toPositivePrice(
      raw['original_price'] ?? raw['market_price'] ?? raw['list_price'],
    ),
  );
  const priceLabel = firstString(raw, ['price_label', 'price_text', 'price_desc']);
  const discountPrice = toPositivePrice(raw['discount_price_cny']);
  const shipping = [
    firstString(raw, ['shipping_fee_text']),
    firstString(raw, ['shipping_estimate_text']),
  ]
    .filter(Boolean)
    .join('，');
  const price =
    amount !== null || originalAmount !== null
      ? buildRetailPrice({
          amount,
          currency,
          source: 'everyinfra_douyin',
          priceType: PriceTypeEnum.LISTING,
          originalAmount,
          observedAt,
          note: [
            priceLabel ? `接口价格标签：${priceLabel}` : null,
            discountPrice !== null && amount !== null && discountPrice < amount
              ? `接口返回折扣价字段 ${discountPrice.toFixed(2)}，未确认是否可作为结算价`
              : null,
            amount !== null
              ? fromDetail
                ? 'EveryInfra 抖音详情价格；价格标签不等于当前用户结算价'
                : 'EveryInfra 抖音搜索价格；到手价标签不等于当前用户结算价'
              : '接口未返回可解析的价格',
            shipping ? `运费：${shipping}` : null,
            raw['on_sale'] === false ? '接口标记为当前不可售' : null,
          ]
            .filter(Boolean)
            .join('；'),
        })
      : undefined;

  const shopRecord = asRecord(raw['shop']);
  const images = [
    ...collectUrls(raw['main_image_urls']),
    ...collectUrls(raw['images']),
    ...collectUrls(raw['image_urls']),
    ...collectUrls(raw['image_url']),
    ...collectUrls(raw['main_image']),
    ...collectUrls(raw['cover']),
    ...collectUrls(raw['detail_image_urls']),
    ...(base?.imageUrls ?? []),
  ];
  const monthlySales = toNumber(raw['monthly_sales']);
  const sales =
    monthlySales ??
    toNumber(
      raw['sales_30d'] ??
        raw['sales_last_30_days'] ??
        raw['sales_count'] ??
        raw['sold'] ??
        raw['sales'],
    ) ??
    null;
  const variantSkus = mapVariantGroups(raw['variant_groups']);
  const skus =
    variantSkus.length > 0
      ? variantSkus
      : mapSkuOptions(raw['specs'] ?? raw['skus'] ?? raw['sku']);
  const salesText = firstString(raw, ['sales_text']);

  return {
    platform: PlatformEnum.DOUYIN,
    platformProductId: id ?? base?.platformProductId,
    title,
    shopName:
      firstString(shopRecord, ['shop_name', 'name', 'title']) ??
      firstString(raw, ['shop_name', 'seller_name']) ??
      base?.shopName ??
      undefined,
    productUrl,
    imageUrls: [...new Set(images)].slice(0, 10),
    description:
      firstString(raw, ['description', 'detail', 'text']) ?? base?.description,
    skuOptions: skus.length > 0 ? skus : (base?.skuOptions ?? []),
    price: price ?? base?.price,
    originalPrice: base?.originalPrice ?? null,
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.EVERYINFRA_DOUYIN,
    sourceProductId: id ?? base?.sourceProductId,
    salesText:
      salesText ??
      (monthlySales !== null
        ? `近30天销量 ${monthlySales}`
        : sales !== null
          ? `销量 ${sales}`
          : base?.salesText),
    rating:
      toNumber(
        raw['good_review_ratio'] ??
          raw['good_ratio'] ??
          raw['rating'] ??
          raw['positive_rate'],
      ) ??
      base?.rating ??
      null,
    region: null,
    regionNote:
      'EveryInfra 第三方数据服务；抖音价格标签与销量不代表当前用户最终结算条件',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}

export function mapDouyinDetail(
  input: unknown,
  base: NormalizedProduct,
): NormalizedProduct | null {
  return mapDouyinProduct(input, base, true);
}
