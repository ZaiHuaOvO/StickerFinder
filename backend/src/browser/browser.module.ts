import { Module } from '@nestjs/common';
import { BrowserLockService } from './browser.lock';
import { BrowserService } from './browser.service';

@Module({
  providers: [BrowserService, BrowserLockService],
  exports: [BrowserService],
})
export class BrowserModule {}
