import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ManualDecisionEnum,
  MatchStatusEnum,
  MatchTypeEnum,
  PlatformEnum,
  PriceTypeEnum,
  PriceVerificationStatusEnum,
  SkuVerificationStatusEnum,
} from '../src/common/enums';
import type { PriceInfo } from '../src/common/interfaces/price.interface';
import type { ProductCandidate } from '../src/entities';
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
  match?: Record<string, unknown>;
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
    matchResult: {
      matchStatus: MatchStatusEnum.MATCH,
      matchType: MatchTypeEnum.EXACT_SINGLE,
      candidateRelevance: 'HIGH',
      manualDecision: ManualDecisionEnum.PENDING,
      matchedSkuIds: [],
      matchedContents: [],
      skuVerificationStatus: SkuVerificationStatusEnum.NOT_AVAILABLE,
      priceVerificationStatus: PriceVerificationStatusEnum.UNVERIFIED,
      ...overrides.match,
    },
  } as unknown as ProductCandidate;
}

describe('buildPriceSummary', () => {
  it('ranks a verified target SKU price as the best single price', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'single-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
        match: {
          matchType: MatchTypeEnum.EXACT_SINGLE,
          matchedSkuIds: ['s1'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.VERIFIED,
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
        match: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1', 's2'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.VERIFIED,
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

  it('does not rank a match whose SKU or price is not verified', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'unverified-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13.8 }],
        match: {
          matchType: MatchTypeEnum.EXACT_SINGLE,
          matchedSkuIds: ['s1'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.UNVERIFIED,
        },
      }),
    ]);
    assert.equal(summary.bestPrice, null);
    assert.equal(summary.totalConfirmed, 0);
    assert.equal(summary.unverifiedMatchCount, 1);
  });

  it('shows only uncertain candidates that could beat the confirmed price', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'confirmed',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 13 }],
        match: {
          matchType: MatchTypeEnum.EXACT_SINGLE,
          matchedSkuIds: ['s1'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.VERIFIED,
        },
      }),
      candidate({
        id: 'cheaper-uncertain',
        priceData: price(12),
        match: {
          matchStatus: MatchStatusEnum.UNCERTAIN,
          matchType: MatchTypeEnum.EXACT_SINGLE,
        },
      }),
      candidate({
        id: 'expensive-uncertain',
        priceData: price(15),
        match: {
          matchStatus: MatchStatusEnum.UNCERTAIN,
          matchType: MatchTypeEnum.EXACT_SINGLE,
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
        match: {
          matchType: MatchTypeEnum.TARGET_VARIANT,
          matchedSkuIds: ['s1', 's2', 's3'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.VERIFIED,
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
        match: { matchType: MatchTypeEnum.EXACT_SINGLE, matchedSkuIds: [] },
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

  it('lets a manual MATCH with a verified SKU price enter the summary', () => {
    const summary = buildPriceSummary([
      candidate({
        id: 'manual-1',
        skuData: [{ skuId: 's1', name: '小镇一角', price: 12.5 }],
        match: {
          matchStatus: MatchStatusEnum.NO_MATCH,
          matchType: MatchTypeEnum.NOT_MATCH,
          manualDecision: ManualDecisionEnum.MATCH,
          matchedSkuIds: ['s1'],
          skuVerificationStatus: SkuVerificationStatusEnum.VERIFIED,
          priceVerificationStatus: PriceVerificationStatusEnum.VERIFIED,
        },
      }),
    ]);
    assert.equal(summary.bestPrice?.amount, 12.5);
  });
});
