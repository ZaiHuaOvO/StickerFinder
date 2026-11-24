import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  PromotionTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../../common/enums';
import { NormalizedProduct } from '../../../common/interfaces/normalized-product.interface';
import { PromotionInfo } from '../../../common/interfaces/promotion.interface';
import { nowIso } from '../../../common/utils/date.util';
import {
  dedupePromotions,
  parsePromotionAmount,
  parsePromotionEntries,
  parsePromotionTime,
} from '../../../common/utils/promotion.util';
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
  list: '页面标价',
  promotion: '推广价',
  coupon: '券后价',
  activity: '活动价',
};

function priceBasisLabel(value: string | null): string | null {
  if (!value) return null;
  const label = PRICE_BASIS_LABELS[value.trim().toLowerCase()];
  return label ? `${label}（${value}）` : value;
}

/** 只保留优惠相关的原始键，不复制整个商品响应。 */
function couponRawFields(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.toLowerCase().includes('coupon')) result[key] = value;
  }
  return result;
}

/**
 * 淘宝旧式单券字段（coupon_amount 等）。
 * 只有接口明确返回了金额或名称时才生成，不从标题/价格推算。
 */
function legacyProductCoupons(
  raw: Record<string, unknown>,
  currency: string | null,
): PromotionInfo[] {
  const amount = parsePromotionAmount(
    raw['coupon_amount'] ?? raw['coupon_value'] ?? raw['coupon_money'],
  );
  const name = firstString(raw, ['coupon_name', 'coupon_title']);
  if (amount === null && !name) return [];
  return [
    {
      skuId: null,
      promotionType: PromotionTypeEnum.COUPON,
      name: name ?? '优惠券',
      amount,
      currency,
      minimumSpend: parsePromotionAmount(
        raw['coupon_condition'] ??
          raw['coupon_threshold'] ??
          raw['coupon_start_fee'],
      ),
      startTime: parsePromotionTime(
        raw['coupon_start_time'] ?? raw['coupon_start'],
      ),
      endTime: parsePromotionTime(raw['coupon_end_time'] ?? raw['coupon_end']),
      description: firstString(raw, [
        'coupon_desc',
        'coupon_rule',
        'coupon_condition_text',
      ]),
      promotionUrl: firstString(raw, ['coupon_url', 'coupon_link', 'coupon_share_url']),
      rawData: couponRawFields(raw),
    },
  ];
}

/** SKU 维度的券字段；只挂在对应 SKU 上，不复制成商品级优惠。 */
function skuCoupons(
  raw: Record<string, unknown>,
  currency: string | null,
): PromotionInfo[] {
  const skus = raw['skus'] ?? raw['sku_list'] ?? raw['sku'];
  if (!Array.isArray(skus)) return [];
  const result: PromotionInfo[] = [];
  for (const entry of skus.slice(0, 100)) {
    const record = asRecord(entry);
    if (!record) continue;
    const skuId = firstString(record, ['sku_id', 'skuId', 'id']);
    const amount = parsePromotionAmount(
      record['coupon_amount'] ?? record['coupon_value'],
    );
    const name = firstString(record, ['coupon_name', 'coupon_title']);
    if (amount === null && !name) continue;
    result.push({
      skuId,
      promotionType: PromotionTypeEnum.COUPON,
      name: name ?? '优惠券',
      amount,
      currency,
      minimumSpend: parsePromotionAmount(
        record['coupon_condition'] ??
          record['coupon_threshold'] ??
          record['coupon_start_fee'],
      ),
      startTime: parsePromotionTime(
        record['coupon_start_time'] ?? record['coupon_start'],
      ),
      endTime: parsePromotionTime(record['coupon_end_time'] ?? record['coupon_end']),
      description: firstString(record, [
        'coupon_desc',
        'coupon_rule',
        'coupon_condition_text',
      ]),
      promotionUrl: firstString(record, ['coupon_url', 'coupon_link']),
      rawData: couponRawFields(record),
    });
  }
  return result;
}

function taobaoPromotions(
  raw: Record<string, unknown>,
  currency: string | null,
): PromotionInfo[] {
  const fromList = parsePromotionEntries(
    raw['coupons'] ?? raw['coupon_list'] ?? raw['promotions'],
    { fallbackType: PromotionTypeEnum.COUPON, currency },
  );
  const result = [
    ...fromList,
    ...legacyProductCoupons(raw, currency),
    ...skuCoupons(raw, currency),
  ];
  // 真实接口会返回 discount_type（例如“优惠促销”），但没有金额/门槛；
  // 只记录接口给出的类型名称，不补任何数值。
  const discountType = firstString(raw, ['discount_type']);
  if (discountType) {
    result.push({
      skuId: null,
      promotionType: PromotionTypeEnum.DISCOUNT,
      name: discountType,
      amount: null,
      currency,
      discountRate: null,
      minimumSpend: null,
      startTime: null,
      endTime: null,
      description: null,
      promotionUrl: null,
      rawData: { discount_type: discountType },
    });
  }
  return result;
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
  const priceNote = firstString(raw, [
    'price_note',
    'price_description',
    'price_tip',
  ]);
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
            priceNote,
            stock !== null ? `库存 ${stock}` : null,
          ]
            .filter(Boolean)
            .join('；'),
        })
      : undefined;

  // 券后价必须由接口明确返回，且低于当前展示价；否则不展示，避免把券面额当成价格。
  const couponAmount = toPositivePrice(
    raw['coupon_price'] ?? raw['coupon_price_cny'] ?? raw['after_coupon_price'],
  );
  const couponPrice =
    couponAmount !== null && amount !== null && couponAmount < amount
      ? buildRetailPrice({
          amount: couponAmount,
          currency,
          source: 'everyinfra_taobao',
          priceType: PriceTypeEnum.COUPON_PRICE,
          observedAt,
          note: '接口明确返回的券后价；未与其他优惠叠加计算',
        })
      : null;

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
  const promotions = dedupePromotions(taobaoPromotions(raw, currency));

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
    // 观察记录只保存本次响应实际返回的优惠，不继承上一条记录，保证来源时间准确。
    couponPrice,
    promotions,
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
