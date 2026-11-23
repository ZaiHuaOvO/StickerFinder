import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ProviderError, ParseFailedError } from '../../common/errors/provider.errors';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { SearchOptions } from '../../common/interfaces/provider.interface';
import { envInt } from '../../database/typeorm.config';
import { mapQoviaData, QoviaSearchData } from './qovia.mapper';

interface QoviaEnvelope {
  request_id?: string;
  data?: QoviaSearchData | null;
  meta?: {
    empty?: boolean;
    billed?: boolean;
    charged_usd?: number | string;
    [key: string]: unknown;
  };
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    [key: string]: unknown;
  };
}

@Injectable()
export class QoviaApiClient {
  private readonly logger = new Logger(QoviaApiClient.name);

  constructor(private readonly config: ConfigService) {}

  get apiKey(): string {
    return (this.config.get<string>('QOVIA_API_KEY') ?? '').trim();
  }

  get baseUrl(): string {
    return (this.config.get<string>('QOVIA_BASE_URL') ?? 'https://api.qovia.ai').replace(
      /\/+$/,
      '',
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(keyword: string, options: SearchOptions): Promise<NormalizedProduct[]> {
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();
    let searchId: string | undefined;

    for (let page = 1; page <= options.maxPages; page += 1) {
      const params: Record<string, string> = {
        keyword: keyword.slice(0, 100),
        page: String(page),
      };
      if (searchId) params.search_id = searchId;

      const envelope = await this.call(params);
      if (envelope.error) {
        const error = envelope.error;
        throw new ProviderError(
          'QOVIA_API_ERROR',
          `Qovia 返回错误：${[error.code, error.message].filter(Boolean).join(' / ')}`,
        );
      }
      if (!envelope.data && !envelope.meta?.empty) {
        throw new ParseFailedError('Qovia 响应缺少 data，且未标记为空结果');
      }

      const mapped = mapQoviaData(envelope.data);
      for (const product of mapped.products) {
        const key = product.platformProductId ?? product.productUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(product);
        if (products.length >= options.maxResults) break;
      }

      if (products.length >= options.maxResults || !mapped.hasMore) break;
      if (!mapped.searchId) {
        this.logger.warn('Qovia 返回 has_more=true 但没有 search_id，停止翻页');
        break;
      }
      searchId = mapped.searchId;
      if (page < options.maxPages) {
        await this.sleep(options.requestDelayMs);
      }
    }

    return products;
  }

  private async call(params: Record<string, string>): Promise<QoviaEnvelope> {
    const timeout = envInt(this.config.get<string>('PROVIDER_HTTP_TIMEOUT_MS'), 20_000);
    try {
      const response = await axios.get<QoviaEnvelope>(
        `${this.baseUrl}/v1/raw/douyin/goods_search`,
        {
          params,
          timeout: Math.max(timeout, 30_000),
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        },
      );
      return response.data ?? {};
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const body = error.response?.data as QoviaEnvelope | undefined;
        const detail =
          body?.error?.code || body?.error?.message
            ? [body.error?.code, body.error?.message].filter(Boolean).join(' / ')
            : `HTTP ${error.response?.status ?? 'unknown'}`;
        this.logger.warn(`Qovia 请求失败：${detail}`);
        throw new ProviderError(
          'QOVIA_API_ERROR',
          `Qovia 请求失败：${detail}`,
          typeof body?.error?.message === 'string' ? body.error.message : undefined,
        );
      }
      throw new ProviderError('QOVIA_NETWORK_ERROR', `Qovia 网络请求失败：${String(error)}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
