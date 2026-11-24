import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  ManualDecisionEnum,
  MatchTypeEnum,
} from '../common/enums';
import {
  RulePriceStatusEnum,
  RuleStatusEnum,
} from '../rules/rule.types';
import type { SkuManualDecision } from './product-match-result.entity';
import { ProductCandidate } from './product-candidate.entity';

/**
 * 规则识别结果，与旧的 AI 判断表分开保存。
 * 新搜索只写这张表，历史 AI 记录保持原样。
 */
@Entity({ name: 'product_rule_results' })
@Index(['candidateId'], { unique: true })
@Index(['status'])
export class ProductRuleResult {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'candidate_id', type: 'varchar', length: 36 })
  candidateId: string;

  @Column({ type: 'varchar', length: 32 })
  status: RuleStatusEnum;

  @Column({ name: 'price_status', type: 'varchar', length: 32 })
  priceStatus: RulePriceStatusEnum;

  @Column({ name: 'title_matched', type: 'boolean', default: false })
  titleMatched: boolean = false;

  @Column({ name: 'detail_checked', type: 'boolean', default: false })
  detailChecked: boolean = false;

  @Column({ name: 'matched_target_keywords', type: 'simple-json' })
  matchedTargetKeywords: string[] = [];

  @Column({ name: 'matched_series_keywords', type: 'simple-json' })
  matchedSeriesKeywords: string[] = [];

  @Column({ name: 'matched_sku_ids', type: 'simple-json' })
  matchedSkuIds: string[] = [];

  @Column({ name: 'matched_contents', type: 'simple-json' })
  matchedContents: string[] = [];

  @Column({ name: 'match_type', type: 'varchar', length: 48, nullable: true })
  matchType: MatchTypeEnum | null = null;

  @Column({ type: 'text', nullable: true })
  reason: string | null = null;

  @Column({ name: 'detail_error', type: 'text', nullable: true })
  detailError: string | null = null;

  @Column({ name: 'price_amount', type: 'float', nullable: true })
  priceAmount: number | null = null;

  @Column({ name: 'price_currency', type: 'varchar', length: 16, nullable: true })
  priceCurrency: string | null = null;

  @Column({ name: 'price_source', type: 'varchar', length: 16, nullable: true })
  priceSource: string | null = null;

  @Column({ name: 'price_sku_id', type: 'varchar', length: 200, nullable: true })
  priceSkuId: string | null = null;

  @Column({ name: 'price_note', type: 'text', nullable: true })
  priceNote: string | null = null;

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

  @Column({ name: 'evaluated_at', type: 'datetime' })
  evaluatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @OneToOne(() => ProductCandidate, (candidate) => candidate.ruleResult, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'candidate_id' })
  candidate: ProductCandidate;
}
