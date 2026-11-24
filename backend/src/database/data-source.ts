import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.config';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), '../.env') });

const options = buildTypeOrmOptions(new ConfigService()) as DataSourceOptions;

/** TypeORM CLI 使用；运行时连接仍由 TypeOrmModule 管理。 */
export default new DataSource({
  ...options,
  // 迁移是唯一受控的改表方式，CLI 下不使用 synchronize。
  synchronize: false,
});
