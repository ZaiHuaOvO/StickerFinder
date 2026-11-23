import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { DouyinProvider } from './douyin/douyin.provider';
import { PinduoduoApiClient } from './pinduoduo/pinduoduo.api';
import { PinduoduoProvider } from './pinduoduo/pinduoduo.provider';
import { ProviderRegistryService } from './provider-registry.service';
import { TaobaoApiClient } from './taobao/taobao.api';
import { TaobaoProvider } from './taobao/taobao.provider';
import { XiaohongshuProvider } from './xiaohongshu/xiaohongshu.provider';

@Module({
  imports: [BrowserModule],
  providers: [
    TaobaoApiClient,
    TaobaoProvider,
    PinduoduoApiClient,
    PinduoduoProvider,
    DouyinProvider,
    XiaohongshuProvider,
    ProviderRegistryService,
  ],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}
