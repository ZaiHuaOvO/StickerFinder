import { Module } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { ImageFetcherService } from './image-fetcher.service';
import { ProductClassifierService } from './product-classifier.service';

@Module({
  providers: [DeepseekService, ImageFetcherService, ProductClassifierService],
  exports: [DeepseekService, ProductClassifierService],
})
export class AiModule {}
