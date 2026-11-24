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
import { PlatformEnum, PromotionTypeEnum } from '../common/enums';
import { ProductObservation } from './product-observation.entity';

/**
 * 某个商品观察记录中，接口明确返回的一条优惠信息。
 * 同一次采集返回多张券/多个活动时分别保存；不同采集时间由不同观察记录保留。
 */
@Entity({ name: 'product_promotions' })
@Index(['observationId', 'promotionType'])
@Index(['platform', 'promotionType'])
export class ProductPromotion {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string = randomUUID();

  @Column({ name: 'observation_id', type: 'varchar', length: 36 })
  observationId: string;

  /** 为空表示商品级优惠；接口未说明适用于全部 SKU 时不得复制到各 SKU */
  @Column({ name: 'sku_id', type: 'varchar', length: 200, nullable: true })
  skuId: string | null = null;

  @Column({ type: 'varchar', length: 32 })
  platform: PlatformEnum;

  @Column({ name: 'promotion_type', type: 'varchar', length: 32 })
  promotionType: PromotionTypeEnum;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /** 优惠金额，不是券后价；接口未返回时为 null */
  @Column({ type: 'float', nullable: true })
  amount: number | null = null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  currency: string | null = null;

  /** 折扣比例，0–1 */
  @Column({ name: 'discount_rate', type: 'float', nullable: true })
  discountRate: number | null = null;

  @Column({ name: 'minimum_spend', type: 'float', nullable: true })
  minimumSpend: number | null = null;

  @Column({ name: 'start_time', type: 'datetime', nullable: true })
  startTime: Date | null = null;

  @Column({ name: 'end_time', type: 'datetime', nullable: true })
  endTime: Date | null = null;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ name: 'promotion_url', type: 'text', nullable: true })
  promotionUrl: string | null = null;

  /** 采集该优惠的渠道标识（provider key），便于回溯来源 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null = null;

  /** 只保留优惠相关原始字段，不复制整个接口响应 */
  @Column({ name: 'raw_data', type: 'simple-json', nullable: true })
  rawData: Record<string, unknown> | null = null;

  @Column({ name: 'observed_at', type: 'datetime' })
  observedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @ManyToOne(() => ProductObservation, (observation) => observation.promotions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'observation_id' })
  observation: ProductObservation;
}
