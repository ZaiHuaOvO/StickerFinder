import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { firstValueFrom } from 'rxjs';
import { PlatformPanelComponent } from './components/platform-panel/platform-panel.component';
import { PriceSummaryComponent } from './components/price-summary/price-summary.component';
import { ProductCardComponent } from './components/product-card/product-card.component';
import { SearchFormComponent } from './components/search-form/search-form.component';
import { SearchHistoryComponent } from './components/search-history/search-history.component';
import { ApiService, apiErrorMessage } from './core/api.service';
import { formatDateTime, PLATFORM_META } from './core/labels';
import {
  CandidateRelevance,
  Platform,
  PriceComparisonGroup,
  PriceSummaryItem,
  Product,
  ProvidersStatusResponse,
  SearchDetail,
  SearchFormPayload,
  SearchRunStatus,
  VerificationActionEvent,
} from './core/models';

function relevanceRank(value: CandidateRelevance | null | undefined): number {
  switch (value) {
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 2;
    case 'LOW':
      return 1;
    case 'NONE':
      return 0;
    default:
      return -1;
  }
}

function byRelevanceThenConfidence(a: Product, b: Product): number {
  const byRelevance =
    relevanceRank(b.match?.candidateRelevance) -
    relevanceRank(a.match?.candidateRelevance);
  if (byRelevance !== 0) return byRelevance;
  return (b.match?.confidence ?? -1) - (a.match?.confidence ?? -1);
}

@Component({
  selector: 'app-root',
  imports: [
    SearchFormComponent,
    PlatformPanelComponent,
    PriceSummaryComponent,
    ProductCardComponent,
    SearchHistoryComponent,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzSpinModule,
    NzTabsModule,
    NzTagModule,
    NzTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.less',
})
export class App implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private currentSearchId: string | null = null;
  private pollFailures = 0;

  readonly platformMeta = PLATFORM_META;
  readonly statuses = signal<ProvidersStatusResponse | null>(null);
  readonly detail = signal<SearchDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly warning = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly actionNotice = signal<string | null>(null);
  readonly searching = signal(false);
  readonly cancelling = signal(false);
  readonly platformFilter = signal<'ALL' | Platform>('ALL');
  readonly verificationBusyTaskId = signal<string | null>(null);
  readonly statusesError = signal<string | null>(null);
  /** 历史记录列表 / 历史详情：只读，不轮询、不触发外部采集 */
  readonly historyOpen = signal(false);
  readonly readonlyDetail = signal(false);

  readonly aiStatus = computed(() => this.statuses()?.ai ?? null);
  readonly visiblePlatforms = computed(() =>
    (this.detail()?.platforms ?? []).filter((platform) => platform.channels.length > 0),
  );
  readonly totalMatched = computed(() =>
    (this.detail()?.platforms ?? []).reduce((sum, item) => sum + item.matchedCount, 0),
  );
  readonly totalUncertain = computed(() =>
    (this.detail()?.platforms ?? []).reduce((sum, item) => sum + item.uncertainCount, 0),
  );
  readonly priceSummary = computed(() => this.detail()?.priceSummary ?? null);
  readonly filterPlatforms = computed(() =>
    (this.detail()?.platforms ?? []).map((item) => item.platform),
  );
  readonly allMatchedProducts = computed(() =>
    (this.detail()?.platforms ?? []).flatMap((item) => item.products),
  );
  readonly allUncertainProducts = computed(() =>
    (this.detail()?.platforms ?? []).flatMap((item) => item.uncertainProducts),
  );
  readonly unifiedProducts = computed(() => {
    const byCandidate = new Map<string, PriceSummaryItem>();
    for (const item of this.priceSummary()?.items ?? []) {
      const current = byCandidate.get(item.candidateId);
      if (
        !current ||
        this.groupRank(item.comparisonGroup) <
          this.groupRank(current.comparisonGroup) ||
        (this.groupRank(item.comparisonGroup) ===
          this.groupRank(current.comparisonGroup) &&
          item.amount < current.amount)
      ) {
        byCandidate.set(item.candidateId, item);
      }
    }
    return [...this.allMatchedProducts()].sort((a, b) => {
      const aItem = byCandidate.get(a.id);
      const bItem = byCandidate.get(b.id);
      const aRank = aItem ? this.groupRank(aItem.comparisonGroup) : 4;
      const bRank = bItem ? this.groupRank(bItem.comparisonGroup) : 4;
      if (aRank !== bRank) return aRank - bRank;
      const aAmount = aItem?.amount ?? Number.POSITIVE_INFINITY;
      const bAmount = bItem?.amount ?? Number.POSITIVE_INFINITY;
      if (aAmount !== bAmount) return aAmount - bAmount;
      return b.collectedAt.localeCompare(a.collectedAt);
    });
  });
  readonly filteredUnifiedProducts = computed(() => {
    const filter = this.platformFilter();
    return filter === 'ALL'
      ? this.unifiedProducts()
      : this.unifiedProducts().filter((product) => product.platform === filter);
  });
  readonly pricedCandidateIds = computed(
    () =>
      new Set(
        (this.priceSummary()?.items ?? []).map((item) => item.candidateId),
      ),
  );
  readonly filteredPricedProducts = computed(() =>
    this.filteredUnifiedProducts().filter((product) =>
      this.pricedCandidateIds().has(product.id),
    ),
  );
  readonly filteredUnverifiedProducts = computed(() =>
    this.filteredUnifiedProducts().filter(
      (product) => !this.pricedCandidateIds().has(product.id),
    ),
  );
  readonly potentialCheaperProducts = computed(() => {
    const ids = new Set(
      this.priceSummary()?.potentialCheaperCandidateIds ?? [],
    );
    return this.allUncertainProducts()
      .filter((product) => ids.has(product.id))
      .sort((a, b) => {
        const aPrice = this.productReferencePrice(a);
        const bPrice = this.productReferencePrice(b);
        if (aPrice !== bPrice) return aPrice < bPrice ? -1 : 1;
        return b.collectedAt.localeCompare(a.collectedAt);
      });
  });
  readonly otherUncertainProducts = computed(() => {
    const ids = new Set(
      this.priceSummary()?.potentialCheaperCandidateIds ?? [],
    );
    return this.allUncertainProducts().filter((product) => !ids.has(product.id));
  });
  readonly potentialTitle = computed(() =>
    this.priceSummary()?.bestPrice ? '可能更便宜 · 待确认' : '待确认商品',
  );
  readonly runStatusLabel = computed(() => {
    const status = this.detail()?.status;
    switch (status) {
      case 'PENDING':
        return '任务排队中';
      case 'RUNNING':
        return '正在采集与识别';
      case 'COMPLETED':
        return '搜索完成';
      case 'PARTIAL':
        return '部分平台未完成';
      case 'FAILED':
        return '搜索失败';
      case 'INTERRUPTED':
        return '任务被中断';
      case 'CANCELLED':
        return '已取消';
      case 'WAITING_MANUAL_VERIFICATION':
        return '等待人工验证';
      default:
        return '';
    }
  });
  readonly runStatusTone = computed(() => {
    const status = this.detail()?.status;
    if (status === 'COMPLETED') return 'success';
    if (status === 'PARTIAL') return 'warning';
    if (status === 'FAILED' || status === 'INTERRUPTED') return 'error';
    if (status === 'WAITING_MANUAL_VERIFICATION') return 'warning';
    if (status === 'RUNNING' || status === 'PENDING') return 'processing';
    return 'default';
  });
  readonly formattedStartedAt = computed(() => formatDateTime(this.detail()?.startedAt));
  readonly formattedCompletedAt = computed(() => formatDateTime(this.detail()?.completedAt));
  readonly canCancel = computed(() => {
    if (this.readonlyDetail()) return false;
    const status = this.detail()?.status;
    return (
      status === 'PENDING' ||
      status === 'RUNNING' ||
      status === 'WAITING_MANUAL_VERIFICATION'
    );
  });

  ngOnInit(): void {
    this.loadStatuses();
    const params = new URLSearchParams(window.location.search);
    const searchId = params.get('searchId');
    const fromHistory = params.get('history') === '1';
    if (searchId && fromHistory) {
      void this.openHistoryDetail(searchId, false);
      return;
    }
    if (searchId) {
      this.currentSearchId = searchId;
      this.searching.set(true);
      void this.poll(searchId);
      return;
    }
    if (fromHistory) {
      this.openHistory();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearPoll();
  }

  loadStatuses(): void {
    this.statusesError.set(null);
    this.api.getProviderStatuses().subscribe({
      next: (statuses) => this.statuses.set(statuses),
      error: (error: unknown) => this.statusesError.set(apiErrorMessage(error)),
    });
  }

  async onSearch(payload: SearchFormPayload): Promise<void> {
    this.clearPoll();
    this.historyOpen.set(false);
    this.readonlyDetail.set(false);
    this.pollFailures = 0;
    this.currentSearchId = null;
    this.error.set(null);
    this.warning.set(null);
    this.notice.set(null);
    this.actionNotice.set(null);
    this.detail.set(null);
    this.searching.set(true);

    try {
      const created = await firstValueFrom(
        this.api.createSearch({
          targetName: payload.targetName,
          seriesName: payload.seriesName,
          aliases: payload.aliases,
          seriesAliases: payload.seriesAliases,
          brandNames: payload.brandNames,
          referenceImageId: payload.referenceImageId,
          platforms: payload.platforms,
        }),
      );
      this.currentSearchId = created.searchId;
      this.writeSearchIdToUrl(created.searchId);
      await this.poll(created.searchId);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      this.searching.set(false);
    }
  }

  setPlatformFilter(filter: 'ALL' | Platform): void {
    this.platformFilter.set(filter);
  }

  openHistory(): void {
    this.clearPoll();
    this.currentSearchId = null;
    this.searching.set(false);
    this.readonlyDetail.set(false);
    this.detail.set(null);
    this.error.set(null);
    this.warning.set(null);
    this.notice.set(null);
    this.actionNotice.set(null);
    this.historyOpen.set(true);
    this.writeViewToUrl('history');
  }

  closeHistory(): void {
    this.historyOpen.set(false);
    this.error.set(null);
    this.warning.set(null);
    this.writeViewToUrl(null);
  }

  /** 历史详情：只读取数据库快照，不轮询、不调用外部接口。 */
  async openHistoryDetail(searchId: string, updateUrl = true): Promise<void> {
    this.clearPoll();
    this.currentSearchId = null;
    this.searching.set(false);
    this.error.set(null);
    this.warning.set(null);
    this.notice.set(null);
    this.actionNotice.set(null);
    try {
      const detail = await firstValueFrom(this.api.getSearch(searchId));
      this.detail.set(detail);
      if (
        detail.status === 'PARTIAL' ||
        detail.status === 'FAILED' ||
        detail.status === 'INTERRUPTED'
      ) {
        this.warning.set(detail.errorMessage);
      }
      this.platformFilter.set('ALL');
      this.readonlyDetail.set(true);
      this.historyOpen.set(false);
      if (updateUrl) this.writeViewToUrl('history', searchId);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      // 打不开的历史详情仍停留在历史列表，并让列表页显示错误。
      this.historyOpen.set(true);
      this.readonlyDetail.set(false);
    }
  }

  backToHistory(): void {
    this.clearPoll();
    this.currentSearchId = null;
    this.detail.set(null);
    this.readonlyDetail.set(false);
    this.historyOpen.set(true);
    this.writeViewToUrl('history');
  }

  scrollToUncertain(): void {
    document
      .getElementById('uncertain-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private groupRank(group: PriceComparisonGroup): number {
    switch (group) {
      case 'TARGET_SINGLE':
        return 0;
      case 'TARGET_BUNDLE':
        return 1;
      case 'TARGET_FULL_SET':
        return 2;
      case 'WHOLESALE':
        return 3;
      default:
        return 4;
    }
  }

  private productReferencePrice(product: Product): number {
    const matchedIds = product.match?.matchedSkuIds ?? [];
    for (const [index, sku] of product.skuOptions.entries()) {
      const skuId = sku.skuId ?? `sku-${index + 1}`;
      if (matchedIds.includes(skuId) && typeof sku.price === 'number') {
        return sku.price;
      }
    }
    return product.price?.amount ?? Number.POSITIVE_INFINITY;
  }

  private ensurePlatformFilter(detail: SearchDetail): void {
    const filter = this.platformFilter();
    if (
      filter !== 'ALL' &&
      !detail.platforms.some((platform) => platform.platform === filter)
    ) {
      this.platformFilter.set('ALL');
    }
  }

  async cancelActiveSearch(): Promise<void> {
    const detail = this.detail();
    if (!detail || this.cancelling()) return;
    this.cancelling.set(true);
    this.error.set(null);
    this.actionNotice.set(null);
    try {
      const result = await firstValueFrom(
        this.api.cancelSearch(detail.searchId),
      );
      this.clearPoll();
      this.searching.set(false);
      this.detail.set({
        ...detail,
        status: result.status as SearchRunStatus,
        completedAt: new Date().toISOString(),
      });
      this.actionNotice.set('搜索已停止；已完成的第三方请求不会退费。');
      await this.refresh(detail.searchId);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.cancelling.set(false);
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.canCancel()) return;
    event.preventDefault();
    event.returnValue = '当前搜索仍在后台运行，离开页面不会停止搜索。';
  }

  async onReviewed(updated: Product): Promise<void> {    this.applyReviewedProduct(updated);
    const detail = this.detail();
    if (!detail) return;
    // 本地先更新分组，再从服务端校准；刷新失败也不会留下错误提示语
    await this.refresh(detail.searchId);
  }

  async onVerificationAction(event: VerificationActionEvent): Promise<void> {
    const detail = this.detail();
    if (!detail) return;
    this.verificationBusyTaskId.set(event.taskId);
    this.error.set(null);
    this.notice.set(null);
    try {
      if (event.action === 'open') {
        const info = await firstValueFrom(
          this.api.openVerificationBrowser(detail.searchId, event.taskId),
        );
        this.notice.set(info.message);
        await this.refresh(detail.searchId);
      } else if (event.action === 'close') {
        await firstValueFrom(
          this.api.closeVerificationBrowser(detail.searchId, event.taskId),
        );
        this.notice.set('验证浏览器已关闭。如需重新验证或继续采集，请再次打开验证浏览器。');
        await this.refresh(detail.searchId);
      } else {
        await firstValueFrom(
          this.api.resumeVerification(detail.searchId, event.taskId),
        );
        this.notice.set(
          '已关闭验证浏览器并继续采集。系统会重新加载页面并检查验证码/登录状态，不会假定验证一定成功。',
        );
        this.searching.set(true);
        await this.poll(detail.searchId);
      }
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.verificationBusyTaskId.set(null);
    }
  }

  private async poll(searchId: string): Promise<void> {
    if (this.destroyed || this.currentSearchId !== searchId) return;
    try {
      const detail = await firstValueFrom(this.api.getSearch(searchId));
      if (this.destroyed || this.currentSearchId !== searchId) return;
      if (this.pollFailures > 0) {
        this.error.set(null);
        this.pollFailures = 0;
      }
      this.detail.set(detail);
      this.ensurePlatformFilter(detail);
      if (detail.status === 'PENDING' || detail.status === 'RUNNING') {
        this.searching.set(true);
        this.pollTimer = setTimeout(() => void this.poll(searchId), 2000);
      } else {
        this.searching.set(false);
        if (detail.status === 'PARTIAL') {
          this.warning.set(detail.errorMessage);
        }
        if (detail.status === 'FAILED' || detail.status === 'INTERRUPTED') {
          this.error.set(detail.errorMessage ?? '搜索任务未完成');
        }
      }
    } catch (error) {
      if (this.destroyed || this.currentSearchId !== searchId) return;
      if (
        error instanceof HttpErrorResponse &&
        [400, 401, 403, 404].includes(error.status)
      ) {
        this.error.set(apiErrorMessage(error));
        this.searching.set(false);
        return;
      }
      this.pollFailures += 1;
      if (this.pollFailures <= 4) {
        const delay = Math.min(2000 * 2 ** (this.pollFailures - 1), 15_000);
        this.searching.set(true);
        this.error.set(`暂时无法刷新结果，正在重试（${this.pollFailures}/4）…`);
        this.pollTimer = setTimeout(() => void this.poll(searchId), delay);
      } else {
        this.error.set(apiErrorMessage(error));
        this.searching.set(false);
      }
    }
  }

  private async refresh(searchId: string): Promise<void> {
    try {
      const detail = await firstValueFrom(this.api.getSearch(searchId));
      if (!this.destroyed && this.currentSearchId === searchId) {
        this.detail.set(detail);
        this.ensurePlatformFilter(detail);
      }
    } catch (error) {
      if (this.destroyed || this.currentSearchId !== searchId) return;
      this.error.set(
        `人工核对结果已保存，但刷新列表失败：${apiErrorMessage(error)}。请重新加载页面查看最新分组。`,
      );
    }
  }

  private applyReviewedProduct(updated: Product): void {
    const detail = this.detail();
    if (!detail) return;
    const platforms = detail.platforms.map((platform) => {
      if (platform.platform !== updated.platform) return platform;
      const wasVisible =
        platform.products.some((product) => product.id === updated.id) ||
        platform.uncertainProducts.some((product) => product.id === updated.id);
      const wasExcluded = !wasVisible && platform.excludedCount > 0;

      const products = platform.products.filter((product) => product.id !== updated.id);
      const uncertainProducts = platform.uncertainProducts.filter(
        (product) => product.id !== updated.id,
      );
      let excludedCount = platform.excludedCount;

      if (updated.effectiveMatchStatus === 'MATCH') {
        products.push(updated);
        if (wasExcluded) excludedCount = Math.max(0, excludedCount - 1);
      } else if (updated.effectiveMatchStatus === 'UNCERTAIN') {
        uncertainProducts.push(updated);
        if (wasExcluded) excludedCount = Math.max(0, excludedCount - 1);
      } else if (wasVisible) {
        excludedCount += 1;
      }

      products.sort(byRelevanceThenConfidence);
      uncertainProducts.sort(byRelevanceThenConfidence);
      return {
        ...platform,
        products,
        uncertainProducts,
        matchedCount: products.length,
        uncertainCount: uncertainProducts.length,
        excludedCount,
      };
    });
    this.detail.set({ ...detail, platforms });
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private writeSearchIdToUrl(searchId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('searchId', searchId);
    url.searchParams.delete('history');
    window.history.replaceState({}, '', url.toString());
  }

  private writeViewToUrl(view: 'history' | null, searchId?: string): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('searchId');
    url.searchParams.delete('history');
    if (view === 'history') url.searchParams.set('history', '1');
    if (searchId) url.searchParams.set('searchId', searchId);
    window.history.replaceState({}, '', url.toString());
  }
}
