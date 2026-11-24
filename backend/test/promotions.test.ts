import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PlatformEnum,
  PlatformTaskStatusEnum,
  PriceTypeEnum,
  PromotionTypeEnum,
  SearchRunStatusEnum,
} from '../src/common/enums';
import {
  dedupePromotions,
  parseDiscountRate,
  parsePromotionEntries,
  parsePromotionTime,
} from '../src/common/utils/promotion.util';
import { computeRunOutcome } from '../src/common/utils/run-status.util';
import { mapTaobaoProduct } from '../src/providers/everyinfra/mappers/taobao.mapper';
import { mapAlibaba1688Product } from '../src/providers/everyinfra/mappers/alibaba1688.mapper';

describe('promotion parsing utilities', () => {
  it('normalizes discount text without guessing unknown values', () => {
    assert.equal(parseDiscountRate('8.5折'), 0.85);
    assert.equal(parseDiscountRate('85%'), 0.85);
    assert.equal(parseDiscountRate(0.8), 0.8);
    assert.equal(parseDiscountRate(8), 0.8);
    assert.equal(parseDiscountRate('满20减3'), null);
    assert.equal(parseDiscountRate(null), null);
  });

  it('parses epoch seconds, millis and common date strings', () => {
    const fromSeconds = parsePromotionTime(1763596800);
    const fromMillis = parsePromotionTime(1763596800000);
    assert.ok(fromSeconds);
    assert.equal(fromSeconds, fromMillis);
    assert.ok(fromSeconds.endsWith('Z'));
    assert.ok(parsePromotionTime('2026-11-20 00:00:00'));
    assert.equal(parsePromotionTime('not-a-date'), null);
  });

  it('parses coupons and activities, keeping missing fields null', () => {
    const promotions = parsePromotionEntries(
      [
        {
          coupon_name: '店铺券',
          discount_amount: '3',
          minimum_spend: '20',
          start_time: '2026-11-20 00:00:00',
          end_time: '2026-11-30 23:59:59',
          coupon_url: 'https://example.com/coupon',
          type: 'shop_coupon',
        },
        { title: '平台活动', type: 'platform_activity', rule: '跨店满减' },
        { nothing: true },
      ],
      { fallbackType: PromotionTypeEnum.COUPON, currency: 'CNY' },
    );
    assert.equal(promotions.length, 2);
    assert.equal(promotions[0].promotionType, PromotionTypeEnum.COUPON);
    assert.equal(promotions[0].amount, 3);
    assert.equal(promotions[0].minimumSpend, 20);
    assert.equal(promotions[0].currency, 'CNY');
    assert.ok(promotions[0].startTime);
    assert.equal(promotions[1].promotionType, PromotionTypeEnum.PLATFORM_ACTIVITY);
    assert.equal(promotions[1].amount, null);
    assert.equal(promotions[1].description, '跨店满减');
  });

  it('does not turn descriptive text into a numeric amount', () => {
    const promotions = parsePromotionEntries(
      [{ coupon_name: '文本券', value: '满20减3' }],
      { fallbackType: PromotionTypeEnum.COUPON, currency: 'CNY' },
    );
    assert.equal(promotions.length, 1);
    assert.equal(promotions[0].amount, null);
    assert.equal(promotions[0].description, null);
  });

  it('treats a date-only end time as the end of that day', () => {
    const promotions = parsePromotionEntries(
      [{ coupon_name: '当日券', coupon_amount: 3, end_time: '2026-11-20' }],
      { fallbackType: PromotionTypeEnum.COUPON, currency: 'CNY' },
    );
    assert.ok(promotions[0].endTime);
    const end = new Date(promotions[0].endTime!);
    assert.equal(end.getFullYear(), 2026);
    assert.equal(end.getMonth(), 10);
    assert.equal(end.getDate(), 20);
    assert.equal(end.getHours(), 23);
  });

  it('keeps 1688 plain-text promotions and summary rules', () => {
    const promotions = parsePromotionEntries(
      [
        '满100减5',
        { name: '店铺满减', type: 'shop', summary: '满300减20' },
      ],
      { fallbackType: PromotionTypeEnum.OTHER, currency: 'CNY', acceptPlainText: true },
    );
    assert.equal(promotions.length, 2);
    assert.equal(promotions[0].name, '满100减5');
    assert.equal(promotions[0].description, '满100减5');
    assert.equal(promotions[1].promotionType, PromotionTypeEnum.SHOP_ACTIVITY);
    assert.equal(promotions[1].description, '满300减20');
  });

  it('dedupes identical promotions within one capture only', () => {
    const base = {
      promotionType: PromotionTypeEnum.COUPON,
      name: '满20减3',
      amount: 3,
      minimumSpend: 20,
    };
    assert.equal(dedupePromotions([base, { ...base }]).length, 1);
    assert.equal(
      dedupePromotions([base, { ...base, amount: 5 }]).length,
      2,
    );
  });
});

describe('Taobao coupon mapping', () => {
  it('keeps listing price and coupon price separate', () => {
    const product = mapTaobaoProduct({
      item_id: 1,
      title: '造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=1',
      price: '9.90',
      coupon_price: '7.90',
      price_note: '页面现价',
    });
    assert.ok(product);
    assert.equal(product.platform, PlatformEnum.TAOBAO);
    assert.equal(product.price?.amount, 9.9);
    assert.equal(product.couponPrice?.amount, 7.9);
    assert.equal(product.couponPrice?.priceType, PriceTypeEnum.COUPON_PRICE);
    assert.match(product.price?.note ?? '', /页面现价/);
  });

  it('does not treat an equal or higher coupon_price as after-coupon price', () => {
    const product = mapTaobaoProduct({
      item_id: 2,
      title: '造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=2',
      price: '9.90',
      coupon_price: '9.90',
    });
    assert.ok(product);
    assert.equal(product.couponPrice, null);
  });

  it('records structured coupon amount and threshold without deducting it', () => {
    const product = mapTaobaoProduct({
      item_id: 3,
      title: '造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=3',
      price: '20.00',
      coupon_amount: '3',
      coupon_condition: '20',
      coupon_name: '店铺券',
      coupon_end_time: '2026-11-30 23:59:59',
    });
    assert.ok(product);
    assert.equal(product.price?.amount, 20);
    assert.equal(product.promotions?.length, 1);
    assert.equal(product.promotions?.[0].promotionType, PromotionTypeEnum.COUPON);
    assert.equal(product.promotions?.[0].amount, 3);
    assert.equal(product.promotions?.[0].minimumSpend, 20);
    assert.equal(product.price?.amount, 20);
  });

  it('does not fabricate a coupon amount from descriptive coupon text', () => {
    const product = mapTaobaoProduct({
      item_id: 30,
      title: '造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=30',
      price: '20.00',
      coupon_amount: '满20减3',
    });
    assert.ok(product);
    assert.equal(product.promotions?.length ?? 0, 0);
    assert.equal(product.price?.amount, 20);
  });

  it('maps SKU-level coupon_price only on that SKU', () => {
    const product = mapTaobaoProduct({
      item_id: 4,
      title: '造景贴纸',
      url: 'https://item.taobao.com/item.htm?id=4',
      price: '9.90',
      skus: [
        { sku_id: 'a', name: 'A 款', price: '9.90', coupon_price: '8.90' },
        { sku_id: 'b', name: 'B 款', price: '12.00', coupon_price: '15.00' },
      ],
    });
    assert.ok(product);
    assert.equal(product.skuOptions[0].couponPrice, 8.9);
    assert.equal(product.skuOptions[1].couponPrice, undefined);
  });
});

describe('1688 coupon and activity mapping', () => {
  it('parses coupons with thresholds and validity without touching wholesale price', () => {
    const product = mapAlibaba1688Product({
      id: 'offer-1',
      title: '造景贴纸批发',
      url: 'https://detail.1688.com/offer/offer-1.html',
      price_min: 0.5,
      price_max: 1.2,
      currency: 'CNY',
      unit: '件',
      min_order_quantity: 100,
      coupons: [
        {
          coupon_name: '满100减5',
          discount_amount: 5,
          minimum_spend: 100,
          start_time: '2026-11-20 00:00:00',
          end_time: '2026-11-30 23:59:59',
          coupon_url: 'https://example.com/c/1',
          type: 'shop_coupon',
        },
        {
          coupon_name: '满200减12',
          discount_amount: 12,
          minimum_spend: 200,
        },
      ],
      promotion_details: [
        {
          activity_name: '平台采购节',
          type: 'platform_activity',
          rule: '满300减20',
          discount_amount: 20,
          minimum_spend: 300,
        },
      ],
    });
    assert.ok(product);
    assert.equal(product.wholesalePrice?.priceMin, 0.5);
    assert.equal(product.promotions?.length, 3);
    assert.equal(product.promotions?.[0].promotionType, PromotionTypeEnum.COUPON);
    assert.equal(product.promotions?.[0].amount, 5);
    assert.equal(product.promotions?.[0].minimumSpend, 100);
    assert.equal(
      product.promotions?.some(
        (item) => item.promotionType === PromotionTypeEnum.PLATFORM_ACTIVITY,
      ),
      true,
    );
    assert.equal(product.price, undefined);
  });

  it('ignores malformed coupon entries instead of inventing values', () => {
    const product = mapAlibaba1688Product({
      id: 'offer-2',
      title: '造景贴纸批发',
      url: 'https://detail.1688.com/offer/offer-2.html',
      coupons: [{}, 'bad', null],
    });
    assert.ok(product);
    assert.deepEqual(product.promotions, []);
  });
});

describe('run outcome status', () => {
  const task = (
    platform: string,
    status: PlatformTaskStatusEnum,
    errorCode: string | null = null,
  ) => ({ platform, status, errorCode });

  it('marks a run completed when every platform produced usable results', () => {
    const outcome = computeRunOutcome([
      task('taobao', PlatformTaskStatusEnum.SUCCESS),
      task('douyin', PlatformTaskStatusEnum.EMPTY),
    ]);
    assert.equal(outcome.status, SearchRunStatusEnum.COMPLETED);
    assert.equal(outcome.errorMessage, null);
  });

  it('marks a run partial when some platforms fail', () => {
    const outcome = computeRunOutcome([
      task('taobao', PlatformTaskStatusEnum.SUCCESS),
      task('alibaba1688', PlatformTaskStatusEnum.FAILED, 'EVERYINFRA_TIMEOUT'),
    ]);
    assert.equal(outcome.status, SearchRunStatusEnum.PARTIAL);
    assert.match(outcome.errorMessage ?? '', /alibaba1688/);
  });

  it('marks a run failed when every platform is unusable', () => {
    const outcome = computeRunOutcome([
      task('taobao', PlatformTaskStatusEnum.FAILED, 'EVERYINFRA_API_ERROR'),
      task('douyin', PlatformTaskStatusEnum.NOT_CONFIGURED),
    ]);
    assert.equal(outcome.status, SearchRunStatusEnum.FAILED);
    assert.match(outcome.errorMessage ?? '', /所有平台/);
  });

  it('treats a platform with one usable fallback channel as usable', () => {
    const outcome = computeRunOutcome([
      task('taobao', PlatformTaskStatusEnum.FAILED, 'EVERYINFRA_API_ERROR'),
      task('taobao', PlatformTaskStatusEnum.SUCCESS),
    ]);
    assert.equal(outcome.status, SearchRunStatusEnum.COMPLETED);
  });
});
