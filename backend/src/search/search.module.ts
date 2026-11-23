import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  SearchRun,
} from '../entities';
import { ProvidersModule } from '../providers/providers.module';
import { SearchController } from './search.controller';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SearchRun,
      PlatformSearchTask,
      ProductCandidate,
      ProductMatchResult,
    ]),
    ProvidersModule,
    AiModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, SearchOrchestratorService],
})
export class SearchModule {}
