import { Injectable } from '@nestjs/common';
import { NotConfiguredError } from '../../common/errors/provider.errors';
import { PlatformEnum, SourceTypeEnum } from '../../common/enums';
import {
  PlatformProvider,
  ProviderSearchResult,
  ProviderStatus,
  SearchOptions,
} from '../../common/interfaces/provider.interface';
import { TaobaoApiClient } from './taobao.api';

@Injectable()
export class TaobaoProvider implements PlatformProvider {
  readonly platform = PlatformEnum.TAOBAO;
  readonly providerType = SourceTypeEnum.OFFICIAL_API;

  constructor(private readonly api: TaobaoApiClient) {}

  isConfigured(): boolean {
    return this.api.isConfigured();
  }

  getStatus(): ProviderStatus {
    if (!this.api.isConfigured()) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason: `缺少配置：${this.api.missingConfig().join('、')}`,
      };
    }
    return {
      platform: this.platform,
      configured: true,
      provider: this.providerType,
      reason: '淘宝客推广物料搜索（taobao.tbk.dg.material.optional）',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.api.isConfigured()) {
      throw new NotConfiguredError(
        `淘宝未配置：缺少 ${this.api.missingConfig().join('、')}`,
      );
    }
    const products = await this.api.search(keyword, options);
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: ['淘宝客接口仅覆盖推广商品，不代表淘宝全站商品'],
    };
  }
}
