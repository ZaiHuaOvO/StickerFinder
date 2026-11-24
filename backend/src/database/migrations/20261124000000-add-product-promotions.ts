import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * 新增优惠信息表与券后价字段。
 * 不删除、不修改任何已有列，可安全回滚。
 */
export class AddProductPromotions20261124000000 implements MigrationInterface {
  name = 'AddProductPromotions20261124000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('product_promotions'))) {
      await queryRunner.createTable(
        new Table({
          name: 'product_promotions',
          columns: [
            { name: 'id', type: 'varchar', length: '36', isPrimary: true },
            {
              name: 'observation_id',
              type: 'varchar',
              length: '36',
              isNullable: false,
            },
            { name: 'sku_id', type: 'varchar', length: '200', isNullable: true },
            { name: 'platform', type: 'varchar', length: '32', isNullable: false },
            {
              name: 'promotion_type',
              type: 'varchar',
              length: '32',
              isNullable: false,
            },
            { name: 'name', type: 'varchar', length: '255', isNullable: false },
            { name: 'amount', type: 'float', isNullable: true },
            { name: 'currency', type: 'varchar', length: '16', isNullable: true },
            { name: 'discount_rate', type: 'float', isNullable: true },
            { name: 'minimum_spend', type: 'float', isNullable: true },
            { name: 'start_time', type: 'datetime', isNullable: true },
            { name: 'end_time', type: 'datetime', isNullable: true },
            { name: 'description', type: 'text', isNullable: true },
            { name: 'promotion_url', type: 'text', isNullable: true },
            { name: 'source', type: 'varchar', length: '64', isNullable: true },
            { name: 'raw_data', type: 'text', isNullable: true },
            { name: 'observed_at', type: 'datetime', isNullable: false },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
          foreignKeys: [
            {
              name: 'FK_product_promotions_observation',
              columnNames: ['observation_id'],
              referencedTableName: 'product_observations',
              referencedColumnNames: ['id'],
              onDelete: 'CASCADE',
            },
          ],
          indices: [
            {
              name: 'IDX_product_promotions_observation',
              columnNames: ['observation_id', 'promotion_type'],
            },
            {
              name: 'IDX_product_promotions_platform',
              columnNames: ['platform', 'promotion_type'],
            },
          ],
        }),
      );
    }

    if (
      (await queryRunner.hasTable('product_observations')) &&
      !(await queryRunner.hasColumn('product_observations', 'coupon_price_data'))
    ) {
      await queryRunner.query(
        'ALTER TABLE product_observations ADD COLUMN coupon_price_data text NULL',
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('product_observations')) &&
      (await queryRunner.hasColumn('product_observations', 'coupon_price_data'))
    ) {
      await queryRunner.dropColumn('product_observations', 'coupon_price_data');
    }
    if (await queryRunner.hasTable('product_promotions')) {
      await queryRunner.dropTable('product_promotions', true);
    }
  }
}
