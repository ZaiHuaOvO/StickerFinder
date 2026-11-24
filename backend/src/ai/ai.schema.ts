import { z } from 'zod';

export const evidenceSchema = z.object({
  sourceField: z.enum(['title', 'description', 'sku', 'image']),
  content: z.string().min(1).max(2000),
  interpretation: z.string().min(1).max(1000),
});

export const skuDecisionSchema = z.object({
  skuId: z.string().min(1).max(200),
  matchStatus: z.enum(['MATCH', 'NO_MATCH', 'UNCERTAIN']),
  reason: z.string().min(1).max(1000),
});

export const classificationResultSchema = z.object({
  matchStatus: z.enum(['MATCH', 'NO_MATCH', 'UNCERTAIN']),
  matchType: z.enum([
    'EXACT_SINGLE',
    'TARGET_VARIANT',
    'CONTAINS_TARGET_BUNDLE',
    'CONTAINS_TARGET_FULL_SET',
    'NOT_MATCH',
    'UNCERTAIN',
  ]),
  candidateRelevance: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
  confidence: z.number().min(0).max(1),
  categoryMatch: z.enum(['MATCH', 'CONFLICT', 'UNKNOWN']),
  seriesMatch: z.enum(['MATCH', 'CONFLICT', 'UNKNOWN']),
  targetItemMatch: z.enum(['MATCH', 'CONFLICT', 'UNKNOWN']),
  visualMatch: z.enum([
    'VISUAL_EXACT',
    'VISUAL_SIMILAR',
    'VISUAL_ABSENT',
    'VISUAL_UNAVAILABLE',
  ]),
  productContentSummary: z.string().max(2000),
  matchedContents: z.array(z.string().max(500)).max(100),
  matchedSkuIds: z.array(z.string().max(200)).max(100),
  skuDecisions: z.array(skuDecisionSchema).max(100),
  evidence: z.array(evidenceSchema).max(50),
  reason: z.string().max(4000),
  nextAction: z.enum([
    'NONE',
    'FETCH_PRODUCT_DETAIL',
    'FETCH_SKU',
    'FETCH_IMAGES',
    'MANUAL_REVIEW',
  ]),
  needsManualReview: z.boolean(),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
export type EvidenceEntry = z.infer<typeof evidenceSchema>;
export type SkuDecisionResult = z.infer<typeof skuDecisionSchema>;

/** 从可能包含 markdown 围栏或前后说明的文本中提取 JSON 对象 */
export function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const first = withoutFence.indexOf('{');
    const last = withoutFence.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
    throw new Error('AI 返回内容不是有效的 JSON 对象');
  }
}
