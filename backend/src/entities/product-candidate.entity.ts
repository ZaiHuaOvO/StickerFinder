import { randomUUID } from 'crypto';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { PlatformEnum, SourceTypeEnum } from '../common/enums';
import { PriceInfo, SkuOption } from '../common/interfaces/price.interface';
import { ProductMatchResult } from './product-match-result.entity';
import { SearchRun } from './search-run.entity';

@Entity({ name: 'product_candidates' })
@Index(['searchRunId', 'platform'])
@Index(['platform', 'platformProductId'])
export class ProductCandidate {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'search_run_id', type: 'varchar', length: 36 })
  searchRunId: string;

  @Column({ type: 'varchar', length: 32 })
  platform: PlatformEnum;

  @Column({ name: 'platform_product_id', type: 'varchar', length: 200, nullable: true })
  platformProductId: string | null = null;

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

  @Column({ name: 'group_price_data', type: 'simple-json', nullable: true })
  groupPriceData: PriceInfo | null = null;

  @Column({ name: 'source_type', type: 'varchar', length: 32 })
  sourceType: SourceTypeEnum;

  @Column({ name: 'raw_data', type: 'simple-json', nullable: true })
  rawData: Record<string, unknown> | null = null;

  @Column({ name: 'collected_at', type: 'datetime' })
  collectedAt: Date;

  @ManyToOne(() => SearchRun, (run) => run.candidates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'search_run_id' })
  searchRun: SearchRun;

  @OneToOne(() => ProductMatchResult, (result) => result.candidate)
  matchResult?: ProductMatchResult;
}
