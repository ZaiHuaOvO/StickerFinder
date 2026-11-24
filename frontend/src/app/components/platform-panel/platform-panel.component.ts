import { Component, computed, input, output } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import {
  PLATFORM_META,
  TASK_STATUS_META,
} from '../../core/labels';
import {
  ChannelResult,
  PlatformResult,
  Product,
  VerificationAction,
  VerificationActionEvent,
} from '../../core/models';
import { ProductCardComponent } from '../product-card/product-card.component';

@Component({
  selector: 'app-platform-panel',
  imports: [
    NzAlertModule,
    NzButtonModule,
    NzCollapseModule,
    NzEmptyModule,
    NzIconModule,
    NzSpinModule,
    NzTagModule,
    ProductCardComponent,
  ],
  templateUrl: './platform-panel.component.html',
  styleUrl: './platform-panel.component.less',
})
export class PlatformPanelComponent {
  readonly result = input.required<PlatformResult>();
  readonly searchId = input.required<string>();
  readonly busyTaskId = input<string | null>(null);
  readonly readonlyMode = input(false);
  readonly reviewed = output<Product>();
  readonly verification = output<VerificationActionEvent>();

  readonly platform = computed(() => PLATFORM_META[this.result().platform]);
  readonly statusMeta = computed(() => TASK_STATUS_META[this.result().status]);
  readonly isWorking = computed(
    () => this.result().status === 'PENDING' || this.result().status === 'RUNNING',
  );
  readonly channels = computed(() => this.result().channels ?? []);
  readonly excludedProducts = computed(() => this.result().excludedProducts ?? []);
  readonly recognizedCount = computed(
    () =>
      this.result().products.length + this.result().uncertainProducts.length,
  );
  readonly ruleStats = computed(() => {
    const all = [
      ...this.result().products,
      ...this.result().uncertainProducts,
      ...this.excludedProducts(),
    ];
    return {
      titleMatched: all.filter((product) => product.rule?.titleMatched).length,
      detailConfirmed: all.filter(
        (product) =>
          product.rule?.detailChecked &&
          product.rule.status !== 'RULE_NO_MATCH',
      ).length,
      priceValid: all.filter(
        (product) => product.rule?.priceStatus === 'PRICE_VALID',
      ).length,
    };
  });
  readonly progressText = computed(() => {
    const stats = this.ruleStats();
    return `已找到 ${this.result().resultCount} · 标题命中 ${stats.titleMatched} · 详情确认 ${stats.detailConfirmed} · 价格有效 ${stats.priceValid}`;
  });
  readonly waitingChannels = computed(() =>
    this.channels().filter((channel) => channel.status === 'WAITING_MANUAL_VERIFICATION'),
  );
  readonly goodsUnavailable = computed(() =>
    this.channels().some((channel) => channel.errorCode === 'GOODS_SEARCH_UNAVAILABLE'),
  );
  readonly successfulChannelCount = computed(
    () =>
      this.channels().filter(
        (channel) => channel.status === 'SUCCESS' || channel.status === 'PARTIAL_SUCCESS',
      ).length,
  );
  readonly bannerTitle = computed(() => {
    const result = this.result();
    switch (result.status) {
      case 'PENDING':
      case 'RUNNING':
        return '正在采集该平台…';
      case 'WAITING_MANUAL_VERIFICATION':
        return '等待人工完成平台验证';
      case 'NOT_CONFIGURED':
        return '该平台的来源均未配置';
      case 'FAILED':
        return '采集失败';
      case 'EMPTY':
        return '未找到符合条件的商品';
      case 'PARTIAL_SUCCESS':
        return '部分来源采集成功';
      case 'SUCCESS':
        return result.matchedCount > 0
          ? `找到 ${result.matchedCount} 个匹配商品`
          : '有候选商品，但暂无确认匹配';
      default:
        return '';
    }
  });
  readonly bannerDescription = computed(() => {
    const result = this.result();
    switch (result.status) {
      case 'PENDING':
      case 'RUNNING':
      case 'SUCCESS':
      case 'EMPTY':
        return '';
      case 'WAITING_MANUAL_VERIFICATION':
        return '在打开的浏览器里完成验证码或登录后，点「继续采集」。';
      case 'NOT_CONFIGURED':
        return result.errorMessage ?? '该平台未配置数据来源。';
      case 'FAILED':
        return (
          result.errorMessage ??
          this.channels()
            .filter((channel) => channel.errorCode)
            .map((channel) => `${channel.providerLabel}：${channel.errorMessage ?? channel.errorCode}`)
            .join('；')
        );
      case 'PARTIAL_SUCCESS':
        return `有效来源 ${this.successfulChannelCount()}/${this.channels().length} 个；匹配 ${result.matchedCount} 个、待确认 ${result.uncertainCount} 个。`;
      default:
        return '';
    }
  });
  readonly bannerType = computed(() => {
    switch (this.result().status) {
      case 'FAILED':
        return 'error';
      case 'WAITING_MANUAL_VERIFICATION':
      case 'NOT_CONFIGURED':
      case 'PARTIAL_SUCCESS':
        return 'warning';
      case 'EMPTY':
        return 'info';
      case 'CANCELLED':
        return 'info';
      default:
        return 'success';
    }
  });

  channelStatus(channel: ChannelResult) {
    return TASK_STATUS_META[channel.status];
  }

  isBusy(channel: ChannelResult): boolean {
    return this.busyTaskId() === channel.taskId;
  }

  emitVerification(channel: ChannelResult, action: VerificationAction): void {
    this.verification.emit({ taskId: channel.taskId, action });
  }

  verificationHint(channel: ChannelResult): string {
    if (channel.errorCode === 'LOGIN_REQUIRED') {
      return '需要登录：在验证浏览器中完成登录，再点「继续采集」。';
    }
    return '遇到平台验证：在验证浏览器中完成后，再点「继续采集」。';
  }
}
