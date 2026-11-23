import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  SearchRun,
} from '../entities';

export function envBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  const dbType = (config.get<string>('DB_TYPE') ?? 'mysql').toLowerCase();
  const synchronize = envBool(config.get<string>('DB_SYNCHRONIZE'), true);
  const logging = envBool(config.get<string>('DB_LOGGING'), false);
  const entities = [SearchRun, PlatformSearchTask, ProductCandidate, ProductMatchResult];

  if (dbType === 'sqlite') {
    const database = resolve(
      process.cwd(),
      config.get<string>('SQLITE_PATH') ?? join('data', 'sticker-finder.sqlite'),
    );
    mkdirSync(dirname(database), { recursive: true });
    return {
      type: 'better-sqlite3',
      database,
      entities,
      synchronize,
      logging,
    };
  }

  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST') ?? '127.0.0.1',
    port: envInt(config.get<string>('DB_PORT'), 3306),
    username: config.get<string>('DB_USERNAME') ?? 'root',
    password: config.get<string>('DB_PASSWORD') ?? '',
    database: config.get<string>('DB_DATABASE') ?? 'sticker_finder',
    charset: 'utf8mb4',
    entities,
    synchronize,
    logging,
    retryAttempts: 3,
    retryDelay: 2000,
  };
}
