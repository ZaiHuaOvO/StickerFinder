import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateSearchDto } from './dto/create-search.dto';
import { ReviewCandidateDto } from './dto/review-candidate.dto';
import { SearchService } from './search.service';

@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('searches')
  createSearch(@Body() dto: CreateSearchDto) {
    return this.searchService.createSearch(dto);
  }

  @Get('searches')
  listSearches(@Query('limit') limit?: string) {
    return this.searchService.listSearches(Number.parseInt(limit ?? '20', 10) || 20);
  }

  @Get('searches/:id')
  getSearch(@Param('id') id: string) {
    return this.searchService.getSearch(id);
  }

  @Patch('candidates/:id/review')
  reviewCandidate(@Param('id') id: string, @Body() dto: ReviewCandidateDto) {
    return this.searchService.reviewCandidate(id, dto);
  }

  @Get('providers/status')
  getProviderStatuses() {
    return this.searchService.getProviderStatuses();
  }
}
