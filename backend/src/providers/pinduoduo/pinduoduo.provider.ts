import { Injectable } from '@nestjs/common';
import { NotConfiguredError } from '../../common/errors/provider.errors';
import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from '../../common/enums';
import {
  PlatformProvider,
  ProviderSearchResult,
  ProviderStatus,
  SearchOptions,
} from '../../common/interfaces/provider.interface';
import { PinduoduoApiClient } from './pinduoduo.api';

@Injectable()
export class PinduoduoProvider implements PlatformProvider {
  readonly platform = PlatformEnum.PINDUODUO;
  readonly key = ProviderKeyEnum.PDD_DDK;
  readonly providerType = SourceTypeEnum.OFFICIAL_API;
  readonly source = ObservationSourceEnum.OFFICIAL_API;

  constructor(private readonly api: PinduoduoApiClient) {}

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
      reason: '多多进宝商品搜索（pdd.ddk.goods.search）',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.api.isConfigured()) {
      throw new NotConfiguredError(
        `拼多多未配置：缺少 ${this.api.missingConfig().join('、')}`,
      );
    }
    const products = await this.api.search(keyword, options);
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: ['多多进宝接口仅覆盖推广商品，不代表拼多多全站商品'],
    };
  }
}
