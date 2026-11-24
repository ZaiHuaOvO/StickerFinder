import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { firstValueFrom } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import {
  formatDateTime,
  formatPromotionPeriod,
  formatPromotionValue,
  MANUAL_DECISION_LABEL,
  PLATFORM_META,
  PRICE_TYPE_META,
  PROMOTION_TYPE_META,
  RULE_PRICE_STATUS_META,
  RULE_STATUS_META,
} from '../../core/labels';
import { Product, ReviewPayload } from '../../core/models';

@Component({
  selector: 'app-product-card',
  imports: [NzButtonModule, NzIconModule, NzTagModule, NzTooltipModule],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.less',
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  /** 历史/回放只读：隐藏人工复核与 SKU 判断操作 */
  readonly readonlyMode = input(false);
  readonly reviewed = output<Product>();

  private readonly api = inject(ApiService);
  private readonly message = inject(NzMessageService);

  readonly imageBroken = signal(false);
  readonly reviewing = signal(false);

  readonly platform = computed(() => PLATFORM_META[this.product().platform]);
  readonly imageUrl = computed(() => this.product().imageUrls[0] ?? null);
  readonly title = computed(() => this.product().title);
  readonly summary = computed(
    () =>
      this.product().description ??
      this.product().rule?.reason ??
      '暂无商品说明',
  );
  readonly plainStatus = computed(() => {
    const manual = this.product().manual?.decision;
    if (manual === 'MATCH') return { label: '人工确认同款', tone: 'success' };
    if (manual === 'NO_MATCH') return { label: '人工排除', tone: 'default' };
    const rule = this.product().rule;
    if (!rule) return { label: '历史数据 · 未评估', tone: 'default' };
    const meta = RULE_STATUS_META[rule.status];
    return { label: meta.label, tone: meta.tone };
  });
  readonly priceStatus = computed(() => {
    const rule = this.product().rule;
    return rule ? RULE_PRICE_STATUS_META[rule.priceStatus] : null;
  });
  readonly observations = computed(() => this.product().observations ?? []);
  readonly hasMultipleSources = computed(() => this.observations().length > 1);
  readonly priceConflict = computed(() => Boolean(this.product().priceConflict));
  readonly primaryObservation = computed(() => this.observations()[0] ?? null);
  readonly couponPrice = computed(() => {
    const observations = this.observations();
    for (let index = observations.length - 1; index >= 0; index -= 1) {
      const price = observations[index].couponPrice;
      if (price) return price;
    }
    return null;
  });
  readonly couponPriceText = computed(
    () => this.couponPrice()?.displayText ?? null,
  );
  readonly promotionRows = computed(() =>
    (this.product().promotions ?? []).map((promotion) => ({
      ...promotion,
      typeLabel:
        PROMOTION_TYPE_META[promotion.promotionType]?.label ??
        promotion.promotionTypeLabel,
      tone: PROMOTION_TYPE_META[promotion.promotionType]?.tone ?? 'default',
      valueText: formatPromotionValue(
        promotion.amount,
        promotion.currency,
        promotion.discountRate,
        promotion.minimumSpend,
      ),
      periodText: formatPromotionPeriod(promotion.startTime, promotion.endTime),
      skuName: promotion.skuId
        ? (this.product().skuOptions.find((sku) => sku.skuId === promotion.skuId)
            ?.name ?? promotion.skuId)
        : null,
    })),
  );
  readonly visiblePromotions = computed(() => this.promotionRows().slice(0, 2));
  readonly morePromotions = computed(() => this.promotionRows().slice(2));
  readonly comparisonRows = computed(() =>
    this.observations().map((observation) => ({
      observation,
      priceText: observation.price?.displayText ?? '未获取',
      priceTypeLabel: observation.price
        ? PRICE_TYPE_META[observation.price.priceType]
        : '价格未获取',
      originalText: observation.originalPrice?.displayText ?? null,
      observedAt: formatDateTime(observation.observedAt),
      providerLabel: observation.providerLabel,
      sourceLabel: observation.sourceLabel,
      regionNote: observation.regionNote,
      note: observation.price?.note ?? '',
    })),
  );
  readonly primaryRegionNote = computed(
    () => this.primaryObservation()?.regionNote ?? null,
  );
  readonly originalPriceText = computed(
    () =>
      this.product().price?.originalDisplayText ??
      this.primaryObservation()?.originalPrice?.displayText ??
      null,
  );
  readonly priceText = computed(() => this.product().price?.displayText ?? '未获取');
  readonly priceTypeLabel = computed(() => {
    const price = this.product().price;
    return price ? PRICE_TYPE_META[price.priceType] : '价格未获取';
  });
  readonly priceNote = computed(() => this.product().price?.note ?? '');
  readonly groupPrice = computed(() => this.product().groupPrice);
  readonly manualLabel = computed(() => {
    const decision = this.product().manual?.decision ?? 'PENDING';
    return decision === 'PENDING' ? null : MANUAL_DECISION_LABEL[decision];
  });
  readonly matchedContents = computed(
    () => this.product().rule?.matchedContents ?? [],
  );
  readonly ruleReason = computed(() => this.product().rule?.reason ?? null);
  readonly ruleDetailError = computed(() => this.product().rule?.detailError ?? null);
  readonly collectedAt = computed(() => formatDateTime(this.product().collectedAt));
  readonly manualNote = computed(() => this.product().manual?.note ?? null);
  readonly matchedSkuViews = computed(() => {
    const product = this.product();
    const matchedIds = product.rule?.matchedSkuIds ?? [];
    return product.skuOptions
      .map((sku, index) => ({ key: sku.skuId ?? `sku-${index + 1}`, sku }))
      .filter((entry) => matchedIds.includes(entry.key))
      .sort(
        (a, b) =>
          (a.sku.price ?? Number.POSITIVE_INFINITY) -
          (b.sku.price ?? Number.POSITIVE_INFINITY),
      );
  });
  readonly targetPriceHint = computed(() => {
    const rule = this.product().rule;
    if (rule?.priceStatus === 'PRICE_VALID' && rule.price.amount !== null) {
      const sku = this.product().skuOptions.find((item) => item.skuId === rule.price.skuId);
      return `${sku?.name ?? '目标款'} · ${this.formatRuleAmount(
        rule.price.amount,
        rule.price.currency,
      )}`;
    }
    if (rule?.detailError) return '详情暂不可用';
    return null;
  });
  readonly skuReviewViews = computed(() =>
    this.product().skuOptions.map((sku, index) => {
      const skuId = sku.skuId ?? `sku-${index + 1}`;
      const manual = (this.product().manual?.skuDecisions ?? []).find(
        (item) => item.skuId === skuId,
      );
      return {
        skuId,
        name: sku.name,
        price: sku.price,
        manual: manual?.decision ?? null,
      };
    }),
  );
  readonly openUrl = computed(() => this.product().productUrl);
  readonly isWholesale = computed(
    () =>
      this.product().platform === 'alibaba1688' ||
      Boolean(this.product().wholesalePrice),
  );
  readonly wholesale = computed(() => this.product().wholesalePrice);
  readonly supplierLabel = computed(() => (this.isWholesale() ? '供应商' : '店铺'));
  readonly wholesaleRangeText = computed(() => {
    const wholesale = this.wholesale();
    if (!wholesale) return '未获取';
    const { priceMin, priceMax, currency, unit } = wholesale;
    const display = (amount: number): string => {
      const value = amount.toFixed(2);
      if (currency === 'CNY') return `¥${value}`;
      if (currency) return `${currency} ${value}`;
      return `${value}（币种未知）`;
    };
    const suffix = unit ? ` / ${unit}` : '';
    if (priceMin !== null && priceMax !== null) {
      if (priceMax > priceMin) {
        return `${display(priceMin)} ～ ${display(priceMax)}${suffix}`;
      }
      return `${display(priceMin)}${suffix}`;
    }
    if (priceMin !== null) return `${display(priceMin)} 起${suffix}`;
    if (priceMax !== null) return `最高 ${display(priceMax)}${suffix}`;
    return '未获取';
  });
  readonly wholesaleMoqText = computed(() => {
    const wholesale = this.wholesale();
    if (!wholesale || wholesale.minOrderQuantity === null) return '未知';
    return wholesale.unit
      ? `${wholesale.minOrderQuantity} ${wholesale.unit}`
      : String(wholesale.minOrderQuantity);
  });
  readonly wholesaleUnitText = computed(() => this.wholesale()?.unit ?? '未知');
  readonly wholesaleTierRows = computed(() => {
    const wholesale = this.wholesale();
    if (!wholesale || wholesale.priceTiers.length === 0) return [];
    return wholesale.priceTiers.map((tier) => ({
      key: tier.minQuantity,
      text: `${tier.minQuantity} ${
        wholesale.unit ?? ''
      }起：${this.formatWholesaleAmount(tier.price)}${
        wholesale.unit ? ` / ${wholesale.unit}` : ''
      }`,
    }));
  });
  readonly wholesaleSkuViews = computed(() =>
    (this.product().skuOptions ?? []).slice(0, 12).map((sku, index) => ({
      key: sku.skuId ?? `wholesale-sku-${index + 1}`,
      sku,
      priceText: sku.price !== undefined ? this.formatWholesaleAmount(sku.price) : null,
    })),
  );
  readonly wholesaleNote = computed(() => this.wholesale()?.note ?? null);
  readonly highlightPrice = computed(() => {
    if (this.isWholesale()) return this.wholesaleRangeText();
    const rule = this.product().rule;
    if (rule?.priceStatus === 'PRICE_VALID' && rule.price.amount !== null) {
      return this.formatRuleAmount(rule.price.amount, rule.price.currency);
    }
    const price = this.priceText();
    return price && price !== '未获取' ? price : '价格未获取';
  });
  readonly highlightSku = computed(() => {
    if (this.isWholesale()) return `起订 ${this.wholesaleMoqText()}`;
    const rule = this.product().rule;
    if (rule?.price.skuId) {
      const sku = this.product().skuOptions.find((item) => item.skuId === rule.price.skuId);
      if (sku) return sku.name;
    }
    return this.matchedSkuViews()[0]?.sku.name || '规格待确认';
  });
  readonly highlightNote = computed(() => {
    if (this.isWholesale()) return '批发价，运费另计';
    const rule = this.product().rule;
    if (rule?.priceStatus === 'PRICE_VALID') return '规则确认价 · 商品价，运费另计';
    if (rule?.status === 'RULE_MATCH_NO_PRICE') return '已确认商品 · 价格待确认';
    if (rule?.detailError) return null;
    return '起售价 · 规格待确认';
  });

  private formatRuleAmount(
    amount: number,
    currency: string | null,
  ): string {
    const value = amount.toFixed(2);
    if (currency === 'CNY' || currency === null) return `¥${value}`;
    return `${currency} ${value}`;
  }

  private formatWholesaleAmount(amount: number): string {
    const currency = this.wholesale()?.currency ?? null;
    const value = amount.toFixed(2);
    if (currency === 'CNY') return `¥${value}`;
    if (currency) return `${currency} ${value}`;
    return `${value}（币种未知）`;
  }

  time(value: string | null | undefined): string {
    return formatDateTime(value);
  }

  tagColor(tone: string): string {
    switch (tone) {
      case 'success':
        return 'green';
      case 'warning':
        return 'gold';
      case 'error':
        return 'red';
      case 'processing':
        return 'blue';
      default:
        return 'default';
    }
  }

  quickReview(decision: 'MATCH' | 'NO_MATCH' | 'PENDING'): void {
    void this.submitManual({ decision });
  }

  reviewSku(skuId: string, decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED'): void {
    void this.submitManual({ skuDecisions: [{ skuId, decision }] });
  }

  skuDecisionLabel(decision: 'TARGET' | 'BUNDLE' | 'EXCLUDED'): string {
    if (decision === 'TARGET') return '目标款';
    if (decision === 'BUNDLE') return '组合装';
    return '已排除';
  }

  private async submitManual(payload: ReviewPayload): Promise<void> {
    if (this.reviewing()) return;
    this.reviewing.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.reviewCandidate(this.product().id, payload),
      );
      this.message.success('已保存');
      this.reviewed.emit(updated);
    } catch (error) {
      this.message.error(apiErrorMessage(error));
    } finally {
      this.reviewing.set(false);
    }
  }
}
