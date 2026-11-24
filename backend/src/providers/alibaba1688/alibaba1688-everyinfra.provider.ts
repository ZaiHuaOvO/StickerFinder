import { Injectable } from '@nestjs/common';
import { ProviderError } from '../../common/errors/provider.errors';
import {
  PlatformEnum,
  ProviderErrorCodeEnum,
  ProviderKeyEnum,
} from '../../common/enums';
import { NormalizedProduct } from '../../common/interfaces/normalized-product.interface';
import { ProviderSearchResult } from '../../common/interfaces/provider.interface';
import { EveryInfraClient } from '../everyinfra/everyinfra.client';
import { EveryInfraConfig } from '../everyinfra/everyinfra.config';
import {
  EveryInfraProviderBase,
  UsageAccumulator,
} from '../everyinfra/everyinfra-provider.base';
import { EveryInfraPlatform } from '../everyinfra/everyinfra.types';
import {
  mapAlibaba1688Detail,
  mapAlibaba1688ImageSearchItem,
  mapAlibaba1688Product,
} from '../everyinfra/mappers/alibaba1688.mapper';

@Injectable()
export class Alibaba1688EveryInfraProvider extends EveryInfraProviderBase {
  readonly platform = PlatformEnum.ALIBABA1688;
  readonly key = ProviderKeyEnum.EVERYINFRA_ALIBABA1688;

  protected readonly everyinfraPlatform: EveryInfraPlatform = 'alibaba1688';
  protected readonly searchAction = 'search';
  protected readonly detailAction = 'product_detail';
  protected readonly statusText =
    '1688 批发搜索（search / product_detail / image_search）';
  protected readonly paginationSupported = false;

  constructor(client: EveryInfraClient, config: EveryInfraConfig) {
    super(client, config);
  }

  protected searchParams(keyword: string): Record<string, unknown> {
    // 第一版只使用 keyword 与 relevance，不设置价格区间/城市限制。
    return { keyword, sort: 'relevance' };
  }

  protected detailParams(product: NormalizedProduct): Record<string, unknown> | null {
    const url = product.productUrl || product.platformProductId;
    return url ? { url } : null;
  }

  protected mapSearchItem(item: unknown): NormalizedProduct | null {
    return mapAlibaba1688Product(item);
  }

  protected mapDetailItem(
    item: unknown,
    base: NormalizedProduct,
  ): NormalizedProduct | null {
    return mapAlibaba1688Detail(item, base);
  }

  protected searchWarnings(): string[] {
    return [
      '1688 为批发采购平台：最低价、阶梯价与起订量只代表采购条件，不能当作零售价',
      'EveryInfra 第三方数据服务；价格区间、MOQ、计价单位与阶梯价缺失时保留为空，不自行推算',
    ];
  }

  /**
   * 1688 图片搜索：默认关闭，只能由用户主动触发，单次一张公网 HTTPS 图片。
   * 本地文件路径不能传入，系统也不提供用户图片的临时公网托管。
   */
  async searchByImage(imageUrl: string): Promise<ProviderSearchResult> {
    if (!this.config.imageSearchEnabled) {
      throw new ProviderError(
        ProviderErrorCodeEnum.EVERYINFRA_IMAGE_SEARCH_DISABLED,
        '1688 图片搜索默认关闭（EVERYINFRA_1688_IMAGE_SEARCH_ENABLED=false）',
      );
    }
    this.client.ensureConfigured(this.everyinfraPlatform);

    let parsed: URL;
    try {
      parsed = new URL(imageUrl);
    } catch {
      throw new ProviderError(
        ProviderErrorCodeEnum.EVERYINFRA_API_ERROR,
        '1688 图片搜索需要一张公网可访问的 HTTPS 图片地址',
      );
    }
    if (parsed.protocol !== 'https:') {
      throw new ProviderError(
        ProviderErrorCodeEnum.EVERYINFRA_API_ERROR,
        '1688 图片搜索只接受 HTTPS 图片地址；本地文件路径不能直接传入',
      );
    }

    const usage = new UsageAccumulator();
    const result = await this.client.call(
      this.everyinfraPlatform,
      'image_search',
      { image_url: parsed.toString() },
    );
    usage.add(result);

    const products: NormalizedProduct[] = [];
    const seen = new Set<string>();
    for (const item of result.items) {
      const product = mapAlibaba1688ImageSearchItem(item);
      if (!product) continue;
      const key = product.platformProductId ?? product.productUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      products.push(product);
      if (products.length >= 5) break;
    }

    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: [
        '1688 图搜最多返回 5 个候选，rank 只表示本次结果顺序，不代表销量排名',
        '图搜结果未包含完整采购条件，需再调用商品详情确认阶梯价与 MOQ',
      ],
      usage: usage.snapshot(),
    };
  }
}
