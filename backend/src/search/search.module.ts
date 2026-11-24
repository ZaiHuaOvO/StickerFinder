import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowserModule } from '../browser/browser.module';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductMatchResult,
  ProductObservation,
  ProductPromotion,
  ProductRuleResult,
  SearchRun,
} from '../entities';
import { ProvidersModule } from '../providers/providers.module';
import { CandidateAggregationService } from './candidate-aggregation.service';
import { SearchController } from './search.controller';
import { SearchHistoryController } from './search-history.controller';
import { SearchHistoryService } from './search-history.service';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { SearchService } from './search.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SearchRun,
      PlatformSearchTask,
      ProductCandidate,
      ProductObservation,
      ProductPromotion,
      ProductRuleResult,
      ProductMatchResult,
    ]),
    ProvidersModule,
    BrowserModule,
  ],
  controllers: [SearchController, SearchHistoryController],
  providers: [
    SearchService,
    SearchOrchestratorService,
    CandidateAggregationService,
    SearchHistoryService,
  ],
})
export class SearchModule {}
