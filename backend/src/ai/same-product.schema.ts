import { z } from 'zod';

export const sameProductSchema = z.object({
  verdict: z.enum(['SAME', 'DIFFERENT', 'UNCERTAIN']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  evidence: z.array(z.string()),
});

export type SameProductResult = z.infer<typeof sameProductSchema>;
