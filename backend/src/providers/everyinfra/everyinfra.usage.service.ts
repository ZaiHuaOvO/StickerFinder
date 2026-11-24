import { Injectable } from '@nestjs/common';
import { EveryInfraPlatform } from './everyinfra.types';

export interface EveryInfraUsageEntry {
  at: string;
  platform: EveryInfraPlatform;
  action: string;
  requestId: string | null;
  httpStatus: number | null;
  /** 仅记录服务商 billing 返回值；缺失时为 null，不做本地估算 */
  chargedUsd: number | null;
  balanceAfterUsd: number | null;
  durationMs: number;
  success: boolean;
  errorCode: string | null;
}

export interface EveryInfraUsageSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  /** 仅累计 billing 中明确返回的扣费；没有 billing 的请求不计入 */
  totalChargedUsd: number | null;
  byPlatform: Record<
    string,
    { calls: number; chargedUsd: number | null }
  >;
  byAction: Record<string, number>;
  recent: EveryInfraUsageEntry[];
  note: string;
}

const MAX_RECENT = 200;

@Injectable()
export class EveryInfraUsageService {
  private readonly entries: EveryInfraUsageEntry[] = [];
  private totalCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private chargedKnown = false;
  private totalChargedUsd = 0;
  private readonly platformTotals = new Map<
    string,
    { calls: number; chargedUsd: number | null }
  >();
  private readonly actionTotals = new Map<string, number>();

  record(entry: EveryInfraUsageEntry): void {
    this.totalCalls += 1;
    if (entry.success) {
      this.successfulCalls += 1;
    } else {
      this.failedCalls += 1;
    }

    const platform = this.platformTotals.get(entry.platform) ?? {
      calls: 0,
      chargedUsd: null,
    };
    platform.calls += 1;
    if (typeof entry.chargedUsd === 'number') {
      platform.chargedUsd = (platform.chargedUsd ?? 0) + entry.chargedUsd;
    }
    this.platformTotals.set(entry.platform, platform);

    this.actionTotals.set(
      entry.action,
      (this.actionTotals.get(entry.action) ?? 0) + 1,
    );

    if (typeof entry.chargedUsd === 'number') {
      this.chargedKnown = true;
      this.totalChargedUsd += entry.chargedUsd;
    }

    this.entries.push(entry);
    if (this.entries.length > MAX_RECENT) {
      this.entries.splice(0, this.entries.length - MAX_RECENT);
    }
  }

  summary(): EveryInfraUsageSummary {
    return {
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      failedCalls: this.failedCalls,
      totalChargedUsd: this.chargedKnown ? this.totalChargedUsd : null,
      byPlatform: Object.fromEntries(this.platformTotals),
      byAction: Object.fromEntries(this.actionTotals),
      recent: [...this.entries].slice(-50).reverse(),
      note:
        '金额只来自服务商响应中的 billing；没有 billing 的请求不计为扣费，也不做本地估算。服务重启后此内存统计会清零，数据库中的任务字段仍保留。',
    };
  }
}
