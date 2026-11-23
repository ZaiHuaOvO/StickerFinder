import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { firstValueFrom } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import {
  formatConfidence,
  formatDateTime,
  MANUAL_DECISION_LABEL,
  MATCH_TYPE_META,
  PLATFORM_META,
  PRICE_TYPE_META,
  SOURCE_TYPE_META,
} from '../../core/labels';
import { Product, SkuDecision } from '../../core/models';
import {
  ReviewModalComponent,
  ReviewModalData,
  ReviewModalResult,
} from '../review-modal/review-modal.component';

@Component({
  selector: 'app-product-card',
  imports: [
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzTooltipModule,
    NzModalModule,
  ],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.less',
})
export class ProductCardComponent {
  readonly product = input.required<Product>();
  readonly reviewed = output<Product>();

  private readonly api = inject(ApiService);
  private readonly modal = inject(NzModalService);
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
  readonly sourceLabel = computed(() => SOURCE_TYPE_META[this.product().sourceType]);
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
  readonly confidence = computed(() => formatConfidence(this.product().match?.confidence));
  readonly collectedAt = computed(() => formatDateTime(this.product().collectedAt));
  readonly priceObservedAt = computed(() =>
    this.product().price?.observedAt ? formatDateTime(this.product().price!.observedAt) : null,
  );
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
    const keyed = product.skuOptions.map((sku, index) => ({
      key: sku.skuId ?? `sku-${index + 1}`,
      sku,
      decision: product.match?.skuDecisions.find(
        (decision: SkuDecision) => decision.skuId === (sku.skuId ?? `sku-${index + 1}`),
      ),
    }));
    const matchedIds = product.match?.matchedSkuIds ?? [];
    return keyed.filter((entry) => matchedIds.includes(entry.key));
  });
  readonly openUrl = computed(() => this.product().productUrl);

  openReview(): void {
    const product = this.product();
    this.modal.create<ReviewModalComponent, ReviewModalData, ReviewModalResult>({
      nzTitle: '人工核对商品',
      nzContent: ReviewModalComponent,
      nzData: { product },
      nzOkText: '保存核对结果',
      nzCancelText: '取消',
      nzWidth: 560,
      nzOnOk: (instance) =>
        this.submitReview(instance.form.getRawValue() as ReviewModalResult),
    });
  }

  private async submitReview(result: ReviewModalResult): Promise<boolean> {
    if (this.reviewing()) return false;
    this.reviewing.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.reviewCandidate(this.product().id, {
          decision: result.decision,
          note: result.note?.trim() || undefined,
        }),
      );
      this.message.success('人工核对结果已保存');
      this.reviewed.emit(updated);
      return true;
    } catch (error) {
      this.message.error(apiErrorMessage(error));
      return false;
    } finally {
      this.reviewing.set(false);
    }
  }
}
