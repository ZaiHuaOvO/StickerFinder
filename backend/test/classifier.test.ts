import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductClassifierService, TargetDescriptor } from '../src/ai/product-classifier.service';
import { AiStatusEnum, MatchStatusEnum, MatchTypeEnum, PlatformEnum, SourceTypeEnum } from '../src/common/enums';
import { NormalizedProduct } from '../src/common/interfaces/normalized-product.interface';

function buildClassifier(
  aiResult: unknown,
  visionEnabled = false,
  minConfidence = '0.65',
) {
  const config = {
    get: (key: string) => (key === 'AI_MIN_CONFIDENCE' ? minConfidence : undefined),
  };
  const deepseek = {
    isConfigured: () => true,
    model: 'test-model',
    chatJson: async () => JSON.stringify(aiResult),
  };
  const images = {
    isVisionEnabled: () => visionEnabled,
    maxImageBytes: () => 1024,
    localImageToDataUrl: async () => null,
    remoteImageToDataUrl: async () => null,
  };
  return new ProductClassifierService(config as never, deepseek as never, images as never);
}

function candidate(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    platform: PlatformEnum.TAOBAO,
    platformProductId: 'p1',
    title: 'A系列 B贴纸',
    productUrl: 'https://item.taobao.com/item.htm?id=1',
    imageUrls: [],
    skuOptions: [],
    sourceType: SourceTypeEnum.OFFICIAL_API,
    collectedAt: '2026-11-23T12:00:00+08:00',
    ...overrides,
  };
}

function baseAiResult(overrides: Record<string, unknown> = {}) {
  return {
    matchStatus: 'MATCH',
    matchType: 'EXACT_SINGLE',
    candidateRelevance: 'HIGH',
    confidence: 0.9,
    categoryMatch: 'MATCH',
    seriesMatch: 'MATCH',
    targetItemMatch: 'MATCH',
    visualMatch: 'VISUAL_UNAVAILABLE',
    productContentSummary: '目标是单款 B 贴纸',
    matchedContents: ['A系列 B贴纸'],
    matchedSkuIds: [],
    skuDecisions: [],
    evidence: [
      {
        sourceField: 'title',
        content: '标题明确写出 A系列 B贴纸',
        interpretation: '标题包含目标名称与系列',
      },
    ],
    reason: '内容一致',
    nextAction: 'NONE',
    needsManualReview: false,
    ...overrides,
  };
}

const target: TargetDescriptor = { name: 'A系列 B贴纸', seriesName: 'A系列', aliases: [] };

describe('ProductClassifierService safety layer', () => {
  it('keeps a solid EXACT_SINGLE match', async () => {
    const classifier = buildClassifier(baseAiResult());
    const outcome = await classifier.classify(target, candidate(), 'c1');
    assert.equal(outcome.aiStatus, AiStatusEnum.OK);
    assert.equal(outcome.matchStatus, MatchStatusEnum.MATCH);
    assert.equal(outcome.matchType, MatchTypeEnum.EXACT_SINGLE);
  });

  it('demotes TARGET_VARIANT when no SKU details exist', async () => {
    const classifier = buildClassifier(
      baseAiResult({ matchType: 'TARGET_VARIANT', matchedSkuIds: ['sku-1'] }),
    );
    const outcome = await classifier.classify(target, candidate(), 'c2');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.equal(outcome.matchType, MatchTypeEnum.UNCERTAIN);
    assert.equal(outcome.needsManualReview, true);
  });

  it('demotes a MATCH when the reference image cannot be used and confidence falls below threshold', async () => {
    const classifier = buildClassifier(baseAiResult({ confidence: 0.7 }), false);
    const withImage: TargetDescriptor = { ...target, referenceImagePath: 'uploads/reference/x.png' };
    const outcome = await classifier.classify(withImage, candidate(), 'c3');
    // 0.7 - 0.1 = 0.6 < 0.65，应降级
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.ok((outcome.confidence ?? 0) < 0.65);
  });

  it('keeps a MATCH when vision is unavailable but confidence stays above threshold', async () => {
    const classifier = buildClassifier(baseAiResult({ confidence: 0.9 }), false);
    const withImage: TargetDescriptor = { ...target, referenceImagePath: 'uploads/reference/x.png' };
    const outcome = await classifier.classify(withImage, candidate(), 'c3b');
    assert.equal(outcome.matchStatus, MatchStatusEnum.MATCH);
    assert.equal(outcome.matchType, MatchTypeEnum.EXACT_SINGLE);
    assert.equal(outcome.rawMatchStatus, MatchStatusEnum.MATCH);
    assert.equal(outcome.rawConfidence, 0.9);
    assert.equal(outcome.confidence, 0.8);
    assert.ok(outcome.safetyWarnings.some((warning) => warning.includes('视觉')));
    assert.deepEqual(outcome.safetyBlockers, []);
    assert.equal(outcome.needsManualReview, false);
  });

  it('keeps raw and final decisions separate when a blocker demotes MATCH', async () => {
    const classifier = buildClassifier(baseAiResult({ categoryMatch: 'CONFLICT' }));
    const outcome = await classifier.classify(target, candidate(), 'c3c');
    assert.equal(outcome.rawMatchStatus, MatchStatusEnum.MATCH);
    assert.equal(outcome.rawConfidence, 0.9);
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.ok(outcome.safetyBlockers.length > 0);
  });

  it('does not mark SKU or price as verified from search data alone', async () => {
    const classifier = buildClassifier(baseAiResult());
    const outcome = await classifier.classify(target, candidate(), 'c3d');
    assert.equal(outcome.skuVerificationStatus, 'NOT_AVAILABLE');
    assert.equal(outcome.priceVerificationStatus, 'UNVERIFIED');
  });

  it('marks target SKU and price verified only after detail enrichment', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchType: 'TARGET_VARIANT',
        matchedSkuIds: ['sku-1'],
        skuDecisions: [
          { skuId: 'sku-1', matchStatus: 'MATCH', reason: '目标款' },
          { skuId: 'sku-2', matchStatus: 'NO_MATCH', reason: '其他款' },
        ],
      }),
    );
    const withSkus = candidate({
      skuOptions: [
        { skuId: 'sku-1', name: '小镇一角', price: 13.8 },
        { skuId: 'sku-2', name: '霓虹雪夜', price: 13.8 },
      ],
    });
    const before = await classifier.classify(target, withSkus, 'c17');
    assert.equal(before.skuVerificationStatus, 'PENDING');
    assert.equal(before.priceVerificationStatus, 'UNVERIFIED');

    const after = await classifier.classify(target, withSkus, 'c18', {
      detailEnriched: true,
    });
    assert.equal(after.skuVerificationStatus, 'VERIFIED');
    assert.equal(after.priceVerificationStatus, 'VERIFIED');
  });

  it('keeps price unverified when the matched SKU has no price', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchType: 'TARGET_VARIANT',
        matchedSkuIds: ['sku-1'],
        skuDecisions: [
          { skuId: 'sku-1', matchStatus: 'MATCH', reason: '目标款' },
        ],
      }),
    );
    const withSkus = candidate({
      skuOptions: [{ skuId: 'sku-1', name: '小镇一角' }],
    });
    const outcome = await classifier.classify(target, withSkus, 'c19', {
      detailEnriched: true,
    });
    assert.equal(outcome.skuVerificationStatus, 'VERIFIED');
    assert.equal(outcome.priceVerificationStatus, 'UNVERIFIED');
  });

  it('removes SKUs that the AI itself marked NO_MATCH', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchType: 'TARGET_VARIANT',
        matchedSkuIds: ['sku-2'],
        skuDecisions: [
          { skuId: 'sku-2', matchStatus: 'NO_MATCH', reason: '不是目标贴纸' },
        ],
      }),
    );
    const outcome = await classifier.classify(
      target,
      candidate({ skuOptions: [{ skuId: 'sku-2', name: '随机款', price: 5 }] }),
      'c4',
    );
    assert.deepEqual(outcome.matchedSkuIds, []);
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
  });

  it('honors AI_MIN_CONFIDENCE=0 instead of falling back to 0.65', async () => {
    const classifier = buildClassifier(baseAiResult({ confidence: 0.1 }), false, '0');
    const outcome = await classifier.classify(target, candidate(), 'c6');
    assert.equal(outcome.matchStatus, MatchStatusEnum.MATCH);
  });

  it('demotes EXACT_SINGLE when SKU decisions all say NO_MATCH', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchType: 'EXACT_SINGLE',
        matchedSkuIds: [],
        skuDecisions: [
          { skuId: 'sku-1', matchStatus: 'NO_MATCH', reason: 'C 贴纸' },
          { skuId: 'sku-2', matchStatus: 'NO_MATCH', reason: 'D 贴纸' },
        ],
      }),
    );
    const outcome = await classifier.classify(
      target,
      candidate({
        skuOptions: [
          { skuId: 'sku-1', name: 'C 贴纸', price: 5 },
          { skuId: 'sku-2', name: 'D 贴纸', price: 6 },
        ],
      }),
      'c7',
    );
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.equal(outcome.needsManualReview, true);
  });

  it('marks AI failures as UNCERTAIN instead of matching', async () => {
    const classifier = buildClassifier({ not: 'a valid result' });
    const outcome = await classifier.classify(target, candidate(), 'c5');
    assert.equal(outcome.aiStatus, AiStatusEnum.FAILED);
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.equal(outcome.needsManualReview, true);
  });

  it('demotes a MATCH when the category conflicts', async () => {
    const classifier = buildClassifier(baseAiResult({ categoryMatch: 'CONFLICT' }));
    const outcome = await classifier.classify(target, candidate(), 'c8');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.equal(outcome.needsManualReview, true);
  });

  it('demotes a MATCH when the series conflicts for a single-style match', async () => {
    const classifier = buildClassifier(baseAiResult({ seriesMatch: 'CONFLICT' }));
    const outcome = await classifier.classify(target, candidate(), 'c9');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
  });

  it('forces NO_MATCH when candidate relevance is NONE', async () => {
    const classifier = buildClassifier(baseAiResult({ candidateRelevance: 'NONE' }));
    const outcome = await classifier.classify(target, candidate(), 'c13');
    assert.equal(outcome.matchStatus, MatchStatusEnum.NO_MATCH);
    assert.equal(outcome.matchType, MatchTypeEnum.NOT_MATCH);
  });

  it('demotes a MATCH without a confirmed target style', async () => {
    const classifier = buildClassifier(baseAiResult({ targetItemMatch: 'UNKNOWN' }));
    const outcome = await classifier.classify(target, candidate(), 'c14');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
  });

  it('demotes a bundle match without concrete contents or SKUs', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchType: 'CONTAINS_TARGET_BUNDLE',
        matchedContents: [],
        matchedSkuIds: [],
      }),
    );
    const outcome = await classifier.classify(target, candidate(), 'c15');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
  });

  it('drops evidence from sources that were not provided', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        evidence: [
          {
            sourceField: 'image',
            content: '图片显示目标图案',
            interpretation: '视觉一致',
          },
        ],
      }),
    );
    const outcome = await classifier.classify(target, candidate(), 'c16');
    assert.deepEqual(outcome.evidence, []);
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.match(outcome.reason, /证据来源/);
  });

  it('keeps HIGH relevance separate from an UNCERTAIN status', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchStatus: 'UNCERTAIN',
        matchType: 'UNCERTAIN',
        candidateRelevance: 'HIGH',
        targetItemMatch: 'UNKNOWN',
        nextAction: 'FETCH_SKU',
        confidence: 0.3,
        evidence: [],
        needsManualReview: true,
      }),
    );
    const outcome = await classifier.classify(target, candidate(), 'c10');
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.equal(outcome.candidateRelevance, 'HIGH');
    assert.equal(outcome.nextAction, 'FETCH_SKU');
    assert.equal(outcome.needsManualReview, true);
  });

  it('turns an UNCERTAIN with no next action into manual review', async () => {
    const classifier = buildClassifier(
      baseAiResult({
        matchStatus: 'UNCERTAIN',
        matchType: 'UNCERTAIN',
        nextAction: 'NONE',
        evidence: [],
        needsManualReview: false,
      }),
    );
    const outcome = await classifier.classify(target, candidate(), 'c11');
    assert.equal(outcome.nextAction, 'MANUAL_REVIEW');
    assert.equal(outcome.needsManualReview, true);
  });

  it('returns structured evidence as objects', async () => {
    const classifier = buildClassifier(baseAiResult());
    const outcome = await classifier.classify(target, candidate(), 'c12');
    assert.equal(outcome.evidence[0].sourceField, 'title');
    assert.equal(outcome.evidence[0].interpretation, '标题包含目标名称与系列');
  });
});
