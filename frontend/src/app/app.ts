import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { firstValueFrom } from 'rxjs';
import { PlatformPanelComponent } from './components/platform-panel/platform-panel.component';
import { SearchFormComponent } from './components/search-form/search-form.component';
import { ApiService, apiErrorMessage } from './core/api.service';
import { formatDateTime, PLATFORM_META } from './core/labels';
import {
  PLATFORM_ORDER,
  Product,
  ProvidersStatusResponse,
  SearchDetail,
  SearchFormPayload,
} from './core/models';

@Component({
  selector: 'app-root',
  imports: [
    SearchFormComponent,
    PlatformPanelComponent,
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

  readonly platforms = PLATFORM_ORDER;
  readonly platformMeta = PLATFORM_META;
  readonly statuses = signal<ProvidersStatusResponse | null>(null);
  readonly detail = signal<SearchDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly searching = signal(false);
  readonly statusesError = signal<string | null>(null);

  readonly aiStatus = computed(() => this.statuses()?.ai ?? null);
  readonly providerChips = computed(() =>
    PLATFORM_ORDER.map((platform) => ({
      platform,
      meta: PLATFORM_META[platform],
      status: this.statuses()?.platforms?.[platform] ?? null,
    })),
  );
  readonly totalMatched = computed(() =>
    (this.detail()?.platforms ?? []).reduce((sum, item) => sum + item.matchedCount, 0),
  );
  readonly totalUncertain = computed(() =>
    (this.detail()?.platforms ?? []).reduce((sum, item) => sum + item.uncertainCount, 0),
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
      case 'FAILED':
        return '搜索失败';
      case 'INTERRUPTED':
        return '任务被中断';
      default:
        return '';
    }
  });
  readonly runStatusTone = computed(() => {
    const status = this.detail()?.status;
    if (status === 'COMPLETED') return 'success';
    if (status === 'FAILED' || status === 'INTERRUPTED') return 'error';
    if (status === 'RUNNING' || status === 'PENDING') return 'processing';
    return 'default';
  });
  readonly formattedStartedAt = computed(() => formatDateTime(this.detail()?.startedAt));
  readonly formattedCompletedAt = computed(() => formatDateTime(this.detail()?.completedAt));
  readonly configuredCount = computed(
    () => this.providerChips().filter((chip) => chip.status?.configured).length,
  );

  ngOnInit(): void {
    this.loadStatuses();
    const searchId = new URLSearchParams(window.location.search).get('searchId');
    if (searchId) {
      this.currentSearchId = searchId;
      this.searching.set(true);
      void this.poll(searchId);
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
    this.pollFailures = 0;
    this.currentSearchId = null;
    this.error.set(null);
    this.detail.set(null);
    this.searching.set(true);

    try {
      const created = await firstValueFrom(
        this.api.createSearch({
          targetName: payload.targetName,
          seriesName: payload.seriesName,
          aliases: payload.aliases,
          referenceImageId: payload.referenceImageId,
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

  async onReviewed(updated: Product): Promise<void> {
    this.applyReviewedProduct(updated);
    const detail = this.detail();
    if (!detail) return;
    // 本地先更新分组，再从服务端校准；刷新失败也不会留下错误提示语
    await this.refresh(detail.searchId);
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
      if (detail.status === 'PENDING' || detail.status === 'RUNNING') {
        this.searching.set(true);
        this.pollTimer = setTimeout(() => void this.poll(searchId), 2000);
      } else {
        this.searching.set(false);
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

      products.sort(
        (a, b) => (b.match?.confidence ?? -1) - (a.match?.confidence ?? -1),
      );
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
    window.history.replaceState({}, '', url.toString());
  }
}
