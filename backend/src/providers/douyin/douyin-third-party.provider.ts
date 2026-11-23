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
import { QoviaApiClient } from './qovia.api';

@Injectable()
export class DouyinThirdPartyProvider implements PlatformProvider {
  readonly platform = PlatformEnum.DOUYIN;
  readonly key = ProviderKeyEnum.QOVIA;
  readonly providerType = SourceTypeEnum.THIRD_PARTY;
  readonly source = ObservationSourceEnum.THIRD_PARTY_API;

  constructor(private readonly api: QoviaApiClient) {}

  isConfigured(): boolean {
    return this.api.isConfigured();
  }

  getStatus(): ProviderStatus {
    if (!this.api.isConfigured()) {
      return {
        platform: this.platform,
        configured: false,
        provider: null,
        reason: '缺少配置：QOVIA_API_KEY',
      };
    }
    return {
      platform: this.platform,
      configured: true,
      provider: this.providerType,
      reason: 'Qovia Douyin goods_search（Live Beta，响应字段可能变化）',
    };
  }

  async search(keyword: string, options: SearchOptions): Promise<ProviderSearchResult> {
    if (!this.api.isConfigured()) {
      throw new NotConfiguredError('Qovia 未配置：缺少 QOVIA_API_KEY');
    }
    const products = await this.api.search(keyword, options);
    return {
      products,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY',
      warnings: [
        'Qovia 为第三方数据服务，数据地区未声明；未确认中国大陆可购买性',
        'Qovia goods_search 为 Live Beta，接口与字段可能变化',
      ],
    };
  }
}
