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
import { SearchOptions } from '../../common/interfaces/provider.interface';
import { formatTaobaoTimestamp, nowIso } from '../../common/utils/date.util';
import { toHttpUrl } from '../../common/utils/url.util';
import { envInt } from '../../database/typeorm.config';

interface TaobaoMapData {
  item_id?: number | string;
  title?: string;
  pict_url?: string;
  small_images?: { string?: string[] };
  zk_final_price?: string;
  reserve_price?: string;
  coupon_amount?: string;
  coupon_share_url?: string;
  coupon_start_time?: string;
  coupon_end_time?: string;
  item_url?: string;
  click_url?: string;
  shop_title?: string;
  seller_id?: number | string;
  user_type?: number;
  volume?: number;
  item_basic_info?: {
    title?: string;
    shop_title?: string;
    pict_url?: string;
    item_url?: string;
  };
}

interface TaobaoResponse {
  tbk_dg_material_optional_response?: {
    result_list?: { map_data?: TaobaoMapData[] };
    total_results?: number;
  };
  error_response?: {
    code?: number;
    msg?: string;
    sub_code?: string;
    sub_msg?: string;
  };
}

@Injectable()
export class TaobaoApiClient {
  private readonly logger = new Logger(TaobaoApiClient.name);

  constructor(private readonly config: ConfigService) {}

  get appKey(): string {
    return (this.config.get<string>('TAOBAO_APP_KEY') ?? '').trim();
  }

  get appSecret(): string {
    return (this.config.get<string>('TAOBAO_APP_SECRET') ?? '').trim();
  }

  get adzoneId(): string {
    return (this.config.get<string>('TAOBAO_ADZONE_ID') ?? '').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.appKey && this.appSecret && this.adzoneId);
  }

  missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.appKey) missing.push('TAOBAO_APP_KEY');
    if (!this.appSecret) missing.push('TAOBAO_APP_SECRET');
    if (!this.adzoneId) missing.push('TAOBAO_ADZONE_ID');
    return missing;
  }

  async search(keyword: string, options: SearchOptions): Promise<NormalizedProduct[]> {
    const pageSize = Math.min(20, Math.max(1, options.maxResults));
    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();

    for (let pageNo = 1; pageNo <= options.maxPages; pageNo += 1) {
      const data = await this.call('taobao.tbk.dg.material.optional', {
        q: keyword,
        adzone_id: this.adzoneId,
        page_no: String(pageNo),
        page_size: String(pageSize),
      });
      const response = data.tbk_dg_material_optional_response;
      if (!response) {
        throw new ParseFailedError(
          '淘宝接口返回 200，但响应缺少 tbk_dg_material_optional_response 字段',
        );
      }
      const rawList = response.result_list?.map_data;
      if (!response.result_list && (response.total_results ?? 0) > 0) {
        throw new ParseFailedError('淘宝接口报告有结果，但未返回 result_list');
      }
      if (response.result_list !== undefined && rawList !== undefined && !Array.isArray(rawList)) {
        throw new ParseFailedError('淘宝接口 result_list.map_data 字段格式异常');
      }
      const list = Array.isArray(rawList) ? rawList : [];
      let parsedThisPage = 0;

      for (const item of list) {
        const product = this.toNormalizedProduct(item);
        if (!product) continue;
        parsedThisPage += 1;
        const dedupeKey = product.platformProductId ?? product.productUrl;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        products.push(product);
        if (products.length >= options.maxResults) break;
      }

      if (list.length > 0 && parsedThisPage === 0) {
        throw new ParseFailedError('淘宝接口返回了商品数据，但关键字段无法解析');
      }

      if (products.length >= options.maxResults || list.length < pageSize) break;
      if (pageNo < options.maxPages) {
        await this.sleep(options.requestDelayMs);
      }
    }

    return products;
  }

  private async call(
    method: string,
    businessParams: Record<string, string>,
  ): Promise<TaobaoResponse> {
    const params: Record<string, string> = {
      method,
      app_key: this.appKey,
      timestamp: formatTaobaoTimestamp(),
      format: 'json',
      v: '2.0',
      sign_method: 'md5',
      ...businessParams,
    };
    params.sign = this.sign(params);

    const gateway =
      this.config.get<string>('TAOBAO_GATEWAY_URL') ?? 'https://eco.taobao.com/router/rest';
    const timeout = envInt(this.config.get<string>('PROVIDER_HTTP_TIMEOUT_MS'), 20_000);

    let body: TaobaoResponse;
    try {
      const response = await axios.post<TaobaoResponse>(gateway, new URLSearchParams(params).toString(), {
        timeout,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      });
      body = response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`淘宝 API 请求失败：${message}`);
      throw new ProviderError('TAOBAO_NETWORK_ERROR', `淘宝接口请求失败：${message}`);
    }

    if (body.error_response) {
      const err = body.error_response;
      const detail = [err.code, err.msg, err.sub_code, err.sub_msg]
        .filter(Boolean)
        .join(' / ');
      this.logger.warn(`淘宝 API 返回错误：${detail}`);
      throw new ProviderError('TAOBAO_API_ERROR', `淘宝接口返回错误：${detail}`);
    }

    return body;
  }

  private sign(params: Record<string, string>): string {
    const sortedKeys = Object.keys(params)
      .filter((key) => key !== 'sign' && params[key] !== '')
      .sort();
    const joined = sortedKeys.map((key) => `${key}${params[key]}`).join('');
    return createHash('md5')
      .update(`${this.appSecret}${joined}${this.appSecret}`, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  private toNormalizedProduct(item: TaobaoMapData): NormalizedProduct | null {
    const title = (item.item_basic_info?.title ?? item.title ?? '').trim();
    if (!title) return null;

    const rawId = item.item_id;
    const platformProductId = rawId === undefined || rawId === null ? undefined : String(rawId);
    const itemUrl = toHttpUrl(item.item_url ?? item.item_basic_info?.item_url);
    const fallbackUrl =
      platformProductId !== undefined
        ? `https://item.taobao.com/item.htm?id=${encodeURIComponent(platformProductId)}`
        : '';
    const productUrl = itemUrl ?? fallbackUrl;
    if (!productUrl) return null;

    const priceNumber = Number.parseFloat(item.zk_final_price ?? '');
    const amount = Number.isFinite(priceNumber) && priceNumber > 0
      ? Math.round(priceNumber * 100) / 100
      : null;
    const originalNumber = Number.parseFloat(item.reserve_price ?? '');
    const originalAmount =
      Number.isFinite(originalNumber) && originalNumber > 0
        ? Math.round(originalNumber * 100) / 100
        : null;

    const images = [item.pict_url ?? item.item_basic_info?.pict_url ?? '']
      .concat(item.small_images?.string ?? [])
      .map((url) => toHttpUrl(url))
      .filter((url): url is string => Boolean(url));

    const observedAt = nowIso();
    const originalPrice =
      originalAmount !== null && amount !== null && originalAmount > amount
        ? {
            amount: originalAmount,
            currency: 'CNY',
            displayText: `¥${originalAmount.toFixed(2)}`,
            priceType: PriceTypeEnum.LISTING,
            priceSource: 'taobao_tbk_api',
            observedAt,
            shippingIncluded: 'unknown' as const,
            note: '接口返回的折前原价（reserve_price）',
          }
        : null;

    return {
      platform: PlatformEnum.TAOBAO,
      platformProductId,
      title,
      shopName: item.shop_title ?? item.item_basic_info?.shop_title ?? undefined,
      productUrl,
      imageUrls: [...new Set(images)].slice(0, 6),
      skuOptions: [],
      price: {
        amount,
        currency: 'CNY',
        displayText: amount !== null ? `¥${amount.toFixed(2)}` : '未获取',
        priceType: amount !== null ? PriceTypeEnum.LISTING : PriceTypeEnum.UNKNOWN,
        priceSource: 'taobao_tbk_api',
        observedAt,
        shippingIncluded: 'unknown',
        originalAmount,
        originalDisplayText:
          originalPrice !== null ? originalPrice.displayText : null,
        note:
          amount !== null
            ? '淘宝客接口返回的商品展示价，未确认具体 SKU'
            : '接口未返回可解析的当前价格',
      },
      originalPrice,
      sourceType: SourceTypeEnum.OFFICIAL_API,
      source: ObservationSourceEnum.OFFICIAL_API,
      providerKey: ProviderKeyEnum.TAOBAO_TBK,
      sourceProductId: platformProductId,
      salesText: item.volume !== undefined ? `销量 ${item.volume}` : undefined,
      region: null,
      regionNote: null,
      collectedAt: observedAt,
      rawData: {
        item_id: item.item_id,
        zk_final_price: item.zk_final_price,
        reserve_price: item.reserve_price,
        coupon_amount: item.coupon_amount,
        coupon_start_time: item.coupon_start_time,
        coupon_end_time: item.coupon_end_time,
        user_type: item.user_type,
        seller_id: item.seller_id,
        volume: item.volume,
        item_url: item.item_url,
        click_url: item.coupon_share_url ?? item.click_url,
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}
