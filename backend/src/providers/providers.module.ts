import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { DouyinThirdPartyProvider } from './douyin/douyin-third-party.provider';
import { DouyinPlaywrightProvider } from './douyin/douyin.provider';
import { QoviaApiClient } from './douyin/qovia.api';
import { PinduoduoApiClient } from './pinduoduo/pinduoduo.api';
import { PinduoduoProvider } from './pinduoduo/pinduoduo.provider';
import { ProviderRegistryService } from './provider-registry.service';
import { TaobaoApiClient } from './taobao/taobao.api';
import { TaobaoProvider } from './taobao/taobao.provider';
import { OkDataApiClient } from './xiaohongshu/okdata.api';
import { XiaohongshuThirdPartyProvider } from './xiaohongshu/okdata.provider';
import { XiaohongshuPlaywrightProvider } from './xiaohongshu/xiaohongshu.provider';

@Module({
  imports: [BrowserModule],
  providers: [
    TaobaoApiClient,
    TaobaoProvider,
    PinduoduoApiClient,
    PinduoduoProvider,
    QoviaApiClient,
    DouyinThirdPartyProvider,
    DouyinPlaywrightProvider,
    OkDataApiClient,
    XiaohongshuThirdPartyProvider,
    XiaohongshuPlaywrightProvider,
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}
