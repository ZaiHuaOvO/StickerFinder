import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { firstValueFrom } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import { formatDateTime, PLATFORM_META, RUN_STATUS_META } from '../../core/labels';
import {
  Platform,
  SearchHistoryPage,
  SearchRunStatus,
  SearchHistoryItem,
} from '../../core/models';

@Component({
  selector: 'app-search-history',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzEmptyModule,
    NzSpinModule,
    NzTagModule,
  ],
  templateUrl: './search-history.component.html',
  styleUrl: './search-history.component.less',
})
export class SearchHistoryComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly openDetail = output<string>();
  readonly close = output<void>();

  keyword = '';
  status: SearchRunStatus | '' = '';
  startTime = '';
  endTime = '';

  readonly page = signal(1);
  readonly pageSize = 20;
  readonly result = signal<SearchHistoryPage | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly items = computed<SearchHistoryItem[]>(() => this.result()?.items ?? []);
  readonly total = computed(() => this.result()?.total ?? 0);
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  readonly statusOptions = (
    Object.keys(RUN_STATUS_META) as SearchRunStatus[]
  ).map((value) => ({ value, label: RUN_STATUS_META[value].label }));

  ngOnInit(): void {
    void this.load(1);
  }

  applyFilters(): void {
    void this.load(1);
  }

  resetFilters(): void {
    this.keyword = '';
    this.status = '';
    this.startTime = '';
    this.endTime = '';
    void this.load(1);
  }

  go(page: number): void {
    if (page < 1 || page > this.totalPages() || this.loading()) return;
    void this.load(page);
  }

  platformLabel(platform: Platform): string {
    return PLATFORM_META[platform]?.label ?? platform;
  }

  statusLabel(status: SearchRunStatus): string {
    return RUN_STATUS_META[status]?.label ?? status;
  }

  statusTone(status: SearchRunStatus): string {
    const tone = RUN_STATUS_META[status]?.tone ?? 'default';
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

  format(value: string | null): string {
    return formatDateTime(value);
  }

  private async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.api.listSearchHistory({
          page,
          pageSize: this.pageSize,
          keyword: this.keyword,
          status: this.status,
          startTime: this.startTime || undefined,
          endTime: this.endTime || undefined,
        }),
      );
      this.page.set(page);
      this.result.set(result);
    } catch (error) {
      this.error.set(apiErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
