import { Injectable } from '@nestjs/common';
import { PlatformEnum, ProviderKeyEnum } from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { EveryInfraClient } from '../everyinfra/everyinfra.client';
import { EveryInfraConfig } from '../everyinfra/everyinfra.config';
import { EveryInfraProviderBase } from '../everyinfra/everyinfra-provider.base';
import {
  EveryInfraCallResult,
  EveryInfraPlatform,
} from '../everyinfra/everyinfra.types';
import {
  mapXiaohongshuDetail,
  mapXiaohongshuProduct,
} from '../everyinfra/mappers/xiaohongshu.mapper';

@Injectable()
export class XiaohongshuEveryInfraProvider extends EveryInfraProviderBase {
  readonly platform = PlatformEnum.XIAOHONGSHU;
  readonly key = ProviderKeyEnum.EVERYINFRA_XIAOHONGSHU;

  protected readonly everyinfraPlatform: EveryInfraPlatform = 'xiaohongshu';
  protected readonly searchAction = 'product_search';
  protected readonly detailAction = 'product_detail';
  protected readonly statusText =
    '小红书商城商品搜索（product_search / product_detail）';
  protected readonly paginationSupported = true;
  protected readonly useActualResultCount = true;

  constructor(client: EveryInfraClient, config: EveryInfraConfig) {
    super(client, config);
  }

  protected searchParams(
    keyword: string,
    page: number,
    pageSize: number,
    pageToken?: string,
  ): Record<string, unknown> {
    void page;
    void pageSize;
    return {
      keyword,
      ...(pageToken ? { next_page_token: pageToken } : {}),
    };
  }

  protected detailParams(product: NormalizedProduct): Record<string, unknown> | null {
    return product.platformProductId
      ? { product_id: product.platformProductId }
      : null;
  }

  protected mapSearchItem(item: unknown): NormalizedProduct | null {
    return mapXiaohongshuProduct(item);
  }

  protected mapDetailItem(
    item: unknown,
    base: NormalizedProduct,
  ): NormalizedProduct | null {
    return mapXiaohongshuDetail(item, base);
  }

  protected nextPageToken(result: EveryInfraCallResult): string | undefined {
    const data = result.raw['data'];
    const fromData =
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)['next_page_token']
        : undefined;
    const value = result.raw['next_page_token'] ?? fromData;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  protected searchWarnings(): string[] {
    return [
      'EveryInfra 第三方数据服务；只收录商城商品，笔记类结果不会入库',
      '接口未返回币种时价格显示“币种未知”，不假设为人民币',
    ];
  }
}
