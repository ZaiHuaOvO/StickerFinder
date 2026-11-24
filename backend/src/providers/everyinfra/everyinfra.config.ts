import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envBool, envInt } from '../../database/typeorm.config';
import { EveryInfraPlatform } from './everyinfra.types';

const PLATFORM_ENABLE_ENV: Record<EveryInfraPlatform, string> = {
  taobao: 'EVERYINFRA_TAOBAO_ENABLED',
  douyin: 'EVERYINFRA_DOUYIN_ENABLED',
  xiaohongshu: 'EVERYINFRA_XIAOHONGSHU_ENABLED',
  alibaba1688: 'EVERYINFRA_ALIBABA1688_ENABLED',
};

@Injectable()
export class EveryInfraConfig {
  constructor(private readonly config: ConfigService) {}

  get apiKey(): string {
    return (this.config.get<string>('EVERYINFRA_API_KEY') ?? '').trim();
  }

  get baseUrl(): string {
    return (
      this.config.get<string>('EVERYINFRA_BASE_URL') ?? 'https://api.everyinfra.com'
    ).replace(/\/+$/, '');
  }

  get enabled(): boolean {
    return envBool(this.config.get<string>('EVERYINFRA_ENABLED'), true);
  }

  get timeoutMs(): number {
    const dedicated = this.config.get<string>('EVERYINFRA_TIMEOUT_MS');
    if (dedicated !== undefined && dedicated !== '') {
      return Math.max(1000, envInt(dedicated, 30_000));
    }
    return Math.max(
      1000,
      envInt(this.config.get<string>('PROVIDER_HTTP_TIMEOUT_MS'), 30_000),
    );
  }

  /** 1688 搜索实测可能需要 30–60 秒，单独给更长超时。 */
  timeoutMsFor(platform: EveryInfraPlatform): number {
    if (platform !== 'alibaba1688') return this.timeoutMs;
    const dedicated = this.config.get<string>('EVERYINFRA_1688_TIMEOUT_MS');
    if (dedicated !== undefined && dedicated !== '') {
      return Math.max(1000, envInt(dedicated, 60_000));
    }
    return Math.max(this.timeoutMs, 60_000);
  }

  get detailEnabled(): boolean {
    return envBool(this.config.get<string>('EVERYINFRA_DETAIL_ENABLED'), true);
  }

  /** 每平台每轮最多自动补充的详情数量，硬上限 10，避免误操作产生费用 */
  get detailMaxPerPlatform(): number {
    return Math.min(
      10,
      Math.max(
        0,
        envInt(this.config.get<string>('EVERYINFRA_DETAIL_MAX_PER_PLATFORM'), 10),
      ),
    );
  }

  /** 详情请求并发上限，避免同时打满第三方接口 */
  get detailConcurrency(): number {
    return Math.min(
      5,
      Math.max(
        1,
        envInt(this.config.get<string>('EVERYINFRA_DETAIL_CONCURRENCY'), 2),
      ),
    );
  }

  get imageSearchEnabled(): boolean {
    return envBool(
      this.config.get<string>('EVERYINFRA_1688_IMAGE_SEARCH_ENABLED'),
      false,
    );
  }

  /** fixture = 只读本地测试数据；live = 允许真实采集（仍需显式开关） */
  get searchDataMode(): 'fixture' | 'live' {
    return (this.config.get<string>('SEARCH_DATA_MODE') ?? 'fixture')
      .trim()
      .toLowerCase() === 'live'
      ? 'live'
      : 'fixture';
  }

  get liveProviderRequestsEnabled(): boolean {
    return envBool(
      this.config.get<string>('LIVE_PROVIDER_REQUESTS_ENABLED'),
      false,
    );
  }

  /** 真实采集必须同时满足：live 模式 + 显式开关 */
  get liveRequestsAllowed(): boolean {
    return this.searchDataMode === 'live' && this.liveProviderRequestsEnabled;
  }

  isPlatformEnabled(platform: EveryInfraPlatform): boolean {
    return envBool(this.config.get<string>(PLATFORM_ENABLE_ENV[platform]), true);
  }

  /** 返回不可用原因；null 表示可用 */
  unavailableReason(platform: EveryInfraPlatform): string | null {
    if (!this.enabled) {
      return 'EveryInfra 已关闭（EVERYINFRA_ENABLED=false）';
    }
    if (!this.isPlatformEnabled(platform)) {
      return `该平台已关闭（${PLATFORM_ENABLE_ENV[platform]}=false）`;
    }
    if (!this.apiKey) {
      return '缺少配置：EVERYINFRA_API_KEY';
    }
    return null;
  }

  isAvailable(platform: EveryInfraPlatform): boolean {
    return this.unavailableReason(platform) === null;
  }

  /** 第一版默认只请求第一页 */
  maxPages(platform: EveryInfraPlatform): number {
    if (platform === 'taobao') {
      return Math.min(
        5,
        Math.max(1, envInt(this.config.get<string>('EVERYINFRA_TAOBAO_MAX_PAGES'), 1)),
      );
    }
    if (platform === 'xiaohongshu') {
      return Math.min(
        5,
        Math.max(
          1,
          envInt(this.config.get<string>('EVERYINFRA_XIAOHONGSHU_MAX_PAGES'), 1),
        ),
      );
    }
    // 抖音无可可靠分页；1688 第一版单次请求
    return 1;
  }

  /** 单页请求数量上限；抖音/小红书按接口实际返回数量（实现上限 50） */
  maxResults(platform: EveryInfraPlatform): number {
    switch (platform) {
      case 'taobao':
        return 20;
      case 'douyin':
      case 'xiaohongshu':
        return 50;
      case 'alibaba1688':
        return Math.min(
          100,
          Math.max(
            1,
            envInt(
              this.config.get<string>('EVERYINFRA_ALIBABA1688_MAX_RESULTS'),
              20,
            ),
          ),
        );
      default:
        return 20;
    }
  }
}
