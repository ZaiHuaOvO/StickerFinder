import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ParseFailedError, ProviderError } from '../../common/errors/provider.errors';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { SearchOptions } from '../../common/interfaces/provider.interface';
import { envInt } from '../../database/typeorm.config';
import { mapOkDataItems, OkDataProduct } from './okdata.mapper';

interface OkDataEnvelope {
  code?: string;
  request_id?: string;
  message?: string;
  message_zh?: string;
  charged?: boolean;
  data?: {
    items?: OkDataProduct[] | null;
    item?: OkDataProduct | null;
  } | null;
  page?: {
    next_cursor?: string | null;
    has_more?: boolean;
    returned?: number;
  } | null;
  warnings?: unknown[];
  meta?: Record<string, unknown>;
}

@Injectable()
export class OkDataApiClient {
  private readonly logger = new Logger(OkDataApiClient.name);

  constructor(private readonly config: ConfigService) {}

  get apiKey(): string {
    return (this.config.get<string>('OKDATA_API_KEY') ?? '').trim();
  }

  get baseUrl(): string {
    return (this.config.get<string>('OKDATA_BASE_URL') ?? 'https://api.okdata.online').replace(
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
    let cursor: string | undefined;

    for (let page = 1; page <= options.maxPages; page += 1) {
      const params: Record<string, string> = {
        query: keyword,
        view: 'standard',
      };
      if (cursor) params.cursor = cursor;

      const envelope = await this.call(params);
      if (envelope.code !== 'ok') {
        throw new ProviderError(
          'OKDATA_API_ERROR',
          `OKData 返回错误：${[envelope.code, envelope.message_zh || envelope.message]
            .filter(Boolean)
            .join(' / ')}`,
        );
      }

      const items = Array.isArray(envelope.data?.items) ? envelope.data.items : [];
      const mapped = mapOkDataItems(items);
      if (items.length > 0 && mapped.length === 0) {
        throw new ParseFailedError('OKData 返回商品数据，但关键字段无法解析');
      }

      for (const product of mapped) {
        const key = product.platformProductId ?? product.productUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(product);
        if (products.length >= options.maxResults) break;
      }

      const nextCursor = envelope.page?.next_cursor ?? undefined;
      const hasMore = Boolean(envelope.page?.has_more);
      if (products.length >= options.maxResults || !hasMore) break;
      if (!nextCursor) {
        this.logger.warn('OKData 返回 has_more=true 但没有 next_cursor，停止翻页');
        break;
      }
      cursor = nextCursor;
      if (page < options.maxPages) {
        await this.sleep(options.requestDelayMs);
      }
    }

    return products;
  }

  private async call(params: Record<string, string>): Promise<OkDataEnvelope> {
    const timeout = envInt(this.config.get<string>('PROVIDER_HTTP_TIMEOUT_MS'), 20_000);
    try {
      const response = await axios.get<OkDataEnvelope>(
        `${this.baseUrl}/v1/xiaohongshu/shop/products/search`,
        {
          params,
          timeout,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        },
      );
      return response.data ?? {};
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const body = error.response?.data as OkDataEnvelope | undefined;
        const detail =
          body?.code || body?.message
            ? [body.code, body.message_zh || body.message]
                .filter(Boolean)
                .join(' / ')
            : `HTTP ${error.response?.status ?? 'unknown'}`;
        this.logger.warn(`OKData 请求失败：${detail}`);
        throw new ProviderError(
          'OKDATA_API_ERROR',
          `OKData 请求失败：${detail}`,
          typeof body?.message === 'string' ? body.message : undefined,
        );
      }
      throw new ProviderError('OKDATA_NETWORK_ERROR', `OKData 网络请求失败：${String(error)}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
