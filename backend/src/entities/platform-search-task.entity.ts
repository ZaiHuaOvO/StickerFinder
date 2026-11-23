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
