import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../../common/enums';
import { NormalizedProduct } from '../../../common/interfaces/normalized-product.interface';
import { SkuOption } from '../../../common/interfaces/price.interface';
import {
  PriceTier,
  WholesalePriceInfo,
} from '../../../common/interfaces/wholesale-price.interface';
import { nowIso } from '../../../common/utils/date.util';
import { toHttpUrl } from '../../../common/utils/url.util';
import {
  asRecord,
  collectUrls,
  firstString,
  mapSkuOptions,
  normalizeCurrency,
  toNumber,
  toPositivePrice,
  unwrapProduct,
} from './mapper.util';

function offerUrl(id: string | null, raw: Record<string, unknown>): string | null {
  return (
    toHttpUrl(firstString(raw, ['url', 'detail_url', 'product_url', 'offer_url'])) ??
    (id ? `https://detail.1688.com/offer/${encodeURIComponent(id)}.html` : null)
  );
}

/**
 * price_tiers 的字段名以官方文档的 min_quantity 为准；
 * 同时兼容 minQuantity 形式，未知结构不会自行推算。
 */
export function parsePriceTiers(value: unknown): PriceTier[] {
  if (!Array.isArray(value)) return [];
  const tiers = new Map<number, PriceTier>();
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const minQuantity = toNumber(
      record['min_quantity'] ??
        record['minQuantity'] ??
        record['min_qty'] ??
        record['start_quantity'] ??
        record['quantity'],
    );
    const price = toPositivePrice(
      record['price'] ?? record['unit_price'] ?? record['price_per_unit'],
    );
    if (minQuantity === null || minQuantity <= 0 || price === null) continue;
    tiers.set(minQuantity, { minQuantity, price });
  }
  return [...tiers.values()]
    .sort((a, b) => a.minQuantity - b.minQuantity)
    .slice(0, 30);
}

function buildWholesaleInfo(raw: Record<string, unknown>): WholesalePriceInfo | null {
  const priceMin = toPositivePrice(raw['price_min'] ?? raw['min_price']);
  const priceMax = toPositivePrice(raw['price_max'] ?? raw['max_price']);
  const currency = normalizeCurrency(raw['currency']);
  const unit = firstString(raw, ['unit', 'price_unit', 'unit_name']);
  const moq = toNumber(
    raw['min_order_quantity'] ??
      raw['minOrderQuantity'] ??
      raw['min_qty'] ??
      raw['moq'],
  );
  const tiers = parsePriceTiers(raw['price_tiers'] ?? raw['priceTiers']);

  if (
    priceMin === null &&
    priceMax === null &&
    currency === null &&
    unit === null &&
    moq === null &&
    tiers.length === 0
  ) {
    return null;
  }

  const facts: string[] = [];
  const orderCount = toNumber(raw['order_count']);
  if (orderCount !== null) facts.push(`订单数 ${orderCount}`);
  const soldCount = toNumber(raw['sold_count']);
  if (soldCount !== null) facts.push(`成交 ${soldCount}`);
  const stock = toNumber(raw['stock']);
  if (stock !== null) facts.push(`库存 ${stock}`);
  const repurchaseRate = toNumber(raw['repurchase_rate']);
  if (repurchaseRate !== null) facts.push(`复购率 ${repurchaseRate}`);
  if (raw['is_out_of_stock'] === true) facts.push('当前缺货');
  if (raw['supports_dropship'] === true) facts.push('支持一件代发');
  if (raw['supports_sampling'] === true) facts.push('支持拿样');
  const mix = asRecord(raw['mix_wholesale']);
  const mixAmount = toNumber(mix?.['min_amount']);
  if (mixAmount !== null) {
    const varieties = toNumber(mix?.['min_varieties']);
    facts.push(
      `混批：满 ${normalizeCurrency(raw['currency']) === 'CNY' ? '¥' : ''}${mixAmount}${
        varieties !== null ? `，${varieties} 款起` : ''
      }`,
    );
  }
  const shipping = asRecord(raw['shipping']);
  if (shipping) {
    if (shipping['is_free_shipping'] === true) {
      facts.push('免运费');
    } else {
      const fee = toNumber(shipping['fee']);
      if (fee !== null) facts.push(`运费 ¥${fee}`);
    }
    const dispatch = firstString(shipping, ['dispatch_text', 'logistics_text']);
    if (dispatch) facts.push(dispatch);
  }

  return {
    priceMin,
    priceMax,
    currency,
    unit,
    minOrderQuantity: moq,
    priceTiers: tiers,
    note: facts.length > 0 ? facts.join('；') : null,
  };
}

function specsToSkuOptions(value: unknown): SkuOption[] {
  if (Array.isArray(value)) {
    const converted: SkuOption[] = [];
    for (const entry of value) {
      const record = asRecord(entry);
      if (record) {
        const name = firstString(record, ['name', 'spec_name', 'sku_name', 'title']);
        const specValue = firstString(record, ['value', 'spec_value', 'text']);
        if (name && specValue) {
          converted.push({ name: `${name}：${specValue}` });
          continue;
        }
      }
      converted.push(...mapSkuOptions([entry]));
    }
    return converted.slice(0, 100);
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record)
      .filter(([, specValue]) => specValue !== null && specValue !== undefined)
      .map(([name, specValue]) => ({
        name: `${name}：${String(specValue)}`,
      }))
      .slice(0, 100);
  }
  return [];
}

export function mapAlibaba1688Product(
  input: unknown,
  base: NormalizedProduct | null = null,
): NormalizedProduct | null {
  const raw = unwrapProduct(input);
  if (!raw) return null;

  const id = firstString(raw, ['id', 'offer_id', 'offerId', 'product_id']);
  const title =
    firstString(raw, ['title', 'name', 'subject']) ?? base?.title ?? null;
  const productUrl = offerUrl(id, raw) ?? base?.productUrl ?? null;
  if (!title || !productUrl) return null;

  const observedAt = nowIso();
  const wholesalePrice = buildWholesaleInfo(raw) ?? base?.wholesalePrice ?? null;
  const images = [
    ...collectUrls(raw['images']),
    ...collectUrls(raw['image_urls']),
    ...collectUrls(raw['image_url']),
    ...collectUrls(raw['main_image']),
    ...collectUrls(raw['description_images']),
    ...(base?.imageUrls ?? []),
  ];
  const skuList = mapSkuOptions(raw['skus'] ?? raw['sku_list']);
  const specs =
    skuList.length > 0
      ? skuList
      : specsToSkuOptions(raw['specs']);
  const orderCount = toNumber(raw['order_count']);
  const soldCount = toNumber(raw['sold_count']);
  const region = [firstString(raw, ['province']), firstString(raw, ['city'])]
    .filter(Boolean)
    .join(' ');

  return {
    platform: PlatformEnum.ALIBABA1688,
    platformProductId: id ?? base?.platformProductId,
    title,
    shopName:
      firstString(raw, ['supplier_name', 'company_name', 'shop_name']) ??
      base?.shopName ??
      undefined,
    productUrl,
    imageUrls: [...new Set(images)].slice(0, 10),
    description:
      firstString(raw, ['text', 'description', 'detail']) ?? base?.description,
    skuOptions: specs.length > 0 ? specs : (base?.skuOptions ?? []),
    // 1688 只有批发采购价，不能写入通用零售 price。
    price: base?.price,
    originalPrice: base?.originalPrice ?? null,
    wholesalePrice,
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.EVERYINFRA_ALIBABA1688,
    sourceProductId: id ?? base?.sourceProductId,
    salesText:
      orderCount !== null
        ? `订单数 ${orderCount}`
        : soldCount !== null
          ? `成交 ${soldCount}`
          : base?.salesText,
    rating: base?.rating ?? null,
    region: region || null,
    regionNote:
      '1688 为批发采购平台：价格、起订量与阶梯价仅代表采购条件，不能当作零售价或跨平台零售价格排名',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}

export function mapAlibaba1688Detail(
  input: unknown,
  base: NormalizedProduct,
): NormalizedProduct | null {
  return mapAlibaba1688Product(input, base);
}

/** 1688 图片搜索返回字段较少，单独映射，rank 只表示本次结果顺序。 */
export function mapAlibaba1688ImageSearchItem(
  input: unknown,
): NormalizedProduct | null {
  const raw = unwrapProduct(input);
  if (!raw) return null;
  const id = firstString(raw, ['id', 'offer_id', 'offerId']);
  const title = firstString(raw, ['title', 'name']);
  const productUrl = offerUrl(id, raw);
  if (!id || !title || !productUrl) return null;
  const observedAt = nowIso();
  const currency = normalizeCurrency(raw['currency']);
  const price = toPositivePrice(raw['price']);
  const moq = toNumber(raw['min_order_quantity'] ?? raw['minOrderQuantity']);
  const supplier = firstString(raw, ['supplier_name', 'company_name']);
  const rank = toNumber(raw['rank']);

  return {
    platform: PlatformEnum.ALIBABA1688,
    platformProductId: id,
    title,
    shopName: supplier ?? undefined,
    productUrl,
    imageUrls: collectUrls(raw['image_url']).slice(0, 10),
    skuOptions: [],
    wholesalePrice: {
      priceMin: price,
      priceMax: null,
      currency,
      unit: null,
      minOrderQuantity: moq,
      priceTiers: [],
      note:
        rank !== null
          ? `图搜结果序号 ${rank}（不代表销量排名）；图搜只返回单个价格字段，未返回价格区间`
          : '图搜候选，采购条件以商品详情页为准',
    },
    sourceType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    providerKey: ProviderKeyEnum.EVERYINFRA_ALIBABA1688,
    sourceProductId: id,
    salesText:
      toNumber(raw['order_count']) !== null
        ? `订单数 ${toNumber(raw['order_count'])}`
        : undefined,
    region: null,
    regionNote:
      '1688 图搜仅返回最多 5 个候选；rank 是本次结果顺序，不是销量排名',
    collectedAt: observedAt,
    rawData: { ...raw },
  };
}
