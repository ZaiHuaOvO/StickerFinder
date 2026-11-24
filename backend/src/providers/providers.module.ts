import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { Alibaba1688EveryInfraProvider } from './alibaba1688/alibaba1688-everyinfra.provider';
import { DouyinThirdPartyProvider } from './douyin/douyin-third-party.provider';
import { DouyinEveryInfraProvider } from './douyin/douyin-everyinfra.provider';
import { DouyinPlaywrightProvider } from './douyin/douyin.provider';
import { QoviaApiClient } from './douyin/qovia.api';
import { EveryInfraClient } from './everyinfra/everyinfra.client';
import { EveryInfraConfig } from './everyinfra/everyinfra.config';
import { EveryInfraUsageService } from './everyinfra/everyinfra.usage.service';
import { PinduoduoApiClient } from './pinduoduo/pinduoduo.api';
import { PinduoduoProvider } from './pinduoduo/pinduoduo.provider';
import { ProviderRegistryService } from './provider-registry.service';
import { TaobaoApiClient } from './taobao/taobao.api';
import { TaobaoEveryInfraProvider } from './taobao/taobao-everyinfra.provider';
import { TaobaoProvider } from './taobao/taobao.provider';
import { OkDataApiClient } from './xiaohongshu/okdata.api';
import { XiaohongshuEveryInfraProvider } from './xiaohongshu/xiaohongshu-everyinfra.provider';
import { XiaohongshuThirdPartyProvider } from './xiaohongshu/okdata.provider';
import { XiaohongshuPlaywrightProvider } from './xiaohongshu/xiaohongshu.provider';

@Module({
  imports: [BrowserModule],
  providers: [
    EveryInfraConfig,
    EveryInfraUsageService,
    EveryInfraClient,
    TaobaoApiClient,
    TaobaoProvider,
    TaobaoEveryInfraProvider,
    PinduoduoApiClient,
    PinduoduoProvider,
    QoviaApiClient,
    DouyinThirdPartyProvider,
    DouyinEveryInfraProvider,
    DouyinPlaywrightProvider,
    OkDataApiClient,
    XiaohongshuThirdPartyProvider,
    XiaohongshuEveryInfraProvider,
    XiaohongshuPlaywrightProvider,
    Alibaba1688EveryInfraProvider,
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService, EveryInfraUsageService, EveryInfraConfig],
})
export class ProvidersModule {}
