import { randomUUID } from 'crypto';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import {
  AiStatusEnum,
  CandidateRelevanceEnum,
  ManualDecisionEnum,
  MatchAssessmentEnum,
  MatchStatusEnum,
  MatchTypeEnum,
  NextActionEnum,
  PriceVerificationStatusEnum,
  SkuVerificationStatusEnum,
  VisualMatchEnum,
} from '../common/enums';
import { ProductCandidate } from './product-candidate.entity';

export interface SkuDecision {
  skuId: string;
  matchStatus: 'MATCH' | 'NO_MATCH' | 'UNCERTAIN';
  reason: string;
}

export interface EvidenceEntry {
  sourceField: 'title' | 'description' | 'sku' | 'image';
  content: string;
  interpretation: string;
}

export interface SkuManualDecision {
  skuId: string;
  decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED';
  note?: string | null;
  reviewedAt: string;
}

@Entity({ name: 'product_match_results' })
export class ProductMatchResult {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'candidate_id', type: 'varchar', length: 36, unique: true })
  candidateId: string;

  @OneToOne(() => ProductCandidate, (candidate) => candidate.matchResult, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'candidate_id' })
  candidate: ProductCandidate;

  @Column({ name: 'match_status', type: 'varchar', length: 32 })
  matchStatus: MatchStatusEnum;

  @Column({ name: 'match_type', type: 'varchar', length: 48, nullable: true })
  matchType: MatchTypeEnum | null = null;

  @Column({
    name: 'candidate_relevance',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  candidateRelevance: CandidateRelevanceEnum | null = null;

  @Column({
    name: 'category_match',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  categoryMatch: MatchAssessmentEnum | null = null;

  @Column({ name: 'series_match', type: 'varchar', length: 16, nullable: true })
  seriesMatch: MatchAssessmentEnum | null = null;

  @Column({
    name: 'target_item_match',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  targetItemMatch: MatchAssessmentEnum | null = null;

  @Column({ name: 'visual_match', type: 'varchar', length: 24, nullable: true })
  visualMatch: VisualMatchEnum | null = null;

  @Column({ name: 'next_action', type: 'varchar', length: 32, nullable: true })
  nextAction: NextActionEnum | null = null;

  /** AI 原始判断；matchStatus/confidence 保存安全校验后的最终结果 */
  @Column({ name: 'raw_match_status', type: 'varchar', length: 32, nullable: true })
  rawMatchStatus: MatchStatusEnum | null = null;

  @Column({ name: 'raw_confidence', type: 'float', nullable: true })
  rawConfidence: number | null = null;

  @Column({ name: 'safety_warnings', type: 'simple-json', nullable: true })
  safetyWarnings: string[] | null = null;

  @Column({ name: 'safety_blockers', type: 'simple-json', nullable: true })
  safetyBlockers: string[] | null = null;

  @Column({
    name: 'sku_verification_status',
    type: 'varchar',
    length: 24,
    default: SkuVerificationStatusEnum.PENDING,
  })
  skuVerificationStatus: SkuVerificationStatusEnum =
    SkuVerificationStatusEnum.PENDING;

  @Column({
    name: 'price_verification_status',
    type: 'varchar',
    length: 24,
    default: PriceVerificationStatusEnum.PENDING,
  })
  priceVerificationStatus: PriceVerificationStatusEnum =
    PriceVerificationStatusEnum.PENDING;

  @Column({ type: 'float', nullable: true })
  confidence: number | null = null;

  @Column({ type: 'text', nullable: true })
  summary: string | null = null;

  @Column({ type: 'text', nullable: true })
  reason: string | null = null;

  @Column({ name: 'matched_contents', type: 'simple-json' })
  matchedContents: string[] = [];

  @Column({ name: 'matched_sku_ids', type: 'simple-json' })
  matchedSkuIds: string[] = [];

  @Column({ name: 'sku_decisions', type: 'simple-json' })
  skuDecisions: SkuDecision[] = [];

  @Column({ type: 'simple-json' })
  evidence: EvidenceEntry[] = [];

  @Column({ name: 'ai_status', type: 'varchar', length: 16 })
  aiStatus: AiStatusEnum;

  @Column({ name: 'ai_model', type: 'varchar', length: 100, nullable: true })
  aiModel: string | null = null;

  @Column({ name: 'ai_raw_response', type: 'simple-json', nullable: true })
  aiRawResponse: Record<string, unknown> | null = null;

  @Column({ name: 'ai_error', type: 'text', nullable: true })
  aiError: string | null = null;

  @Column({ name: 'needs_manual_review', type: 'boolean', default: false })
  needsManualReview: boolean = false;

  @Column({
    name: 'manual_decision',
    type: 'varchar',
    length: 16,
    default: ManualDecisionEnum.PENDING,
  })
  manualDecision: ManualDecisionEnum = ManualDecisionEnum.PENDING;

  @Column({ name: 'manual_note', type: 'text', nullable: true })
  manualNote: string | null = null;

  @Column({ name: 'manual_sku_decisions', type: 'simple-json', nullable: true })
  manualSkuDecisions: SkuManualDecision[] | null = null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null = null;

  @Column({ name: 'classified_at', type: 'datetime' })
  classifiedAt: Date;
}
