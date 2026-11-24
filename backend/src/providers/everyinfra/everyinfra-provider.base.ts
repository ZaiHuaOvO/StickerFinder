import { ParseFailedError } from '../../common/errors/provider.errors';
import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import {
  PlatformProvider,
  ProviderDetailResult,
  ProviderSearchResult,
  ProviderStatus,
  ProviderUsageStats,
  SearchOptions,
} from '../../common/interfaces/provider.interface';
import { normalizeProductUrl } from '../../common/utils/url.util';
import { EveryInfraClient } from './everyinfra.client';
import { EveryInfraConfig } from './everyinfra.config';
import { EveryInfraCallResult, EveryInfraPlatform } from './everyinfra.types';

export class UsageAccumulator {
  private calls = 0;
  private charged = 0;
  private chargedKnown = false;
  private readonly requestIds = new Set<string>();

  add(result: EveryInfraCallResult): void {
    this.calls += 1;
    if (typeof result.billing?.charged_usd === 'number') {
      this.chargedKnown = true;
      this.charged += result.billing.charged_usd;
    }
    if (result.requestId) this.requestIds.add(result.requestId);
  }

  snapshot(): ProviderUsageStats {
    return {
      apiRequestCount: this.calls,
      chargedUsd: this.chargedKnown
        ? Math.round(this.charged * 1_000_000) / 1_000_000
        : null,
      requestIds: [...this.requestIds].slice(0, 20),
    };
  }
}

/**
 * 四个 EveryInfra 平台 Provider 的公共实现。
 * HTTP/API Key/超时/billing 全部由 EveryInfraClient 处理，子类只负责参数与字段映射。
 */
export abstract class EveryInfraProviderBase implements PlatformProvider {
  abstract readonly platform: PlatformEnum;
  abstract readonly key: ProviderKeyEnum;

  readonly providerType = SourceTypeEnum.THIRD_PARTY;
  readonly source = ObservationSourceEnum.THIRD_PARTY_API;

  protected abstract readonly everyinfraPlatform: EveryInfraPlatform;
  protected abstract readonly searchAction: string;
  protected abstract readonly detailAction: string | null;
  protected abstract readonly statusText: string;
  protected abstract readonly paginationSupported: boolean;
  /**
   * 抖音/小红书按接口实际返回数量入库，不被通用 SEARCH_MAX_RESULTS_PER_PLATFORM 截断。
   */
  protected readonly useActualResultCount: boolean = false;

  constructor(
    protected readonly client: EveryInfraClient,
    protected readonly config: EveryInfraConfig,
  ) {}

  isConfigured(): boolean {
    return this.config.isAvailable(this.everyinfraPlatform);
  }

  getStatus(): ProviderStatus {
    const reason = this.config.unavailableReason(this.everyinfraPlatform);
    if (reason) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason,
      };
    }
    return {
      platform: this.platform,
      configured: true,
      provider: this.providerType,
      reason: `EveryInfra ${this.statusText}`,
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    this.client.ensureConfigured(this.everyinfraPlatform);
    const usage = new UsageAccumulator();
    const warnings = [...this.searchWarnings()];
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();
    const maxPages = this.paginationSupported
      ? this.config.maxPages(this.everyinfraPlatform)
      : 1;
    const pageSize = this.useActualResultCount
      ? this.config.maxResults(this.everyinfraPlatform)
      : Math.min(
          this.config.maxResults(this.everyinfraPlatform),
          Math.max(1, options.maxResults),
        );
    let token: string | undefined;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.client.call(
        this.everyinfraPlatform,
        this.searchAction,
        this.searchParams(keyword, page, pageSize, token),
      );
      usage.add(result);

      let parsedThisPage = 0;
      for (const item of result.items) {
        const product = this.mapSearchItem(item);
        if (!product) continue;
        product.sourceKeyword = keyword;
        parsedThisPage += 1;
        const dedupeKey =
          product.platformProductId ?? normalizeProductUrl(product.productUrl);
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        products.push(product);
        if (products.length >= pageSize) break;
      }

      if (result.items.length > 0 && parsedThisPage === 0) {
        throw new ParseFailedError(
          `EveryInfra ${this.everyinfraPlatform}/${this.searchAction} 返回了数据，但关键字段无法解析`,
        );
      }
      if (products.length >= pageSize) break;

      token = this.nextPageToken(result);
      if (!token) break;
      if (page < maxPages && options.requestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.requestDelayMs));
      }
    }

    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings,
      usage: usage.snapshot(),
    };
  }

  async fetchDetail(product: NormalizedProduct): Promise<ProviderDetailResult> {
    if (!this.detailAction) {
      return { product: null, warnings: ['该渠道未启用详情接口'] };
    }
    this.client.ensureConfigured(this.everyinfraPlatform);
    const params = this.detailParams(product);
    if (!params) {
      return { product: null, warnings: ['缺少可用的详情请求标识'] };
    }
    const usage = new UsageAccumulator();
    const result = await this.client.call(
      this.everyinfraPlatform,
      this.detailAction,
      params,
    );
    usage.add(result);
    if (result.items.length === 0) {
      return {
        product: null,
        warnings: ['详情接口未返回商品数据'],
        usage: usage.snapshot(),
      };
    }
    const mapped = this.mapDetailItem(result.items[0], product);
    if (!mapped) {
      return {
        product: null,
        warnings: ['详情响应无法解析'],
        usage: usage.snapshot(),
      };
    }
    mapped.sourceKeyword = product.sourceKeyword;
    return { product: mapped, usage: usage.snapshot() };
  }

  protected abstract searchParams(
    keyword: string,
    page: number,
    pageSize: number,
    pageToken?: string,
  ): Record<string, unknown>;

  protected abstract detailParams(
    product: NormalizedProduct,
  ): Record<string, unknown> | null;

  protected abstract mapSearchItem(item: unknown): NormalizedProduct | null;

  protected abstract mapDetailItem(
    item: unknown,
    base: NormalizedProduct,
  ): NormalizedProduct | null;

  protected searchWarnings(): string[] {
    return [];
  }

  /** 只有平台明确返回分页 token 才继续翻页，不猜测参数。 */
  protected nextPageToken(result: EveryInfraCallResult): string | undefined {
    void result;
    return undefined;
  }
}
