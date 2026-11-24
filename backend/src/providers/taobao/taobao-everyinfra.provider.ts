import { Injectable } from '@nestjs/common';
import { PlatformEnum, ProviderKeyEnum } from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { EveryInfraClient } from '../everyinfra/everyinfra.client';
import { EveryInfraConfig } from '../everyinfra/everyinfra.config';
import { EveryInfraProviderBase } from '../everyinfra/everyinfra-provider.base';
import { EveryInfraPlatform } from '../everyinfra/everyinfra.types';
import {
  mapTaobaoDetail,
  mapTaobaoProduct,
} from '../everyinfra/mappers/taobao.mapper';

@Injectable()
export class TaobaoEveryInfraProvider extends EveryInfraProviderBase {
  readonly platform = PlatformEnum.TAOBAO;
  readonly key = ProviderKeyEnum.EVERYINFRA_TAOBAO;

  protected readonly everyinfraPlatform: EveryInfraPlatform = 'taobao';
  protected readonly searchAction = 'search';
  protected readonly detailAction = 'product_detail';
  protected readonly statusText = '淘宝商品搜索（search / product_detail）';
  protected readonly paginationSupported = true;

  constructor(client: EveryInfraClient, config: EveryInfraConfig) {
    super(client, config);
  }

  protected searchParams(
    keyword: string,
    page: number,
    pageSize: number,
  ): Record<string, unknown> {
    return { keyword, page, limit: pageSize, sort: 'relevance' };
  }

  protected detailParams(product: NormalizedProduct): Record<string, unknown> | null {
    const url = product.productUrl || product.platformProductId;
    return url ? { url } : null;
  }

  protected mapSearchItem(item: unknown): NormalizedProduct | null {
    return mapTaobaoProduct(item);
  }

  protected mapDetailItem(
    item: unknown,
    base: NormalizedProduct,
  ): NormalizedProduct | null {
    return mapTaobaoDetail(item, base);
  }

  protected searchWarnings(): string[] {
    return [
      'EveryInfra 第三方数据服务；搜索价格与详情价格分别保存，不自动合并优惠券',
      '页面现价、划线原价、推广价与有条件券后价可能不同，请以淘宝页面为准',
    ];
  }
}
