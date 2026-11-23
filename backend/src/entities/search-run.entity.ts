import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { SearchRunStatusEnum } from '../common/enums';
import { PlatformSearchTask } from './platform-search-task.entity';
import { ProductCandidate } from './product-candidate.entity';
import { ProductObservation } from './product-observation.entity';

@Entity({ name: 'search_runs' })
export class SearchRun {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'target_name', type: 'varchar', length: 200 })
  targetName: string;

  @Column({ name: 'series_name', type: 'varchar', length: 200, nullable: true })
  seriesName: string | null = null;

  @Column({ type: 'simple-json' })
  aliases: string[] = [];

  @Column({ name: 'reference_image', type: 'varchar', length: 500, nullable: true })
  referenceImage: string | null = null;

  @Column({ type: 'varchar', length: 32, default: SearchRunStatusEnum.PENDING })
  status: SearchRunStatusEnum = SearchRunStatusEnum.PENDING;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null = null;

  @CreateDateColumn({ name: 'started_at', type: 'datetime' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null = null;

  @OneToMany(() => PlatformSearchTask, (task) => task.searchRun)
  platformTasks: PlatformSearchTask[];

  @OneToMany(() => ProductCandidate, (candidate) => candidate.searchRun)
  candidates: ProductCandidate[];

  @OneToMany(() => ProductObservation, (observation) => observation.searchRun)
  observations: ProductObservation[];
}
