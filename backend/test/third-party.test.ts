import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sameProductSchema } from '../src/ai/same-product.schema';
import {
  ObservationSourceEnum,
  PlatformStatusEnum,
  PlatformTaskStatusEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
} from '../src/common/enums';
import {
  imageOverlap,
  isAmbiguousSameProduct,
  strongProductMatch,
  titleSimilarity,
} from '../src/common/utils/product-dedupe.util';
import { aggregatePlatformStatus } from '../src/common/utils/platform-status.util';
import { sanitizeRawData } from '../src/common/utils/sanitize.util';
import { mapQoviaData, mapQoviaProduct } from '../src/providers/douyin/qovia.mapper';
import {
  mapOkDataItems,
  mapOkDataProduct,
} from '../src/providers/xiaohongshu/okdata.mapper';

const qoviaPromotion = {
  product_id: '3633772266610903778',
  promotion_id: '3641755479459406882',
  base_info: {
    title: '【品牌正品】米之莲口红',
    main_img: {
      url_list: ['https://p3-aio.ecombdimg.com/obj/demo.jpg'],
    },
    detail_url:
      'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3633772266610903778',
  },
};

const qoviaSummary = {
  product_id: '3633772266610903778',
  promotion_id: '3641755479459406882',
  base_model: {
    product_info: {
      name: '【品牌正品】米之莲口红',
      detail_url:
        'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3633772266610903778',
      month_sale: { origin: 1669 },
      good_ratio: { origin: 94.8 },
    },
    marketing_info: {
      price_desc: {
        price: { origin: 2990, integer: '29', decimal: '9' },
        price_text: '到手价',
      },
    },
    shop_info: { shop_id: 113503652, shop_name: '喵妮美妆严选' },
  },
};

describe('Qovia mapper', () => {
  it('maps the official response shape with cents and price_text', () => {
    const result = mapQoviaData({
      promotions: [qoviaPromotion],
      summary_promotions: [qoviaSummary],
      has_more: true,
      total: 500,
      extra: { search_id: 'next-page' },
    });
    assert.equal(result.products.length, 1);
    assert.equal(result.hasMore, true);
    assert.equal(result.searchId, 'next-page');
    const product = result.products[0];
    assert.equal(product.platformProductId, '3633772266610903778');
    assert.equal(product.title, '【品牌正品】米之莲口红');
    assert.equal(product.shopName, '喵妮美妆严选');
    assert.equal(product.price?.amount, 29.9);
    assert.equal(product.price?.priceType, PriceTypeEnum.LISTING);
    assert.match(product.price?.note ?? '', /到手价/);
    assert.equal(product.providerKey, ProviderKeyEnum.QOVIA);
    assert.equal(product.source, ObservationSourceEnum.THIRD_PARTY_API);
    assert.match(product.regionNote ?? '', /中国大陆/);
    assert.equal(product.imageUrls[0], 'https://p3-aio.ecombdimg.com/obj/demo.jpg');
  });

  it('supports summary-only items and rejects missing title/id', () => {
    const product = mapQoviaProduct(undefined, qoviaSummary);
    assert.ok(product);
    assert.equal(mapQoviaProduct(undefined, { product_id: '1' }), null);
    assert.equal(mapQoviaProduct(undefined, { base_model: { product_info: { name: 'x' } } }), null);
  });
});

const okdataItem = {
  id: '6441fb9a6cd6140001acf7b4',
  url: 'https://www.xiaohongshu.com/goods-detail/6441fb9a6cd6140001acf7b4',
  title: '小型便携式手摇咖啡机 304 不锈钢磨豆机',
  price: 39.9,
  original_price: 49.9,
  currency: 'CNY',
  sold: 120,
  rating: 4.8,
  reviews: 20,
  images: ['https://cdn.example.com/product/1.jpg'],
  shop: { id: null, name: '轻装户外旗舰店', url: null },
};

describe('OKData mapper', () => {
  it('maps the documented Product object and preserves original price', () => {
    const product = mapOkDataProduct(okdataItem);
    assert.ok(product);
    assert.equal(product.platformProductId, okdataItem.id);
    assert.equal(product.shopName, '轻装户外旗舰店');
    assert.equal(product.price?.amount, 39.9);
    assert.equal(product.price?.currency, 'CNY');
    assert.equal(product.price?.priceType, PriceTypeEnum.LOWEST_SKU);
    assert.equal(product.price?.originalAmount, 49.9);
    assert.equal(product.originalPrice?.amount, 49.9);
    assert.equal(product.providerKey, ProviderKeyEnum.OKDATA);
    assert.equal(product.source, ObservationSourceEnum.THIRD_PARTY_API);
    assert.equal(product.region, 'overseas_app_view');
    assert.match(product.regionNote ?? '', /海外 App/);
    assert.equal(product.salesText, '销量 120');
  });

  it('returns null for incomplete products and filters a list', () => {
    assert.equal(mapOkDataProduct({ id: 'x' }), null);
    const items = mapOkDataItems([okdataItem, { id: 'missing-title' }]);
    assert.equal(items.length, 1);
  });
});

describe('product dedupe helpers', () => {
  const left = {
    platformProductId: '123',
    title: 'A系列 B贴纸 组合装',
    shopName: '示例文具店',
    productUrl: 'https://item.taobao.com/item.htm?id=123&spm=abc',
    imageUrls: ['https://img.example.com/a.jpg?x=1'],
  };

  it('matches by product id, normalized url and title+shop', () => {
    assert.equal(
      strongProductMatch(left, { ...left, productUrl: 'https://other.example.com/1' }),
      'strong:id',
    );
    assert.equal(
      strongProductMatch(left, {
        ...left,
        platformProductId: undefined,
        productUrl: 'https://item.taobao.com/item.htm?id=123',
      }),
      'strong:url',
    );
    assert.equal(
      strongProductMatch(left, {
        ...left,
        platformProductId: undefined,
        productUrl: 'https://other.example.com/2',
      }),
      'strong:title_shop',
    );
  });

  it('scores similar titles and overlapping images', () => {
    const similar = {
      platformProductId: '999',
      title: 'A系列 B贴纸组合装',
      shopName: '另一家文具店',
      productUrl: 'https://other.example.com/3',
      imageUrls: ['https://img.example.com/a.jpg'],
    };
    assert.ok(titleSimilarity(left.title, similar.title) >= 0.7);
    assert.equal(imageOverlap(left.imageUrls, similar.imageUrls), 1);
    assert.equal(isAmbiguousSameProduct(left, similar), true);
  });
});

describe('platform status aggregation', () => {
  const task = (status: PlatformTaskStatusEnum, resultCount = 0) => ({
    status,
    resultCount,
  });

  it('handles single-channel results', () => {
    assert.equal(
      aggregatePlatformStatus([task(PlatformTaskStatusEnum.SUCCESS, 2)]),
      PlatformStatusEnum.SUCCESS,
    );
    assert.equal(
      aggregatePlatformStatus([task(PlatformTaskStatusEnum.EMPTY)]),
      PlatformStatusEnum.EMPTY,
    );
    assert.equal(
      aggregatePlatformStatus([task(PlatformTaskStatusEnum.FAILED)]),
      PlatformStatusEnum.FAILED,
    );
    assert.equal(
      aggregatePlatformStatus([task(PlatformTaskStatusEnum.NOT_CONFIGURED)]),
      PlatformStatusEnum.NOT_CONFIGURED,
    );
  });

  it('marks incomplete dual-source results as PARTIAL_SUCCESS', () => {
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.SUCCESS, 2),
        task(PlatformTaskStatusEnum.NOT_CONFIGURED),
      ]),
      PlatformStatusEnum.PARTIAL_SUCCESS,
    );
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.SUCCESS, 2),
        task(PlatformTaskStatusEnum.EMPTY),
      ]),
      PlatformStatusEnum.PARTIAL_SUCCESS,
    );
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.SUCCESS, 2),
        task(PlatformTaskStatusEnum.FAILED),
      ]),
      PlatformStatusEnum.PARTIAL_SUCCESS,
    );
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.SUCCESS, 2),
        task(PlatformTaskStatusEnum.SUCCESS, 1),
      ]),
      PlatformStatusEnum.SUCCESS,
    );
  });

  it('reports running before terminal states', () => {
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.RUNNING),
        task(PlatformTaskStatusEnum.SUCCESS, 1),
      ]),
      PlatformStatusEnum.RUNNING,
    );
  });

  it('reports cancelled platforms and keeps completed channel data', () => {
    assert.equal(
      aggregatePlatformStatus([task(PlatformTaskStatusEnum.CANCELLED)]),
      PlatformStatusEnum.CANCELLED,
    );
    assert.equal(
      aggregatePlatformStatus([
        task(PlatformTaskStatusEnum.SUCCESS, 2),
        task(PlatformTaskStatusEnum.CANCELLED),
      ]),
      PlatformStatusEnum.CANCELLED,
    );
  });
});

describe('same-product schema', () => {
  it('accepts SAME/DIFFERENT/UNCERTAIN and rejects out-of-range confidence', () => {
    assert.equal(
      sameProductSchema.parse({
        verdict: 'SAME',
        confidence: 0.9,
        reason: '商品 ID 与标题一致',
        evidence: ['product_id 相同'],
      }).verdict,
      'SAME',
    );
    assert.throws(() =>
      sameProductSchema.parse({
        verdict: 'SAME',
        confidence: 1.2,
        reason: 'x',
        evidence: [],
      }),
    );
  });
});

describe('sanitizeRawData', () => {
  it('redacts sensitive keys and caps arrays', () => {
    const result = sanitizeRawData({
      token: 'secret',
      nested: { cookie: 'cookie-value', keep: 'ok' },
      list: Array.from({ length: 60 }, (_, i) => i),
    }) as {
      token: string;
      nested: { cookie: string; keep: string };
      list: number[];
    };
    assert.equal(result.token, '[redacted]');
    assert.equal(result.nested.cookie, '[redacted]');
    assert.equal(result.nested.keep, 'ok');
    assert.equal(result.list.length, 50);
  });
});
