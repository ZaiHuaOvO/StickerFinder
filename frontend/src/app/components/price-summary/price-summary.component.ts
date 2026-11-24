import { Component, computed, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { PLATFORM_META, PRICE_GROUP_LABEL } from '../../core/labels';
import {
  Platform,
  PlatformResult,
  PriceComparisonGroup,
  PriceGroupSummary,
  PriceSummary,
} from '../../core/models';

@Component({
  selector: 'app-price-summary',
  imports: [NzButtonModule],
  templateUrl: './price-summary.component.html',
  styleUrl: './price-summary.component.less',
})
export class PriceSummaryComponent {
  readonly summary = input<PriceSummary | null>(null);
  readonly platforms = input<PlatformResult[]>([]);
  readonly searching = input(false);
  readonly showUncertain = output<void>();

  readonly best = computed(() => this.summary()?.bestPrice ?? null);
  readonly groupBest = computed(() => {
    const bestGroup = this.best()?.comparisonGroup;
    return (this.summary()?.bestByGroup ?? []).filter(
      (item) =>
        item.comparisonGroup !== 'WHOLESALE' &&
        item.comparisonGroup !== bestGroup,
    );
  });
  readonly platformCards = computed(() => {
    const summary = this.summary();
    return this.platforms().map((result) => {
      const platformSummary = summary?.platforms.find(
        (item) => item.platform === result.platform,
      );
      const pick = (group: PriceComparisonGroup): PriceGroupSummary | undefined =>
        platformSummary?.groups.find(
          (item) => item.group === group && item.minAmount !== null,
        );
      const single = pick('TARGET_SINGLE');
      const bundle = pick('TARGET_BUNDLE');
      const full = pick('TARGET_FULL_SET');
      let priceText = '暂无已确认价格';
      let note = '';
      if (result.platform === 'alibaba1688' && platformSummary?.wholesale) {
        const wholesale = platformSummary.wholesale;
        if (wholesale.priceMin !== null) {
          const min = this.formatAmount(wholesale.priceMin, wholesale.currency);
          const max =
            wholesale.priceMax !== null && wholesale.priceMax > wholesale.priceMin
              ? `～${this.formatAmount(wholesale.priceMax, wholesale.currency)}`
              : '';
          priceText = `${min}${max}${wholesale.unit ? ` / ${wholesale.unit}` : ''}`;
          note =
            wholesale.minOrderQuantity !== null
              ? `起订 ${wholesale.minOrderQuantity}${wholesale.unit ?? ''}`
              : '';
        }
      } else if (single) {
        priceText = this.rangeText(single);
        note = `${single.verifiedCount} 个已确认`;
      } else if (bundle) {
        priceText = this.rangeText(bundle);
        note = `组合装 · ${bundle.verifiedCount} 个`;
      } else if (full) {
        priceText = this.rangeText(full);
        note = `全系列 · ${full.verifiedCount} 个`;
      }

      if (
        this.searching() &&
        (result.status === 'PENDING' || result.status === 'RUNNING')
      ) {
        note = '搜索中…';
      } else if (result.status === 'FAILED') {
        note = '采集失败';
      } else if (result.status === 'NOT_CONFIGURED') {
        note = '未配置';
      }

      return {
        platform: result.platform,
        label: PLATFORM_META[result.platform].label,
        priceText,
        note,
      };
    });
  });

  formatAmount(amount: number, currency: string | null): string {
    const value = amount.toFixed(2);
    if (currency === 'CNY') return `¥${value}`;
    if (currency === 'USD') return `$${value}`;
    return currency ? `${currency} ${value}` : value;
  }

  rangeText(group: PriceGroupSummary): string {
    if (group.minAmount === null) return '暂无已确认价格';
    const min = this.formatAmount(group.minAmount, group.currency);
    if (group.maxAmount !== null && group.maxAmount > group.minAmount) {
      return `${min}～${this.formatAmount(group.maxAmount, group.currency)}`;
    }
    return min;
  }

  groupLabel(group: PriceComparisonGroup): string {
    return PRICE_GROUP_LABEL[group];
  }

  platformLabel(platform: Platform): string {
    return PLATFORM_META[platform].label;
  }
}
