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

/** 搜索结果中可能混入笔记；笔记绝不能当作商品。 */
function isNote(raw: Record<string, unknown>): boolean {
  if (firstString(raw, ['note_id']) !== null) return true;
  const type = firstString(raw, ['type', 'content_type', 'item_type']);
  if (type !== null && /note|explore/i.test(type)) return true;
  const url = firstString(raw, ['url', 'detail_url', 'product_url', 'goods_url']);
  return Boolean(url && /\/explore\//i.test(url));
}

function xiaohongshuUrl(
  id: string | null,
  raw: Record<string, unknown>,
): string | null {
  return (
    toHttpUrl(
      firstString(raw, ['url', 'detail_url', 'product_url', 'goods_url', 'link']),
    ) ??
    (id
      ? `https://www.xiaohongshu.com/goods-detail/${encodeURIComponent(id)}`
      : null)
  );
}

export function mapXiaohongshuProduct(
  input: unknown,
  base: NormalizedProduct | null = null,
  fromDetail = false,
): NormalizedProduct | null {
  const raw = unwrapProduct(input);
  if (!raw || isNote(raw)) return null;

  const id = firstString(raw, ['product_id', 'goods_id', 'id']);
  const title =
    firstString(raw, ['title', 'name', 'product_name']) ?? base?.title ?? null;
  const productUrl =
    xiaohongshuUrl(id, raw) ?? base?.productUrl ?? null;
  if (!id || !title || !productUrl) return null;

  const observedAt = nowIso();
  // 币种为 null 时不能假设人民币；buildRetailPrice 会显示“币种未知”。
  const currency = normalizeCurrency(raw['currency']);
  const amount = toPositivePrice(
    raw['current_price'] ?? raw['price'] ?? raw['sale_price'],
  );
  const originalAmount = meaningfulOriginal(
    amount,
    toPositivePrice(
      raw['original_price'] ?? raw['market_price'] ?? raw['list_price'],
    ),
  );
  const stock = firstString(raw, ['stock_status', 'stock_text', 'availability']) ??
    (typeof raw['in_stock'] === 'boolean'
      ? raw['in_stock']
        ? '有货'
        : '缺货'
      : null);
  const price =
    amount !== null || originalAmount !== null || currency !== null
      ? buildRetailPrice({
          amount,
          currency,
          source: 'everyinfra_xiaohongshu',
          priceType: PriceTypeEnum.LOWEST_SKU,
          originalAmount,
          observedAt,
          note: [
            stock ? `库存状态：${stock}` : null,
            fromDetail
              ? 'EveryInfra 小红书详情价格，未确认是否为目标 SKU'
              : 'EveryInfra 小红书商品搜索现价，未确认是否为目标 SKU',
          ]
            .filter(Boolean)
            .join('；'),
        })
      : undefined;

  const shopRecord = asRecord(raw['shop']);
  const images = [
    ...collectUrls(raw['images']),
    ...collectUrls(raw['image_urls']),
    ...collectUrls(raw['image_url']),
    ...collectUrls(raw['main_image']),
    ...collectUrls(raw['cover']),
    ...collectUrls(raw['description_images']),
    ...collectUrls(raw['detail_image_urls']),
    ...(base?.imageUrls ?? []),
  ];
  const skuList = mapSkuOptions(
    raw['skus'] ?? raw['sku'] ?? raw['specs'] ?? raw['sku_list'],
  );
  const variantName = firstString(raw, ['variant_name', 'sku_name']);
  const skus =
    skuList.length > 0
      ? skuList
      : variantName
        ? [{ name: variantName }]
        : [];
  const attributes = raw['attributes'] ?? raw['props'];

  return {
    platform: PlatformEnum.XIAOHONGSHU,
    platformProductId: id ?? base?.platformProductId,
    title,
    shopName:
      firstString(shopRecord, ['name', 'shop_name', 'title']) ??
      firstString(raw, ['shop_name', 'seller_name']) ??
      base?.shopName ??
      undefined,
    productUrl,
    imageUrls: [...new Set(images)].slice(0, 10),
    description:
      firstString(raw, ['description', 'desc', 'text', 'detail']) ??
      (attributes !== undefined
        ? `商品属性：${JSON.stringify(attributes).slice(0, 2000)}`
        : undefined) ??
      base?.description,
    skuOptions: skus.length > 0 ? skus : (base?.skuOptions ?? []),
    price: price ?? base?.price,
    originalPrice: base?.originalPrice ?? null,
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.EVERYINFRA_XIAOHONGSHU,
    sourceProductId: id ?? base?.sourceProductId,
    salesText:
      toNumber(raw['sold_count'] ?? raw['sold'] ?? raw['sales']) !== null
        ? `销量 ${toNumber(raw['sold_count'] ?? raw['sold'] ?? raw['sales'])}`
        : base?.salesText,
    rating: toNumber(raw['rating']) ?? base?.rating ?? null,
    region: null,
    regionNote:
      'EveryInfra 第三方数据服务；仅收录商城商品，笔记类结果不会入库',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}

export function mapXiaohongshuDetail(
  input: unknown,
  base: NormalizedProduct,
): NormalizedProduct | null {
  return mapXiaohongshuProduct(input, base, true);
}
