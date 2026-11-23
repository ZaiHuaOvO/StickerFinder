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
    confidence: 0.9,
    productContentSummary: '目标是单款 B 贴纸',
    matchedContents: ['A系列 B贴纸'],
    matchedSkuIds: [],
    skuDecisions: [],
    evidence: ['标题明确写出 A系列 B贴纸'],
    reason: '内容一致',
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

  it('demotes a MATCH when the reference image cannot be used', async () => {
    const classifier = buildClassifier(baseAiResult({ confidence: 0.7 }), false);
    const withImage: TargetDescriptor = { ...target, referenceImagePath: 'uploads/reference/x.png' };
    const outcome = await classifier.classify(withImage, candidate(), 'c3');
    // 0.7 - 0.1 = 0.6 < 0.65，应降级
    assert.equal(outcome.matchStatus, MatchStatusEnum.UNCERTAIN);
    assert.ok((outcome.confidence ?? 0) < 0.65);
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
});
