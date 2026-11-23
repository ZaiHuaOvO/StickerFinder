import { Component, computed, input, output } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import {
  formatDuration,
  PLATFORM_META,
  TASK_STATUS_META,
} from '../../core/labels';
import { ChannelResult, PlatformResult, Product } from '../../core/models';
import { ProductCardComponent } from '../product-card/product-card.component';

@Component({
  selector: 'app-platform-panel',
  imports: [
    NzAlertModule,
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
  readonly reviewed = output<Product>();

  readonly platform = computed(() => PLATFORM_META[this.result().platform]);
  readonly statusMeta = computed(() => TASK_STATUS_META[this.result().status]);
  readonly isWorking = computed(
    () => this.result().status === 'PENDING' || this.result().status === 'RUNNING',
  );
  readonly channels = computed(() => this.result().channels ?? []);
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
        return '请稍候，页面会自动刷新各来源结果。';
      case 'NOT_CONFIGURED':
        return (
          result.errorMessage ??
          this.channels()
            .map((channel) => `${channel.providerLabel}：${channel.errorMessage ?? '未配置'}`)
            .join('；')
        );
      case 'FAILED':
        return (
          result.errorMessage ??
          this.channels()
            .filter((channel) => channel.errorCode)
            .map((channel) => `${channel.providerLabel}：${channel.errorMessage ?? channel.errorCode}`)
            .join('；')
        );
      case 'EMPTY':
        return '已配置的来源可正常访问，但本次搜索没有返回候选商品。空结果不等于采集失败。';
      case 'PARTIAL_SUCCESS':
        return `有效来源 ${this.successfulChannelCount()}/${this.channels().length} 个；采集到 ${result.resultCount} 个候选商品，其中匹配 ${result.matchedCount} 个、待确认 ${result.uncertainCount} 个。失败来源见下方渠道状态。`;
      case 'SUCCESS':
        return `${this.channels().length} 个来源均采集成功；候选 ${result.resultCount} 个，其中匹配 ${result.matchedCount} 个、待确认 ${result.uncertainCount} 个。`;
      default:
        return '';
    }
  });
  readonly bannerType = computed(() => {
    switch (this.result().status) {
      case 'FAILED':
        return 'error';
      case 'NOT_CONFIGURED':
      case 'PARTIAL_SUCCESS':
        return 'warning';
      case 'EMPTY':
        return 'info';
      default:
        return 'success';
    }
  });

  channelStatus(channel: ChannelResult) {
    return TASK_STATUS_META[channel.status];
  }

  channelDuration(channel: ChannelResult): string {
    return formatDuration(channel.durationMs);
  }
}
