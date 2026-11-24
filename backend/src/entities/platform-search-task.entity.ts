import { randomUUID } from 'crypto';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import {
  PlatformEnum,
  PlatformTaskStatusEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../common/enums';
import { ManualVerificationState } from '../common/interfaces/manual-verification.interface';
import { ProductObservation } from './product-observation.entity';
import { SearchRun } from './search-run.entity';

@Entity({ name: 'platform_search_tasks' })
@Index(['searchRunId', 'platform', 'provider'], { unique: true })
export class PlatformSearchTask {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'search_run_id', type: 'varchar', length: 36 })
  searchRunId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: PlatformEnum;

  @Column({ type: 'varchar', length: 32, default: 'legacy' })
  provider: ProviderKeyEnum | string = 'legacy';

  @Column({ name: 'provider_type', type: 'varchar', length: 32, nullable: true })
  providerType: SourceTypeEnum | null = null;

  @Column({ type: 'varchar', length: 32, default: PlatformTaskStatusEnum.PENDING })
  status: PlatformTaskStatusEnum = PlatformTaskStatusEnum.PENDING;

  @Column({ name: 'result_count', type: 'int', default: 0 })
  resultCount: number = 0;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode: string | null = null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null = null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note: string | null = null;

  /** 本轮该渠道实际发起的收费 API 请求次数（以服务商响应为准） */
  @Column({ name: 'api_request_count', type: 'int', default: 0 })
  apiRequestCount: number = 0;

  /** 服务商 billing 返回的实际扣费（美元）；没有 billing 时为 null，不做本地估算 */
  @Column({ name: 'charged_usd', type: 'float', nullable: true })
  chargedUsd: number | null = null;

  /** 服务商返回的最近一次请求 ID，便于对账 */
  @Column({ name: 'last_request_id', type: 'varchar', length: 200, nullable: true })
  lastRequestId: string | null = null;

  /** 等待人工验证时保存的关键词、目标 URL、Profile 与进度 */
  @Column({ name: 'manual_verification', type: 'simple-json', nullable: true })
  manualVerification: ManualVerificationState | null = null;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt: Date | null = null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null = null;

  @ManyToOne(() => SearchRun, (run) => run.platformTasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_run_id' })
  searchRun: SearchRun;

  @OneToMany(() => ProductObservation, (observation) => observation.providerTask)
  observations: ProductObservation[];
}
