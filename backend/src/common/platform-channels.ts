import {
  ObservationSourceEnum,
  PlatformEnum,
  ProviderKeyEnum,
  SourceSelectionModeEnum,
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
 * 每个平台的数据来源。数组顺序即 FALLBACK 模式的备用优先级。
 * EveryInfra 为淘宝/抖音/小红书/1688 的主数据源；原有渠道全部保留。
 */
export const PLATFORM_CHANNELS: PlatformChannelDefinition[] = [
  {
    platform: PlatformEnum.TAOBAO,
    provider: ProviderKeyEnum.EVERYINFRA_TAOBAO,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'EveryInfra 淘宝',
  },
  {
    platform: PlatformEnum.TAOBAO,
    provider: ProviderKeyEnum.TAOBAO_TBK,
    providerType: SourceTypeEnum.OFFICIAL_API,
    source: ObservationSourceEnum.OFFICIAL_API,
    label: '淘宝客 API',
  },
  {
    platform: PlatformEnum.DOUYIN,
    provider: ProviderKeyEnum.EVERYINFRA_DOUYIN,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'EveryInfra 抖音',
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
    provider: ProviderKeyEnum.EVERYINFRA_XIAOHONGSHU,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'EveryInfra 小红书',
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
    platform: PlatformEnum.ALIBABA1688,
    provider: ProviderKeyEnum.EVERYINFRA_ALIBABA1688,
    providerType: SourceTypeEnum.THIRD_PARTY,
    source: ObservationSourceEnum.THIRD_PARTY_API,
    label: 'EveryInfra 1688',
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
  [ProviderKeyEnum.EVERYINFRA_TAOBAO]: 'EveryInfra 淘宝',
  [ProviderKeyEnum.EVERYINFRA_DOUYIN]: 'EveryInfra 抖音',
  [ProviderKeyEnum.EVERYINFRA_XIAOHONGSHU]: 'EveryInfra 小红书',
  [ProviderKeyEnum.EVERYINFRA_ALIBABA1688]: 'EveryInfra 1688',
};

/** 每个平台的主数据源 */
export const PRIMARY_PROVIDERS: Record<PlatformEnum, ProviderKeyEnum> = {
  [PlatformEnum.TAOBAO]: ProviderKeyEnum.EVERYINFRA_TAOBAO,
  [PlatformEnum.DOUYIN]: ProviderKeyEnum.EVERYINFRA_DOUYIN,
  [PlatformEnum.XIAOHONGSHU]: ProviderKeyEnum.EVERYINFRA_XIAOHONGSHU,
  [PlatformEnum.ALIBABA1688]: ProviderKeyEnum.EVERYINFRA_ALIBABA1688,
  [PlatformEnum.PINDUODUO]: ProviderKeyEnum.PDD_DDK,
};

/**
 * PRIMARY / FALLBACK 初始只创建主数据源任务，备用渠道按需创建。
 * PARALLEL 一次创建所有渠道任务，用于人工对照。
 */
export function channelsForMode(
  mode: SourceSelectionModeEnum,
): PlatformChannelDefinition[] {
  if (mode === SourceSelectionModeEnum.PARALLEL) {
    return PLATFORM_CHANNELS;
  }
  return PLATFORM_CHANNELS.filter(
    (channel) => PRIMARY_PROVIDERS[channel.platform] === channel.provider,
  );
}
