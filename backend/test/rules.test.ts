import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MatchTypeEnum, PriceTypeEnum } from '../src/common/enums';
import {
  buildSearchRule,
  evaluateProductRule,
  matchesDetail,
  matchesTitle,
  normalizeRuleText,
  validatePrice,
} from '../src/rules/rule.engine';
import {
  RulePriceStatusEnum,
  RuleStatusEnum,
} from '../src/rules/rule.types';

const rule = buildSearchRule({
  name: '小镇一角',
  seriesName: '妍莜21.0',
});

describe('rule text normalization', () => {
  it('normalizes full-width, whitespace, case and variants', () => {
    assert.equal(normalizeRuleText('　妍莜 21.0　小镇一角 '), '妍莜21.0小镇一角');
    assert.equal(normalizeRuleText('ABC'), 'abc');
    assert.equal(normalizeRuleText('姸莜'), '妍莜');
  });
});

describe('title rule', () => {
  it('matches when both target and series appear', () => {
    const result = matchesTitle('妍莜21.0 小镇一角 造景贴纸', rule);
    assert.equal(result.matched, true);
    assert.equal(result.matchedTargetKeyword, '小镇一角');
    assert.equal(result.matchedSeriesKeyword, '妍莜21.0');
  });

  it('rejects when only target appears', () => {
    assert.equal(matchesTitle('小镇一角 造景贴纸', rule).matched, false);
  });

  it('rejects when only series appears', () => {
    assert.equal(matchesTitle('妍莜21.0 其他款式', rule).matched, false);
  });

  it('rejects unrelated titles', () => {
    assert.equal(matchesTitle('森林小屋 造景贴纸', rule).matched, false);
  });

  it('uses configured aliases for both groups', () => {
    const aliased = buildSearchRule({
      name: '小镇一角',
      seriesName: '妍莜21.0',
      aliases: ['小镇的一角'],
      seriesAliases: ['妍莜21.0系列'],
    });
    assert.equal(
      matchesTitle('妍莜21.0系列 小镇的一角', aliased).matched,
      true,
    );
  });

  it('does not auto-expand series keywords', () => {
    assert.equal(matchesTitle('妍莜 小镇一角', rule).matched, false);
  });

  it('matches across full-width and whitespace differences', () => {
    assert.equal(
      matchesTitle('妍莜２１.０　小镇一角', rule).matched,
      true,
    );
  });

  it('applies OR within a group and AND between groups', () => {
    const multi = buildSearchRule({
      name: '小镇一角',
      seriesName: '妍莜21.0',
      aliases: ['小镇的一角', '镇角小铺'],
      seriesAliases: ['妍莜21.0', '妍莜21'],
    });
    assert.equal(matchesTitle('妍莜21 镇角小铺', multi).matched, true);
    assert.equal(matchesTitle('妍莜21 其他款', multi).matched, false);
  });
});

describe('detail rule', () => {
  it('confirms from detail title', () => {
    const result = matchesDetail(
      { title: '妍莜21.0系列小镇一角造景贴纸', skuOptions: [] },
      rule,
    );
    assert.equal(result.matched, true);
  });

  it('confirms from a SKU name and links that SKU', () => {
    const result = matchesDetail(
      {
        title: '妍莜21.0系列造景贴纸',
        skuOptions: [
          { skuId: 's1', name: '妍莜21.0 小镇一角' },
          { skuId: 's2', name: '山间日落' },
        ],
      },
      rule,
    );
    assert.equal(result.matched, true);
    assert.deepEqual(result.matchedSkuIds, ['s1']);
  });

  it('rejects when neither detail title nor SKU contains the target', () => {
    const result = matchesDetail(
      { title: '妍莜21.0 山间日落', skuOptions: [{ name: '山间日落' }] },
      rule,
    );
    assert.equal(result.matched, false);
  });

  it('does not scan shop descriptions or unrelated raw text', () => {
    const result = matchesDetail(
      {
        title: '妍莜21.0 山间日落',
        skuOptions: [{ name: '山间日落' }],
        description: '本店另有小镇一角、森林小屋等热门款式',
      } as never,
      rule,
    );
    assert.equal(result.matched, false);
  });
});

describe('price rule', () => {
  const currency = { amount: 9.9, currency: 'CNY', priceType: PriceTypeEnum.LISTING };

  it('accepts a matched SKU price with known currency', () => {
    const price = validatePrice(
      {
        price: currency,
        skuOptions: [
          { skuId: 's1', name: '小镇一角', price: 9.9 },
          { skuId: 's2', name: '其他', price: 5 },
        ],
      },
      ['s1'],
    );
    assert.equal(price.status, RulePriceStatusEnum.VALID);
    assert.equal(price.amount, 9.9);
    assert.equal(price.skuId, 's1');
  });

  it('does not link another SKU price to the matched SKU', () => {
    const price = validatePrice(
      {
        skuOptions: [
          { skuId: 's1', name: '小镇一角' },
          { skuId: 's2', name: '其他', price: 5 },
        ],
      },
      ['s1'],
    );
    assert.equal(price.status, RulePriceStatusEnum.MISSING);
    assert.equal(price.amount, null);
  });

  it('marks listing prices as ambiguous instead of a SKU price', () => {
    const price = validatePrice({ price: currency }, []);
    assert.equal(price.status, RulePriceStatusEnum.AMBIGUOUS);
    assert.equal(price.amount, 9.9);
    assert.equal(price.source, 'listing');
  });

  it('marks missing and non-positive prices correctly', () => {
    assert.equal(validatePrice({ price: null }, []).status, RulePriceStatusEnum.MISSING);
    assert.equal(
      validatePrice(
        { price: { amount: 0, currency: 'CNY', priceType: PriceTypeEnum.LISTING } },
        [],
      ).status,
      RulePriceStatusEnum.INVALID,
    );
  });

  it('accepts 1688 wholesale price with known currency', () => {
    const price = validatePrice(
      {
        wholesalePrice: {
          priceMin: 1.2,
          priceMax: 2,
          currency: 'CNY',
          unit: '件',
          minOrderQuantity: 100,
          priceTiers: [],
        },
      },
      [],
    );
    assert.equal(price.status, RulePriceStatusEnum.VALID);
    assert.equal(price.source, 'wholesale');
  });
});

describe('product evaluation', () => {
  const title = '妍莜21.0 小镇一角 造景贴纸';

  it('marks a title mismatch as NO_MATCH without requesting detail', () => {
    const evaluation = evaluateProductRule({
      rule,
      searchProduct: { title: '妍莜21.0 山间日落' },
      detail: { attempted: false, product: null },
    });
    assert.equal(evaluation.status, RuleStatusEnum.NO_MATCH);
    assert.equal(evaluation.detailChecked, false);
  });

  it('stays PENDING_DETAIL when detail has not been fetched or failed', () => {
    const pending = evaluateProductRule({
      rule,
      searchProduct: { title },
      detail: { attempted: false, product: null },
    });
    assert.equal(pending.status, RuleStatusEnum.PENDING_DETAIL);
    const failed = evaluateProductRule({
      rule,
      searchProduct: { title },
      detail: { attempted: true, product: null, error: 'timeout' },
    });
    assert.equal(failed.status, RuleStatusEnum.PENDING_DETAIL);
    assert.match(failed.reason, /详情获取失败/);
  });

  it('marks a detail mismatch as NO_MATCH', () => {
    const evaluation = evaluateProductRule({
      rule,
      searchProduct: { title },
      detail: {
        attempted: true,
        product: { title: '妍莜21.0 山间日落', skuOptions: [] },
      },
    });
    assert.equal(evaluation.status, RuleStatusEnum.NO_MATCH);
    assert.equal(evaluation.detailChecked, true);
  });

  it('confirms a match with a valid SKU price', () => {
    const evaluation = evaluateProductRule({
      rule,
      searchProduct: { title },
      detail: {
        attempted: true,
        product: {
          title,
          price: { amount: 9.9, currency: 'CNY', priceType: PriceTypeEnum.LISTING },
          skuOptions: [
            { skuId: 's1', name: '小镇一角', price: 9.9 },
          ],
        },
      },
    });
    assert.equal(evaluation.status, RuleStatusEnum.MATCH_CONFIRMED);
    assert.equal(evaluation.priceStatus, RulePriceStatusEnum.VALID);
    assert.equal(evaluation.matchType, MatchTypeEnum.TARGET_VARIANT);
  });

  it('confirms the product but flags missing price', () => {
    const evaluation = evaluateProductRule({
      rule,
      searchProduct: { title },
      detail: {
        attempted: true,
        product: {
          title,
          price: { amount: 9.9, currency: 'CNY', priceType: PriceTypeEnum.LISTING },
          skuOptions: [],
        },
      },
    });
    assert.equal(evaluation.status, RuleStatusEnum.MATCH_NO_PRICE);
    assert.equal(evaluation.priceStatus, RulePriceStatusEnum.AMBIGUOUS);
  });
});
