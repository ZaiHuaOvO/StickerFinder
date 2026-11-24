import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ManualDecisionEnum,
  MatchTypeEnum,
  PlatformEnum,
  PriceTypeEnum,
} from '../src/common/enums';
import type { PriceInfo } from '../src/common/interfaces/price.interface';
import type { ProductCandidate } from '../src/entities';
import {
  RulePriceStatusEnum,
  RuleStatusEnum,
} from '../src/rules/rule.types';
import { buildPriceSummary } from '../src/search/price-summary.util';

function price(amount: number, currency = 'CNY'): PriceInfo {
  return {
    amount,
    currency,
    displayText: `${currency} ${amount}`,
    priceType: PriceTypeEnum.LISTING,
    priceSource: 'test',
    observedAt: '2026-11-24T06:48:18+08:00',
    shippingIncluded: 'unknown',
  };
}

function candidate(overrides: {
  id: string;
  platform?: PlatformEnum;
  title?: string;
  skuData?: Array<{ skuId?: string; name: string; price?: number }>;
  priceData?: PriceInfo | null;
  wholesalePriceData?: Record<string, unknown> | null;
  rule?: Record<string, unknown>;
}): ProductCandidate {
  return {
    id: overrides.id,
    platform: overrides.platform ?? PlatformEnum.TAOBAO,
    title: overrides.title ?? '小镇一角造景贴纸',
    shopName: '测试店铺',
    productUrl: `https://example.com/${overrides.id}`,
    imageUrls: [`https://example.com/${overrides.id}.jpg`],
    skuData: overrides.skuData ?? [],
    priceData: overrides.priceData ?? price(19.9),
    wholesalePriceData: overrides.wholesalePriceData ?? null,
    collectedAt: new Date('2026-11-24T06:48:18Z'),
    observations: [],
    ruleResult: {
      status: RuleStatusEnum.MATCH_CONFIRMED,
      priceStatus: RulePriceStatusEnum.VALID,
      titleMatched: true,
      detailChecked: true,
      matchType: MatchTypeEnum.EXACT_SINGLE,
      matchedSkuIds: [],
      matchedContents: [],
      manualDecision: ManualDecisionEnum.PENDING,
      ...overrides.rule,
    },
  } as unknown as ProductCandidate;
}

describe('buildPriceSummary (rule results)', () => {
  it('ranks a rule-confirmed target SKU price as the best single price', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'single-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
        rule: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1'],
        },
      }),
    ]);
    assert.equal(summary.bestPrice?.amount, 13.8);
    assert.equal(summary.bestPrice?.comparisonGroup, 'TARGET_SINGLE');
    assert.equal(summary.totalConfirmed, 1);
  });

  it('keeps bundle and single prices in separate comparison groups', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'mixed-1',
        skuData: [
          { skuId: 's1', name: '小镇一角', price: 13.8 },
          { skuId: 's2', name: '小镇一角+晨光气泡站', price: 24.9 },
        ],
        rule: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1', 's2'],
        },
      }),
    ]);
    assert.equal(summary.bestPrice?.amount, 13.8);
    assert.equal(summary.bestPrice?.comparisonGroup, 'TARGET_SINGLE');
    const bundle = summary.bestByGroup.find(
      (item) => item.comparisonGroup === 'TARGET_BUNDLE',
    );
    assert.equal(bundle?.amount, 24.9);
  });

  it('does not rank a product whose price is not valid', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'no-price-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
        rule: {
          status: RuleStatusEnum.MATCH_NO_PRICE,
          priceStatus: RulePriceStatusEnum.AMBIGUOUS,
          matchedSkuIds: ['s1'],
        },
      }),
    ]);
    assert.equal(summary.bestPrice, null);
    assert.equal(summary.totalConfirmed, 0);
  });

  it('shows only pending candidates that could beat the confirmed price', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'confirmed',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13 }],
        rule: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1'],
        },
      }),
      candidate({
        id: 'cheaper-uncertain',
        priceData: price(12),
        rule: {
          status: RuleStatusEnum.PENDING_DETAIL,
          priceStatus: RulePriceStatusEnum.MISSING,
          detailChecked: false,
          matchedSkuIds: [],
        },
      }),
      candidate({
        id: 'expensive-uncertain',
        priceData: price(15),
        rule: {
          status: RuleStatusEnum.PENDING_DETAIL,
          priceStatus: RulePriceStatusEnum.MISSING,
          detailChecked: false,
          matchedSkuIds: [],
        },
      }),
    ]);
    assert.deepEqual(summary.potentialCheaperCandidateIds, ['cheaper-uncertain']);
    assert.equal(summary.otherUncertainCount, 1);
  });

  it('separates all-in and multi-style SKUs from single-style prices', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'mixed-groups',
        skuData: [
          { skuId: 's1', name: '妍莜21.0【小镇一角】', price: 18.8 },
          { skuId: 's2', name: '小镇一角+校园生活 2款', price: 31.8 },
          { skuId: 's3', name: '妍莜21.0系列-【 allin 6款 】', price: 76.9 },
        ],
        rule: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1', 's2', 's3'],
        },
      }),
    ]);
    assert.equal(summary.bestPrice?.amount, 18.8);
    assert.equal(summary.bestPrice?.comparisonGroup, 'TARGET_SINGLE');
    const single = summary.groups.find((group) => group.group === 'TARGET_SINGLE');
    const bundle = summary.groups.find((group) => group.group === 'TARGET_BUNDLE');
    const full = summary.groups.find((group) => group.group === 'TARGET_FULL_SET');
    assert.equal(single?.maxAmount, 18.8);
    assert.equal(bundle?.minAmount, 31.8);
    assert.equal(full?.minAmount, 76.9);
  });

  it('keeps 1688 wholesale prices out of the retail best price', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'wholesale-1',
        platform: PlatformEnum.ALIBABA1688,
        rule: { matchType: MatchTypeEnum.EXACT_SINGLE, matchedSkuIds: [] },
        wholesalePriceData: {
          priceMin: 0.8,
          priceMax: 1.2,
          currency: 'CNY',
          unit: '件',
          minOrderQuantity: 100,
          priceTiers: [],
        },
      }),
    ]);
    assert.equal(summary.bestPrice, null);
    assert.equal(summary.items[0]?.comparisonGroup, 'WHOLESALE');
    assert.equal(summary.platforms[0]?.wholesale?.priceMin, 0.8);
    assert.equal(summary.platforms[0]?.wholesale?.minOrderQuantity, 100);
  });

  it('lets a manual MATCH with a valid rule price enter the summary', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'manual-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 12.5 }],
        rule: {
          status: RuleStatusEnum.NO_MATCH,
          manualDecision: ManualDecisionEnum.MATCH,
          matchedSkuIds: ['s1'],
        },
      }),
    ]);
    assert.equal(summary.bestPrice?.amount, 12.5);
  });

  it('ignores legacy AI match results without a rule result', () => {
    const legacy = {
      ...candidate({ id: 'legacy-1' }),
      ruleResult: undefined,
      matchResult: {
        matchStatus: 'MATCH',
        matchType: MatchTypeEnum.EXACT_SINGLE,
        manualDecision: ManualDecisionEnum.PENDING,
        matchedSkuIds: [],
      },
    } as unknown as ProductCandidate;
    const summary = buildPriceSummary([legacy]);
    assert.equal(summary.totalConfirmed, 0);
  });
});
