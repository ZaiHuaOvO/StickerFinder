import { Injectable } from '@nestjs/common';
import { PlatformEnum, ProviderKeyEnum } from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { EveryInfraClient } from '../everyinfra/everyinfra.client';
import { EveryInfraConfig } from '../everyinfra/everyinfra.config';
import { EveryInfraProviderBase } from '../everyinfra/everyinfra-provider.base';
import { EveryInfraPlatform } from '../everyinfra/everyinfra.types';
import {
  mapDouyinDetail,
  mapDouyinProduct,
} from '../everyinfra/mappers/douyin.mapper';

@Injectable()
export class DouyinEveryInfraProvider extends EveryInfraProviderBase {
  readonly platform = PlatformEnum.DOUYIN;
  readonly key = ProviderKeyEnum.EVERYINFRA_DOUYIN;

  protected readonly everyinfraPlatform: EveryInfraPlatform = 'douyin';
  protected readonly searchAction = 'product_search';
  protected readonly detailAction = 'product_detail';
  protected readonly statusText = '抖音商品搜索（product_search / product_detail）';
  // 抖音目前不支持可靠的后续分页，只请求第一页。
  protected readonly paginationSupported = false;
  protected readonly useActualResultCount = true;

  constructor(client: EveryInfraClient, config: EveryInfraConfig) {
    super(client, config);
  }

  protected searchParams(keyword: string): Record<string, unknown> {
    return { keyword };
  }

  protected detailParams(product: NormalizedProduct): Record<string, unknown> | null {
    return product.platformProductId
      ? { product_id: product.platformProductId }
      : null;
  }

  protected mapSearchItem(item: unknown): NormalizedProduct | null {
    return mapDouyinProduct(item);
  }

  protected mapDetailItem(
    item: unknown,
    base: NormalizedProduct,
  ): NormalizedProduct | null {
    return mapDouyinDetail(item, base);
  }

  protected searchWarnings(): string[] {
    return [
      'EveryInfra 第三方数据服务；抖音只请求第一页，不自动翻页',
      'price_label 为平台价格标签，不代表当前用户最终结算价；promotion_id 与 product_id 分开保存',
    ];
  }
}
