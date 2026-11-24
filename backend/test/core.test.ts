import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classificationResultSchema, parseJsonObject } from '../src/ai/ai.schema';
import {
  PlatformStatusEnum,
  PlatformTaskStatusEnum,
  PriceTypeEnum,
} from '../src/common/enums';
import {
  decideManualVerification,
  isManualResolvableBlock,
} from '../src/common/utils/manual-verification.util';
import { aggregatePlatformStatus } from '../src/common/utils/platform-status.util';
import { normalizeProductUrl, toHttpUrl } from '../src/common/utils/url.util';
import { normalizeTargetText } from '../src/common/utils/text.util';
import { parseVisiblePrice } from '../src/providers/shared/browser-price';
import {
  buildXiaohongshuSearchUrls,
  classifyXiaohongshuSearch,
  isXiaohongshuGoodsUrl,
  isXiaohongshuNoteUrl,
} from '../src/providers/xiaohongshu/xiaohongshu-web';

describe('normalizeTargetText', () => {
  it('normalizes variant characters, spaces, full-width characters and case', () => {
    assert.equal(normalizeTargetText(' 姸莜 ２１.０ '), '妍莜21.0');
    assert.equal(normalizeTargetText('ABC　系列'), 'abc系列');
    assert.equal(normalizeTargetText(null), '');
  });
});

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
    candidateRelevance: 'HIGH',
    confidence: 0.96,
    categoryMatch: 'MATCH',
    seriesMatch: 'MATCH',
    targetItemMatch: 'MATCH',
    visualMatch: 'VISUAL_UNAVAILABLE',
    productContentSummary: '商品包含 B 和 C',
    matchedContents: ['B', 'C'],
    matchedSkuIds: ['sku-2'],
    skuDecisions: [
      { skuId: 'sku-2', matchStatus: 'MATCH', reason: 'SKU 名称包含 B+C' },
    ],
    evidence: [
      {
        sourceField: 'title',
        content: '标题包含 B+C 组合',
        interpretation: '标题明确列出组合内容',
      },
    ],
    reason: '商品内容明确包含目标贴纸',
    nextAction: 'NONE',
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

  it('rejects null matchType', () => {
    assert.throws(() =>
      classificationResultSchema.parse({ ...valid, matchType: null }),
    );
  });

  it('rejects legacy string evidence', () => {
    assert.throws(() =>
      classificationResultSchema.parse({ ...valid, evidence: ['标题包含 B+C 组合'] }),
    );
  });

  it('rejects unknown candidate relevance', () => {
    assert.throws(() =>
      classificationResultSchema.parse({ ...valid, candidateRelevance: 'VERY_HIGH' }),
    );
  });
});

describe('manual verification flow', () => {
  it('pauses for captcha/login but not for generic platform blocks', () => {
    assert.equal(isManualResolvableBlock('CAPTCHA_REQUIRED'), true);
    assert.equal(isManualResolvableBlock('LOGIN_REQUIRED'), true);
    assert.equal(isManualResolvableBlock('BLOCKED_BY_PLATFORM'), false);
  });

  it('allows a bounded number of manual attempts', () => {
    assert.deepEqual(decideManualVerification(0, 3), { action: 'PAUSE', attempts: 1 });
    assert.deepEqual(decideManualVerification(2, 3), { action: 'PAUSE', attempts: 3 });
    assert.deepEqual(decideManualVerification(3, 3), { action: 'FAIL', attempts: 4 });
  });

  it('aggregates a platform as waiting instead of failed', () => {
    assert.equal(
      aggregatePlatformStatus([
        { status: PlatformTaskStatusEnum.SUCCESS, resultCount: 5 },
        { status: PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION, resultCount: 0 },
      ]),
      PlatformStatusEnum.WAITING_MANUAL_VERIFICATION,
    );
    assert.equal(
      aggregatePlatformStatus([
        { status: PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION, resultCount: 0 },
        { status: PlatformTaskStatusEnum.PENDING, resultCount: 0 },
      ]),
      PlatformStatusEnum.WAITING_MANUAL_VERIFICATION,
    );
  });
});

describe('xiaohongshu goods search entry', () => {
  it('probes the deeplink-equivalent web goods search parameter', () => {
    const urls = buildXiaohongshuSearchUrls('米饼 贴纸');
    assert.equal(urls.length, 3);
    assert.ok(urls[0].includes(encodeURIComponent('米饼 贴纸')));
    assert.ok(urls.some((url) => url.includes('target_search=goods')));
    assert.ok(urls.some((url) => url.includes('type=goods')));
  });

  it('never treats note links as goods links', () => {
    assert.equal(
      isXiaohongshuNoteUrl('https://www.xiaohongshu.com/explore/65abc'),
      true,
    );
    assert.equal(
      isXiaohongshuGoodsUrl('https://www.xiaohongshu.com/explore/65abc'),
      false,
    );
    assert.equal(
      isXiaohongshuGoodsUrl('https://www.xiaohongshu.com/discovery/item/65abc'),
      false,
    );
  });

  it('accepts goods detail links but rejects unrelated domains', () => {
    assert.equal(
      isXiaohongshuGoodsUrl('https://www.xiaohongshu.com/goods-detail/123?xsec_token=a'),
      true,
    );
    assert.equal(
      isXiaohongshuGoodsUrl('https://www.xiaohongshu.com/search_result?goods_id=123'),
      true,
    );
    assert.equal(
      isXiaohongshuGoodsUrl('https://example.com/goods-detail/123'),
      false,
    );
  });

  it('only reports EMPTY when goods mode is confirmed', () => {
    assert.equal(
      classifyXiaohongshuSearch({
        goodsCount: 2,
        noteCount: 9,
        goodsModeActive: false,
        noResultHint: false,
      }),
      'GOODS',
    );
    assert.equal(
      classifyXiaohongshuSearch({
        goodsCount: 0,
        noteCount: 9,
        goodsModeActive: false,
        noResultHint: false,
      }),
      'NOTES_ONLY',
    );
    assert.equal(
      classifyXiaohongshuSearch({
        goodsCount: 0,
        noteCount: 0,
        goodsModeActive: true,
        noResultHint: true,
      }),
      'NO_RESULTS',
    );
    assert.equal(
      classifyXiaohongshuSearch({
        goodsCount: 0,
        noteCount: 0,
        goodsModeActive: false,
        noResultHint: true,
      }),
      'UNKNOWN',
    );
  });
});
