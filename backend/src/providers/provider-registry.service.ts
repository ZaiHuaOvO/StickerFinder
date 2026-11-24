import { Injectable } from '@nestjs/common';
import { ALL_PLATFORMS, PlatformEnum, ProviderKeyEnum } from '../common/enums';
import {
  PlatformProvider,
  ProviderChannelStatus,
  ProviderStatus,
} from '../common/interfaces/provider.interface';
import { PROVIDER_LABELS } from '../common/platform-channels';
import { Alibaba1688EveryInfraProvider } from './alibaba1688/alibaba1688-everyinfra.provider';
import { DouyinThirdPartyProvider } from './douyin/douyin-third-party.provider';
import { DouyinEveryInfraProvider } from './douyin/douyin-everyinfra.provider';
import { DouyinPlaywrightProvider } from './douyin/douyin.provider';
import { PinduoduoProvider } from './pinduoduo/pinduoduo.provider';
import { TaobaoEveryInfraProvider } from './taobao/taobao-everyinfra.provider';
import { TaobaoProvider } from './taobao/taobao.provider';
import { XiaohongshuEveryInfraProvider } from './xiaohongshu/xiaohongshu-everyinfra.provider';
import { XiaohongshuThirdPartyProvider } from './xiaohongshu/okdata.provider';
import { XiaohongshuPlaywrightProvider } from './xiaohongshu/xiaohongshu.provider';

@Injectable()
export class ProviderRegistryService {
  private readonly providers = new Map<string, PlatformProvider>();
  private readonly byPlatform = new Map<PlatformEnum, PlatformProvider[]>();

  constructor(
    taobao: TaobaoProvider,
    taobaoEveryInfra: TaobaoEveryInfraProvider,
    pinduoduo: PinduoduoProvider,
    douyinThirdParty: DouyinThirdPartyProvider,
    douyinEveryInfra: DouyinEveryInfraProvider,
    douyinPlaywright: DouyinPlaywrightProvider,
    xiaohongshuThirdParty: XiaohongshuThirdPartyProvider,
    xiaohongshuEveryInfra: XiaohongshuEveryInfraProvider,
    xiaohongshuPlaywright: XiaohongshuPlaywrightProvider,
    alibaba1688EveryInfra: Alibaba1688EveryInfraProvider,
  ) {
    const all = [
      taobao,
      taobaoEveryInfra,
      pinduoduo,
      douyinThirdParty,
      douyinEveryInfra,
      douyinPlaywright,
      xiaohongshuThirdParty,
      xiaohongshuEveryInfra,
      xiaohongshuPlaywright,
      alibaba1688EveryInfra,
    ];
    for (const provider of all) {
      this.providers.set(this.key(provider.platform, provider.key), provider);
      const list = this.byPlatform.get(provider.platform) ?? [];
      list.push(provider);
      this.byPlatform.set(provider.platform, list);
    }
  }

  get(platform: PlatformEnum, providerKey?: ProviderKeyEnum | string): PlatformProvider {
    if (providerKey && providerKey !== 'legacy') {
      const provider = this.providers.get(this.key(platform, providerKey));
      if (!provider) {
        throw new Error(`未注册的采集渠道：${platform}/${providerKey}`);
      }
      return provider;
    }
    const fallback = this.byPlatform.get(platform)?.[0];
    if (!fallback) {
      throw new Error(`未注册的平台采集器：${platform}`);
    }
    return fallback;
  }

  getAll(platform: PlatformEnum): PlatformProvider[] {
    return this.byPlatform.get(platform) ?? [];
  }

  getStatuses(): Record<PlatformEnum, ProviderStatus> {
    const result = {} as Record<PlatformEnum, ProviderStatus>;
    for (const platform of ALL_PLATFORMS) {
      const providers = this.getAll(platform);
      const channels: ProviderChannelStatus[] = providers.map((provider) => {
        const status = provider.getStatus();
        return {
          key: provider.key,
          label: PROVIDER_LABELS[provider.key] ?? provider.key,
          configured: status.configured,
          providerType: provider.providerType,
          source: provider.source,
          reason: status.reason,
        };
      });
      const configuredChannels = channels.filter((channel) => channel.configured);
      result[platform] = {
        platform,
        configured: configuredChannels.length > 0,
        provider: configuredChannels[0]?.providerType ?? null,
        reason:
          configuredChannels.length > 0
            ? `${configuredChannels.length}/${channels.length} 个来源已配置`
            : `所有来源未配置：${channels
                .map((channel) => channel.reason)
                .filter(Boolean)
                .join('；')}`,
        channels,
      };
    }
    return result;
  }

  private key(platform: PlatformEnum, providerKey: ProviderKeyEnum | string): string {
    return `${platform}:${providerKey}`;
  }
}
