import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classificationResultSchema, parseJsonObject } from '../src/ai/ai.schema';
import { PriceTypeEnum } from '../src/common/enums';
import { normalizeProductUrl, toHttpUrl } from '../src/common/utils/url.util';
import { parseVisiblePrice } from '../src/providers/shared/browser-price';

describe('toHttpUrl', () => {
  it('keeps https urls', () => {
    assert.equal(
      toHttpUrl('https://img.alicdn.com/a.jpg'),
      'https://img.alicdn.com/a.jpg',
    );
  });

  it('normalizes protocol-relative urls', () => {
    assert.equal(toHttpUrl('//img.alicdn.com/a.jpg'), 'https://img.alicdn.com/a.jpg');
  });

  it('rejects non-http and empty values', () => {
    assert.equal(toHttpUrl('javascript:alert(1)'), null);
    assert.equal(toHttpUrl(''), null);
    assert.equal(toHttpUrl(undefined), null);
  });
});

describe('normalizeProductUrl', () => {
  it('drops tracking params and hashes', () => {
    assert.equal(
      normalizeProductUrl('https://item.taobao.com/item.htm?id=1&spm=abc#x'),
      'https://item.taobao.com/item.htm?id=1',
    );
  });

  it('keeps meaningful query params', () => {
    assert.equal(
      normalizeProductUrl('https://mobile.yangkeduo.com/goods.html?goods_id=42'),
      'https://mobile.yangkeduo.com/goods.html?goods_id=42',
    );
  });

  it('returns the original string when parsing fails', () => {
    assert.equal(normalizeProductUrl('not a url'), 'not a url');
  });
});

describe('parseJsonObject', () => {
  it('parses plain JSON', () => {
    assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  });

  it('parses fenced JSON', () => {
    assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  });

  it('parses JSON surrounded by prose', () => {
    assert.deepEqual(parseJsonObject('结果如下：{"a":1} 谢谢'), { a: 1 });
  });

  it('throws for non-JSON text', () => {
    assert.throws(() => parseJsonObject('not json'));
  });
});

describe('parseVisiblePrice', () => {
  it('parses a plain listing price', () => {
    const price = parseVisiblePrice('A系列 B贴纸 ¥9.90', 'test');
    assert.equal(price.amount, 9.9);
    assert.equal(price.priceType, PriceTypeEnum.LISTING);
    assert.equal(price.displayText, '¥9.90');
  });

  it('reports a price range without picking a single amount', () => {
    const price = parseVisiblePrice('¥5.00-¥10.00', 'test');
    assert.equal(price.amount, null);
    assert.equal(price.priceType, PriceTypeEnum.UNKNOWN);
    assert.equal(price.displayText, '¥5.00–¥10.00');
  });

  it('marks a starting price as LOWEST_SKU', () => {
    const price = parseVisiblePrice('¥5.00 起', 'test');
    assert.equal(price.amount, 5);
    assert.equal(price.priceType, PriceTypeEnum.LOWEST_SKU);
    assert.equal(price.displayText, '¥5.00 起');
  });

  it('does not treat a coupon/activity price as the normal price', () => {
    const price = parseVisiblePrice('券后 ¥8.00', 'test');
    assert.equal(price.amount, null);
    assert.equal(price.priceType, PriceTypeEnum.UNKNOWN);
    assert.match(price.note ?? '', /券后/);
  });

  it('returns null amount when no price is visible', () => {
    const price = parseVisiblePrice('暂无价格', 'test');
    assert.equal(price.amount, null);
    assert.equal(price.priceType, PriceTypeEnum.UNKNOWN);
  });
});

describe('classificationResultSchema', () => {
  const valid = {
    matchStatus: 'MATCH',
    matchType: 'CONTAINS_TARGET_BUNDLE',
    confidence: 0.96,
    productContentSummary: '商品包含 B 和 C',
    matchedContents: ['B', 'C'],
    matchedSkuIds: ['sku-2'],
    skuDecisions: [
      { skuId: 'sku-2', matchStatus: 'MATCH', reason: 'SKU 名称包含 B+C' },
    ],
    evidence: ['标题包含 B+C 组合'],
    reason: '商品内容明确包含目标贴纸',
    needsManualReview: false,
  };

  it('accepts a valid AI result', () => {
    assert.equal(classificationResultSchema.parse(valid).matchType, 'CONTAINS_TARGET_BUNDLE');
  });

  it('rejects out-of-range confidence', () => {
    assert.throws(() => classificationResultSchema.parse({ ...valid, confidence: 1.5 }));
  });

  it('rejects unknown match type', () => {
    assert.throws(() =>
      classificationResultSchema.parse({ ...valid, matchType: 'SOMETHING_ELSE' }),
    );
  });

  it('allows null matchType', () => {
    assert.equal(
      classificationResultSchema.parse({ ...valid, matchStatus: 'UNCERTAIN', matchType: null })
        .matchType,
      null,
    );
  });
});
