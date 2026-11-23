import { Injectable } from '@nestjs/common';
import { PlatformEnum } from '../common/enums';
import {
  PlatformProvider,
  ProviderStatus,
} from '../common/interfaces/provider.interface';
import { DouyinProvider } from './douyin/douyin.provider';
import { PinduoduoProvider } from './pinduoduo/pinduoduo.provider';
import { TaobaoProvider } from './taobao/taobao.provider';
import { XiaohongshuProvider } from './xiaohongshu/xiaohongshu.provider';

@Injectable()
export class ProviderRegistryService {
  private readonly providers = new Map<PlatformEnum, PlatformProvider>();

  constructor(
    taobao: TaobaoProvider,
    douyin: DouyinProvider,
    xiaohongshu: XiaohongshuProvider,
    pinduoduo: PinduoduoProvider,
  ) {
    for (const provider of [taobao, douyin, xiaohongshu, pinduoduo]) {
      this.providers.set(provider.platform, provider);
    }
  }

  get(platform: PlatformEnum): PlatformProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`未注册的平台采集器：${platform}`);
    }
    return provider;
  }

  getStatuses(): Record<PlatformEnum, ProviderStatus> {
    const result = {} as Record<PlatformEnum, ProviderStatus>;
    for (const [platform, provider] of this.providers) {
      result[platform] = provider.getStatus();
    }
    return result;
  }
}
