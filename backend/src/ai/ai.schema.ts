import { z } from 'zod';

export const skuDecisionSchema = z.object({
  skuId: z.string().min(1),
  matchStatus: z.enum(['MATCH', 'NO_MATCH', 'UNCERTAIN']),
  reason: z.string().min(1),
});

export const classificationResultSchema = z.object({
  matchStatus: z.enum(['MATCH', 'NO_MATCH', 'UNCERTAIN']),
  matchType: z
    .enum([
      'EXACT_SINGLE',
      'TARGET_VARIANT',
      'CONTAINS_TARGET_BUNDLE',
      'CONTAINS_TARGET_FULL_SET',
      'NOT_MATCH',
      'UNCERTAIN',
    ])
    .nullable(),
  confidence: z.number().min(0).max(1),
  productContentSummary: z.string(),
  matchedContents: z.array(z.string()),
  matchedSkuIds: z.array(z.string()),
  skuDecisions: z.array(skuDecisionSchema),
  evidence: z.array(z.string()),
  reason: z.string(),
  needsManualReview: z.boolean(),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;
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
