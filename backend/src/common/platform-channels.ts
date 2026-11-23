import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceTypeEnum,
} from './enums';

export interface PlatformChannelDefinition {
  platform: PlatformEnum;
  provider: ProviderKeyEnum;
  providerType: SourceTypeEnum;
  source: ObservationSourceEnum;
  label: string;
}

/**
 * 每个平台的数据来源。抖音/小红书必须同时创建第三方 API 与 Playwright 两个独立任务。
 * 淘宝/拼多多保持原有单来源，不改变既有采集逻辑。
 */
export const PLATFORM_CHANNELS: PlatformChannelDefinition[] = [
  {
    platform: PlatformEnum.TAOBAO,
    provider: ProviderKeyEnum.TAOBAO_TBK,
    providerType: SourceTypeEnum.OFFICIAL_API,
    source: ObservationSourceEnum.OFFICIAL_API,
    label: '淘宝客 API',
  },
  {
    platform: PlatformEnum.DOUYIN,
    provider: ProviderKeyEnum.QOVIA,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'Qovia 第三方 API',
  },
  {
    platform: PlatformEnum.DOUYIN,
    provider: ProviderKeyEnum.PLAYWRIGHT,
    providerType: SourceTypeEnum.BROWSER,
    source: ObservationSourceEnum.PLAYWRIGHT,
    label: 'Playwright 浏览器',
  },
  {
    platform: PlatformEnum.XIAOHONGSHU,
    provider: ProviderKeyEnum.OKDATA,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'OKData 第三方 API',
  },
  {
    platform: PlatformEnum.XIAOHONGSHU,
    provider: ProviderKeyEnum.PLAYWRIGHT,
    providerType: SourceTypeEnum.BROWSER,
    source: ObservationSourceEnum.PLAYWRIGHT,
    label: 'Playwright 浏览器',
  },
  {
    platform: PlatformEnum.PINDUODUO,
    provider: ProviderKeyEnum.PDD_DDK,
    providerType: SourceTypeEnum.OFFICIAL_API,
    source: ObservationSourceEnum.OFFICIAL_API,
    label: '多多进宝 API',
  },
];

export function channelsForPlatform(
  platform: PlatformEnum,
): PlatformChannelDefinition[] {
  return PLATFORM_CHANNELS.filter((channel) => channel.platform === platform);
}

export function getChannelDefinition(
  platform: PlatformEnum,
  provider: ProviderKeyEnum | string,
): PlatformChannelDefinition | undefined {
  return PLATFORM_CHANNELS.find(
    (channel) => channel.platform === platform && channel.provider === provider,
  );
}

export const PROVIDER_LABELS: Record<ProviderKeyEnum, string> = {
  [ProviderKeyEnum.TAOBAO_TBK]: '淘宝客 API',
  [ProviderKeyEnum.PDD_DDK]: '多多进宝 API',
  [ProviderKeyEnum.QOVIA]: 'Qovia 第三方 API',
  [ProviderKeyEnum.BAMBOO]: 'Bamboo 第三方 API',
  [ProviderKeyEnum.OKDATA]: 'OKData 第三方 API',
  [ProviderKeyEnum.SOCIALTOAI]: 'SocialToAI 第三方 API',
  [ProviderKeyEnum.PLAYWRIGHT]: 'Playwright 浏览器',
};
