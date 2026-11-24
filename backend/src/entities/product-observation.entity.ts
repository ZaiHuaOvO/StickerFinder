import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
} from '../common/enums';
import { PriceInfo, SkuOption } from '../common/interfaces/price.interface';
import { WholesalePriceInfo } from '../common/interfaces/wholesale-price.interface';
import { PlatformSearchTask } from './platform-search-task.entity';
import { ProductCandidate } from './product-candidate.entity';
import { SearchRun } from './search-run.entity';

/**
 * 某一次搜索中，某个来源在某个时间采集到的商品快照。
 * 同一候选商品可以有多个观察记录，价格不能相互覆盖。
 */
@Entity({ name: 'product_observations' })
@Index(['searchRunId', 'platform'])
@Index(['candidateId', 'provider'])
export class ProductObservation {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'search_run_id', type: 'varchar', length: 36 })
  searchRunId: string;

  @Column({ name: 'candidate_id', type: 'varchar', length: 36 })
  candidateId: string;

  @Column({ name: 'provider_task_id', type: 'varchar', length: 36, nullable: true })
  providerTaskId: string | null = null;

  @Column({ type: 'varchar', length: 32 })
  platform: PlatformEnum;

  @Column({ type: 'varchar', length: 32 })
  provider: ProviderKeyEnum;

  @Column({ type: 'varchar', length: 32 })
  source: ObservationSourceEnum;

  @Column({ name: 'source_product_id', type: 'varchar', length: 200, nullable: true })
  sourceProductId: string | null = null;

  @Column({ type: 'varchar', length: 512 })
  title: string;

  @Column({ name: 'shop_name', type: 'varchar', length: 255, nullable: true })
  shopName: string | null = null;

  @Column({ name: 'product_url', type: 'text' })
  productUrl: string;

  @Column({ name: 'image_urls', type: 'simple-json' })
  imageUrls: string[] = [];

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'sku_data', type: 'simple-json' })
  skuData: SkuOption[] = [];

  @Column({ name: 'price_data', type: 'simple-json', nullable: true })
  priceData: PriceInfo | null = null;

  @Column({ name: 'original_price_data', type: 'simple-json', nullable: true })
  originalPriceData: PriceInfo | null = null;

  @Column({ name: 'group_price_data', type: 'simple-json', nullable: true })
  groupPriceData: PriceInfo | null = null;

  /** 1688 等批发平台的采购价格，独立于零售 priceData */
  @Column({ name: 'wholesale_price_data', type: 'simple-json', nullable: true })
  wholesalePriceData: WholesalePriceInfo | null = null;

  @Column({ name: 'sales_text', type: 'varchar', length: 100, nullable: true })
  salesText: string | null = null;

  @Column({ type: 'float', nullable: true })
  rating: number | null = null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  region: string | null = null;

  @Column({ name: 'region_note', type: 'text', nullable: true })
  regionNote: string | null = null;

  /** new / strong:id / strong:url / strong:title_shop / ai_same_product */
  @Column({ name: 'match_reason', type: 'varchar', length: 100, nullable: true })
  matchReason: string | null = null;

  @Column({ name: 'raw_data', type: 'simple-json', nullable: true })
  rawData: Record<string, unknown> | null = null;

  @Column({ name: 'observed_at', type: 'datetime' })
  observedAt: Date;

  @Column({ name: 'collected_at', type: 'datetime' })
  collectedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => ProductCandidate, (candidate) => candidate.observations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'candidate_id' })
  candidate: ProductCandidate;

  @ManyToOne(() => SearchRun, (run) => run.observations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_run_id' })
  searchRun: SearchRun;

  @ManyToOne(() => PlatformSearchTask, (task) => task.observations, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'provider_task_id' })
  providerTask: PlatformSearchTask | null;
}
