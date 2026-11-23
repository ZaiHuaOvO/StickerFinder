import { Module } from '@nestjs/common';
import { DeepseekService } from './deepseek.service';
import { ImageFetcherService } from './image-fetcher.service';
import { ProductClassifierService } from './product-classifier.service';
import { SameProductService } from './same-product.service';

@Module({
  providers: [
    DeepseekService,
    ImageFetcherService,
    ProductClassifierService,
    SameProductService,
  ],
  exports: [DeepseekService, ProductClassifierService, SameProductService],
})
export class AiModule {}
