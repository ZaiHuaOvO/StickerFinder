import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { firstValueFrom } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import {
  CANDIDATE_RELEVANCE_META,
  EVIDENCE_SOURCE_LABEL,
  formatDateTime,
  MANUAL_DECISION_LABEL,
  MATCH_ASSESSMENT_META,
  MATCH_TYPE_META,
  NEXT_ACTION_META,
  PLATFORM_META,
  PRICE_TYPE_META,
  PRICE_VERIFICATION_META,
  SKU_VERIFICATION_META,
  SOURCE_TYPE_META,
  VISUAL_MATCH_META,
} from '../../core/labels';
import { Product, ReviewPayload } from '../../core/models';

@Component({
  selector: 'app-product-card',
  imports: [
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzTooltipModule,
  ],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.less',
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly reviewed = output<Product>();

  private readonly api = inject(ApiService);
  private readonly message = inject(NzMessageService);

  readonly imageBroken = signal(false);
  readonly reviewing = signal(false);

  readonly platform = computed(() => PLATFORM_META[this.product().platform]);
  readonly imageUrl = computed(() => this.product().imageUrls[0] ?? null);
  readonly title = computed(() => this.product().title);
  readonly summary = computed(
    () => this.product().match?.summary ?? this.product().description ?? '暂无商品内容摘要',
  );
  readonly matchTypeInfo = computed(() => {
    const match = this.product().match;
    const type = match?.matchType;
    if (
      match?.manualDecision === 'MATCH' &&
      (!type || type === 'NOT_MATCH' || type === 'UNCERTAIN')
    ) {
      return { label: '人工确认', description: '人工核对后确认包含目标贴纸' };
    }
    return type ? MATCH_TYPE_META[type] : null;
  });
  readonly plainStatus = computed(() => {
    const match = this.product().match;
    const manual = match?.manualDecision;
    if (manual === 'MATCH') return { label: '已确认同款', tone: 'success' };
    if (manual === 'NO_MATCH') return { label: '已排除', tone: 'default' };
    if (!match) return { label: '待确认', tone: 'warning' };
    if (match.matchStatus === 'MATCH') return { label: '已确认同款', tone: 'success' };
    if (match.matchStatus === 'NO_MATCH') return { label: '已排除', tone: 'default' };
    if (match.seriesMatch === 'MATCH') {
      return { label: '系列匹配，规格待确认', tone: 'warning' };
    }
    return { label: '待确认', tone: 'warning' };
  });
  readonly sourceLabel = computed(() => SOURCE_TYPE_META[this.product().sourceType]);
  readonly observations = computed(() => this.product().observations ?? []);
  readonly sourceTags = computed(() => {
    const labels = this.observations()
      .map((observation) => observation.providerLabel)
      .filter(Boolean);
    if (labels.length === 0) return [this.sourceLabel()];
    return [...new Set(labels)];
  });
  readonly hasMultipleSources = computed(() => this.observations().length > 1);
  readonly priceConflict = computed(() => Boolean(this.product().priceConflict));
  readonly primaryObservation = computed(() => this.observations()[0] ?? null);
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
  readonly originalPriceText = computed(() => {
    const original =
      this.product().price?.originalDisplayText ??
      this.primaryObservation()?.originalPrice?.displayText ??
      null;
    return original;
  });
  readonly priceText = computed(() => this.product().price?.displayText ?? '未获取');
  readonly priceTypeLabel = computed(() => {
    const price = this.product().price;
    return price ? PRICE_TYPE_META[price.priceType] : '价格未获取';
  });
  readonly priceNote = computed(() => this.product().price?.note ?? '');
  readonly groupPrice = computed(() => this.product().groupPrice);
  readonly manualLabel = computed(() => {
    const decision = this.product().match?.manualDecision ?? 'PENDING';
    return decision === 'PENDING' ? null : MANUAL_DECISION_LABEL[decision];
  });
  readonly evidenceSourceLabels = EVIDENCE_SOURCE_LABEL;
  readonly relevanceInfo = computed(() => {
    const relevance = this.product().match?.candidateRelevance;
    return relevance ? CANDIDATE_RELEVANCE_META[relevance] : null;
  });
  readonly nextActionInfo = computed(() => {
    const action = this.product().match?.nextAction;
    if (!action || action === 'NONE') return null;
    return NEXT_ACTION_META[action];
  });
  readonly assessmentRows = computed(() => {
    const match = this.product().match;
    if (!match) return [];
    return [
      match.categoryMatch
        ? { label: '商品类别', meta: MATCH_ASSESSMENT_META[match.categoryMatch] }
        : null,
      match.seriesMatch
        ? { label: '目标系列', meta: MATCH_ASSESSMENT_META[match.seriesMatch] }
        : null,
      match.targetItemMatch
        ? { label: '目标款式', meta: MATCH_ASSESSMENT_META[match.targetItemMatch] }
        : null,
      match.visualMatch
        ? { label: '视觉比对', meta: VISUAL_MATCH_META[match.visualMatch] }
        : null,
      match.skuVerificationStatus
        ? { label: 'SKU', meta: SKU_VERIFICATION_META[match.skuVerificationStatus] }
        : null,
      match.priceVerificationStatus
        ? { label: '价格', meta: PRICE_VERIFICATION_META[match.priceVerificationStatus] }
        : null,
      this.relevanceInfo()
        ? { label: '相关性', meta: this.relevanceInfo()! }
        : null,
      this.nextActionInfo()
        ? {
            label: '建议',
            meta: { label: this.nextActionInfo()!.label, tone: 'default' },
          }
        : null,
    ].filter(
      (row): row is { label: string; meta: { label: string; tone: string } } =>
        row !== null,
    );
  });
  readonly collectedAt = computed(() => formatDateTime(this.product().collectedAt));
  readonly manualNote = computed(() => this.product().match?.manualNote ?? null);
  readonly aiWarning = computed(() => {
    const match = this.product().match;
    if (!match) return '该商品没有识别结果';
    if (match.aiStatus === 'SKIPPED') return `AI 未识别：${match.aiError ?? '未配置'}`;
    if (match.aiStatus === 'FAILED') return `AI 识别失败：${match.aiError ?? '未知错误'}`;
    return null;
  });
  readonly matchedSkuViews = computed(() => {
    const product = this.product();
    const matchedIds = product.match?.matchedSkuIds ?? [];
    return product.skuOptions
      .map((sku, index) => ({ key: sku.skuId ?? `sku-${index + 1}`, sku }))
      .filter((entry) => matchedIds.includes(entry.key));
  });
  readonly targetPriceHint = computed(() => {
    const match = this.product().match;
    const priced = this.matchedSkuViews().find(
      (entry) => typeof entry.sku.price === 'number',
    );
    if (
      priced &&
      (match?.priceVerificationStatus === 'VERIFIED' ||
        match?.priceVerificationStatus === 'PARTIAL')
    ) {
      return `${priced.sku.name} · ¥${priced.sku.price!.toFixed(2)}`;
    }
    if (match?.skuVerificationStatus === 'FAILED') return '详情暂不可用';
    const price = this.priceText();
    if (price && price !== '未获取') return `${price} 起 · 规格待确认`;
    return null;
  });
  readonly skuReviewViews = computed(() =>
    this.product().skuOptions.map((sku, index) => {
      const skuId = sku.skuId ?? `sku-${index + 1}`;
      const manual = (this.product().match?.manualSkuDecisions ?? []).find(
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
      }起：${this.formatWholesaleAmount(tier.price)}${wholesale.unit ? ` / ${wholesale.unit}` : ''}`,
    }));
  });
  readonly wholesaleSkuViews = computed(() =>
    (this.product().skuOptions ?? []).slice(0, 12).map((sku, index) => ({
      key: sku.skuId ?? `wholesale-sku-${index + 1}`,
      sku,
      priceText:
        sku.price !== undefined
          ? this.formatWholesaleAmount(sku.price)
          : null,
    })),
  );
  readonly wholesaleNote = computed(() => this.wholesale()?.note ?? null);

  private formatWholesaleAmount(amount: number): string {
    const currency = this.wholesale()?.currency ?? null;
    const value = amount.toFixed(2);
    if (currency === 'CNY') return `¥${value}`;
    if (currency) return `${currency} ${value}`;
    return `${value}（币种未知）`;
  }

  rawJson(value: Record<string, unknown> | null): string {    if (!value) return '无原始数据';
    try {
      const text = JSON.stringify(value, null, 2);
      return text.length > 12000 ? `${text.slice(0, 12000)}\n…（已截断）` : text;
    } catch {
      return '原始数据无法序列化';
    }
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
