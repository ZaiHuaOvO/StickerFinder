import { Component, computed, input, output } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { PLATFORM_META, TASK_STATUS_META } from '../../core/labels';
import { PlatformResult, Product } from '../../core/models';
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
  readonly bannerTitle = computed(() => {
    const result = this.result();
    switch (result.status) {
      case 'PENDING':
      case 'RUNNING':
        return '正在采集该平台…';
      case 'NOT_CONFIGURED':
        return '该平台尚未配置可用的数据来源';
      case 'FAILED':
        return '采集失败';
      case 'BLOCKED':
        return '平台要求人工处理';
      case 'EMPTY':
        return '未找到符合条件的商品';
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
        return '请稍候，页面会自动刷新结果。';
      case 'NOT_CONFIGURED':
        return result.errorMessage ?? '未配置凭证或采集通道。';
      case 'FAILED':
        return [result.errorCode, result.errorMessage].filter(Boolean).join(' · ');
      case 'BLOCKED':
        return result.errorMessage ?? '请先在可见浏览器中完成登录或验证。';
      case 'EMPTY':
        return '平台可正常访问，但本次搜索没有返回候选商品。空结果不等于采集失败。';
      case 'SUCCESS':
        return `采集到 ${result.resultCount} 个候选商品，其中匹配 ${result.matchedCount} 个、待确认 ${result.uncertainCount} 个。`;
      default:
        return '';
    }
  });
  readonly bannerType = computed(() => {
    switch (this.result().status) {
      case 'FAILED':
      case 'BLOCKED':
        return 'error';
      case 'NOT_CONFIGURED':
        return 'warning';
      case 'EMPTY':
        return 'info';
      default:
        return 'success';
    }
  });
  readonly providerLabel = computed(() => {
    const type = this.result().providerType;
    if (type === 'official_api') return '官方 API';
    if (type === 'browser') return '浏览器采集';
    if (type === 'third_party') return '第三方数据服务';
    return '未配置';
  });
}
