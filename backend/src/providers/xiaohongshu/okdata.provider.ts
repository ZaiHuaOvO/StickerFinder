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
import { OkDataApiClient } from './okdata.api';

@Injectable()
export class XiaohongshuThirdPartyProvider implements PlatformProvider {
  readonly platform = PlatformEnum.XIAOHONGSHU;
  readonly key = ProviderKeyEnum.OKDATA;
  readonly providerType = SourceTypeEnum.THIRD_PARTY;
  readonly source = ObservationSourceEnum.THIRD_PARTY_API;

  constructor(private readonly api: OkDataApiClient) {}

  isConfigured(): boolean {
    return this.api.isConfigured();
  }

  getStatus(): ProviderStatus {
    if (!this.api.isConfigured()) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason: '缺少配置：OKDATA_API_KEY',
      };
    }
    return {
      platform: this.platform,
      configured: true,
      provider: this.providerType,
      reason: 'OKData xiaohongshu.shop.products.search（Preview）',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.api.isConfigured()) {
      throw new NotConfiguredError('OKData 未配置：缺少 OKDATA_API_KEY');
    }
    const products = await this.api.search(keyword, options);
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: [
        'OKData 文档说明其小红书商品为海外 App 视角，促销可能与大陆用户不同；未确认中国大陆可购买性',
        'OKData 该接口为 Preview，接口与字段可能变化',
      ],
    };
  }
}
