import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * 新增规则识别结果表；不修改、不删除既有 AI 判断数据。
 */
export class AddProductRuleResults20261124100000 implements MigrationInterface {
  name = 'AddProductRuleResults20261124100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('product_rule_results')) return;
    await queryRunner.createTable(
      new Table({
        name: 'product_rule_results',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'candidate_id', type: 'varchar', length: '36', isNullable: false },
          { name: 'status', type: 'varchar', length: '32', isNullable: false },
          { name: 'price_status', type: 'varchar', length: '32', isNullable: false },
          { name: 'title_matched', type: 'boolean', default: 0 },
          { name: 'detail_checked', type: 'boolean', default: 0 },
          { name: 'matched_target_keywords', type: 'text', isNullable: true },
          { name: 'matched_series_keywords', type: 'text', isNullable: true },
          { name: 'matched_sku_ids', type: 'text', isNullable: true },
          { name: 'matched_contents', type: 'text', isNullable: true },
          { name: 'match_type', type: 'varchar', length: '48', isNullable: true },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'detail_error', type: 'text', isNullable: true },
          { name: 'price_amount', type: 'float', isNullable: true },
          { name: 'price_currency', type: 'varchar', length: '16', isNullable: true },
          { name: 'price_source', type: 'varchar', length: '16', isNullable: true },
          { name: 'price_sku_id', type: 'varchar', length: '200', isNullable: true },
          { name: 'price_note', type: 'text', isNullable: true },
          {
            name: 'manual_decision',
            type: 'varchar',
            length: '16',
            default: "'PENDING'",
          },
          { name: 'manual_note', type: 'text', isNullable: true },
          { name: 'manual_sku_decisions', type: 'text', isNullable: true },
          { name: 'reviewed_at', type: 'datetime', isNullable: true },
          { name: 'evaluated_at', type: 'datetime', isNullable: false },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            name: 'FK_product_rule_results_candidate',
            columnNames: ['candidate_id'],
            referencedTableName: 'product_candidates',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'IDX_product_rule_results_candidate',
            columnNames: ['candidate_id'],
            isUnique: true,
          },
          {
            name: 'IDX_product_rule_results_status',
            columnNames: ['status'],
          },
        ],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('product_rule_results')) {
      await queryRunner.dropTable('product_rule_results', true);
    }
  }
}
