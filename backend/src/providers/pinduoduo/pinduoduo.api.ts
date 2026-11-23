import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'crypto';
import {
  ObservationSourceEnum,
  PlatformEnum,
  PriceTypeEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { ProviderError, ParseFailedError } from '../../common/errors/provider.errors';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { PriceInfo } from '../../common/interfaces/price.interface';
import { SearchOptions } from '../../common/interfaces/provider.interface';
import { nowIso, unixSeconds } from '../../common/utils/date.util';
import { toHttpUrl } from '../../common/utils/url.util';
import { envInt } from '../../database/typeorm.config';

interface PddGood {
  goods_id?: number | string;
  goods_name?: string;
  goods_desc?: string;
  goods_image_url?: string;
  goods_thumbnail_url?: string;
  min_group_price?: number | string;
  min_normal_price?: number | string;
  sales_tip?: string;
  mall_name?: string;
  brand_name?: string;
  coupon_discount?: number;
  coupon_min_order_amount?: number;
  has_coupon?: boolean;
  goods_sign?: string;
  goods_url?: string;
  cat_id?: number;
}

interface PddResponse {
  goods_search_response?: {
    goods_list?: PddGood[];
    total_count?: number;
    search_id?: string;
  };
  error_response?: {
    error_code?: number;
    error_msg?: string;
    sub_code?: string;
    sub_msg?: string;
  };
}

@Injectable()
export class PinduoduoApiClient {
  private readonly logger = new Logger(PinduoduoApiClient.name);

  constructor(private readonly config: ConfigService) {}

  get clientId(): string {
    return (this.config.get<string>('PDD_CLIENT_ID') ?? '').trim();
  }

  get clientSecret(): string {
    return (this.config.get<string>('PDD_CLIENT_SECRET') ?? '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.clientId) missing.push('PDD_CLIENT_ID');
    if (!this.clientSecret) missing.push('PDD_CLIENT_SECRET');
    return missing;
  }

  async search(keyword: string, options: SearchOptions): Promise<NormalizedProduct[]> {
    const pageSize = Math.min(20, Math.max(1, options.maxResults));
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();

    for (let page = 1; page <= options.maxPages; page += 1) {
      const data = await this.call({
        keyword,
        page: String(page),
        page_size: String(pageSize),
        sort_type: '0',
      });
      const response = data.goods_search_response;
      if (!response) {
        throw new ParseFailedError(
          '拼多多接口返回 200，但响应缺少 goods_search_response 字段',
        );
      }
      const rawList = response.goods_list;
      if (!response.goods_list && (response.total_count ?? 0) > 0) {
        throw new ParseFailedError('拼多多接口报告有结果，但未返回 goods_list');
      }
      if (rawList !== undefined && !Array.isArray(rawList)) {
        throw new ParseFailedError('拼多多接口 goods_list 字段格式异常');
      }
      const list = Array.isArray(rawList) ? rawList : [];
      let parsedThisPage = 0;

      for (const good of list) {
        const product = this.toNormalizedProduct(good);
        if (!product) continue;
        parsedThisPage += 1;
        const dedupeKey = product.platformProductId ?? product.productUrl;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        products.push(product);
        if (products.length >= options.maxResults) break;
      }

      if (list.length > 0 && parsedThisPage === 0) {
        throw new ParseFailedError('拼多多接口返回了商品数据，但关键字段无法解析');
      }

      if (products.length >= options.maxResults || list.length < pageSize) break;
      if (page < options.maxPages) {
        await this.sleep(options.requestDelayMs);
      }
    }

    return products;
  }

  private async call(businessParams: Record<string, string>): Promise<PddResponse> {
    const params: Record<string, string> = {
      type: 'pdd.ddk.goods.search',
      client_id: this.clientId,
      timestamp: unixSeconds(),
      data_type: 'JSON',
      ...businessParams,
    };
    const accessToken = (this.config.get<string>('PDD_ACCESS_TOKEN') ?? '').trim();
    if (accessToken) {
      params.access_token = accessToken;
    }
    params.sign = this.sign(params);

    const gateway =
      this.config.get<string>('PDD_GATEWAY_URL') ?? 'https://gw-api.pinduoduo.com/api/router';
    const timeout = envInt(this.config.get<string>('PROVIDER_HTTP_TIMEOUT_MS'), 20_000);

    let body: PddResponse;
    try {
      const response = await axios.post<PddResponse>(
        gateway,
        new URLSearchParams(params).toString(),
        {
          timeout,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        },
      );
      body = response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`拼多多 API 请求失败：${message}`);
      throw new ProviderError('PDD_NETWORK_ERROR', `拼多多接口请求失败：${message}`);
    }

    if (body.error_response) {
      const err = body.error_response;
      const detail = [err.error_code, err.error_msg, err.sub_code, err.sub_msg]
        .filter(Boolean)
        .join(' / ');
      this.logger.warn(`拼多多 API 返回错误：${detail}`);
      throw new ProviderError('PDD_API_ERROR', `拼多多接口返回错误：${detail}`);
    }

    return body;
  }

  private sign(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params)
      .filter((key) => key !== 'sign' && params[key] !== '')
      .sort();
    const joined = sortedKeys.map((key) => `${key}${params[key]}`).join('');
    return createHash('md5')
      .update(`${this.clientSecret}${joined}${this.clientSecret}`, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  private toNormalizedProduct(good: PddGood): NormalizedProduct | null {
    const title = (good.goods_name ?? '').trim();
    if (!title) return null;

    const rawId = good.goods_id;
    const platformProductId = rawId === undefined || rawId === null ? undefined : String(rawId);
    const providedUrl = toHttpUrl(good.goods_url);
    const fallbackUrl =
      platformProductId !== undefined
        ? `https://mobile.yangkeduo.com/goods.html?goods_id=${encodeURIComponent(platformProductId)}`
        : '';
    const productUrl = providedUrl ?? fallbackUrl;
    if (!productUrl) return null;

    const normalPrice = this.centsToYuan(good.min_normal_price);
    const groupPrice = this.centsToYuan(good.min_group_price);
    const observedAt = nowIso();

    const mainPrice: PriceInfo = {
      amount: normalPrice,
      currency: 'CNY',
      displayText:
        normalPrice !== null ? `¥${normalPrice.toFixed(2)} 起` : '未获取单买价',
      priceType: normalPrice !== null ? PriceTypeEnum.LOWEST_SKU : PriceTypeEnum.UNKNOWN,
      priceSource: 'pdd_ddk_api',
      observedAt,
      shippingIncluded: 'unknown',
      note:
        normalPrice !== null
          ? '拼多多接口返回的最低 SKU 单买价，尚未确认是否为目标 SKU'
          : '接口未返回单买价，仅返回拼团价',
    };

    const groupPriceInfo: PriceInfo | null =
      groupPrice !== null
        ? {
            amount: groupPrice,
            currency: 'CNY',
            displayText: `拼团 ¥${groupPrice.toFixed(2)}（需拼团）`,
            priceType: PriceTypeEnum.LOWEST_SKU,
            priceSource: 'pdd_ddk_api',
            observedAt,
            shippingIncluded: 'unknown',
            note: '拼团价格，不能作为普通单买价展示',
          }
        : null;

    const images = [good.goods_image_url ?? '', good.goods_thumbnail_url ?? '']
      .map((url) => toHttpUrl(url))
      .filter((url): url is string => Boolean(url));

    return {
      platform: PlatformEnum.PINDUODUO,
      platformProductId,
      title,
      shopName: good.mall_name ?? undefined,
      productUrl,
      imageUrls: [...new Set(images)].slice(0, 6),
      description: good.goods_desc ?? undefined,
      skuOptions: [],
      price: mainPrice,
      groupPrice: groupPriceInfo,
      sourceType: SourceTypeEnum.OFFICIAL_API,
      source: ObservationSourceEnum.OFFICIAL_API,
      providerKey: ProviderKeyEnum.PDD_DDK,
      sourceProductId: platformProductId,
      salesText: good.sales_tip ?? undefined,
      region: null,
      regionNote: null,
      collectedAt: observedAt,
      rawData: {
        goods_id: good.goods_id,
        min_group_price: good.min_group_price,
        min_normal_price: good.min_normal_price,
        sales_tip: good.sales_tip,
        brand_name: good.brand_name,
        coupon_discount: good.coupon_discount,
        coupon_min_order_amount: good.coupon_min_order_amount,
        has_coupon: good.has_coupon,
        goods_sign: good.goods_sign,
        cat_id: good.cat_id,
      },
    };
  }

  private centsToYuan(value: number | string | undefined): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return Math.round(parsed) / 100;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
