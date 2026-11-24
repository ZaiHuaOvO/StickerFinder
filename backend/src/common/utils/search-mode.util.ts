import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SearchDataMode = 'fixture' | 'live';

export function parseSearchDataMode(value: string | undefined): SearchDataMode {
  return (value ?? 'fixture').trim().toLowerCase() === 'live'
    ? 'live'
    : 'fixture';
}

export function liveRequestsEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('LIVE_PROVIDER_REQUESTS_ENABLED') ?? '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/**
 * 真实采集需要同时满足：live 模式 + 显式开关 + 用户主动发起。
 * 页面加载、历史查看、回放与测试都不会经过这里。
 */
export function assertLiveSearchAllowed(config: ConfigService): void {
  const mode = parseSearchDataMode(config.get<string>('SEARCH_DATA_MODE'));
  if (mode !== 'live') {
    throw new BadRequestException(
      '当前为本地测试模式（SEARCH_DATA_MODE=fixture），不会调用任何外部数据接口；请使用离线回放。',
    );
  }
  if (!liveRequestsEnabled(config)) {
    throw new BadRequestException(
      '真实采集未启用（LIVE_PROVIDER_REQUESTS_ENABLED=false），不会调用任何外部数据接口。',
    );
  }
}
