import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { NormalizedProduct } from '../common/interfaces/normalized-product.interface';

export interface FixtureDetailEntry {
  sourceProductId: string | null;
  product: NormalizedProduct | null;
  error?: string;
  warnings?: string[];
}

export interface FixturePlatformData {
  status?: string;
  warnings?: string[];
  products: NormalizedProduct[];
  details: FixtureDetailEntry[];
  error?: string;
  skipped?: string;
}

export interface FixtureDataset {
  id: string;
  targetName: string;
  seriesName: string | null;
  collectedAt: string;
  source?: string;
  platforms: Record<string, FixturePlatformData>;
}

export interface FixtureSummary {
  id: string;
  targetName: string;
  seriesName: string | null;
  collectedAt: string;
  platforms: Array<{
    platform: string;
    productCount: number;
    detailCount: number;
    status: string | null;
  }>;
}

/**
 * 只读加载本地测试数据；不存在时明确报错，绝不回退到在线接口。
 */
@Injectable()
export class FixtureService {
  constructor(private readonly config: ConfigService) {}

  private get dir(): string {
    return resolve(
      process.cwd(),
      this.config.get<string>('FIXTURE_DIR') ?? 'test/fixtures/raw',
    );
  }

  list(): FixtureSummary[] {
    if (!existsSync(this.dir)) return [];
    const summaries: FixtureSummary[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith('.json') || entry === 'manifest.json') continue;
      try {
        const dataset = this.parse(entry);
        summaries.push({
          id: dataset.id,
          targetName: dataset.targetName,
          seriesName: dataset.seriesName,
          collectedAt: dataset.collectedAt,
          platforms: Object.entries(dataset.platforms).map(([platform, value]) => ({
            platform,
            productCount: value.products?.length ?? 0,
            detailCount: value.details?.length ?? 0,
            status: value.status ?? (value.error ? 'ERROR' : value.skipped ? 'SKIPPED' : null),
          })),
        });
      } catch {
        // 损坏的测试文件不应让整个列表失败。
      }
    }
    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): FixtureDataset {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new NotFoundException('测试数据 ID 不合法');
    }
    const file = resolve(this.dir, `${id}.json`);
    if (!existsSync(file)) {
      throw new NotFoundException(
        '本地没有可用的测试数据；不会自动切换到真实接口。',
      );
    }
    return this.parse(`${id}.json`);
  }

  private parse(fileName: string): FixtureDataset {
    const text = readFileSync(resolve(this.dir, fileName), 'utf8');
    const data = JSON.parse(text) as FixtureDataset;
    if (!data?.id || !data.platforms) {
      throw new Error(`测试数据格式不完整：${fileName}`);
    }
    for (const value of Object.values(data.platforms)) {
      value.products = value.products ?? [];
      value.details = value.details ?? [];
    }
    return data;
  }
}
