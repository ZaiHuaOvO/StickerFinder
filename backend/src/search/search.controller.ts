import {
  Body,
  Controller,
  Delete,
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

  @Post('searches/:id/cancel')
  cancelSearch(@Param('id') id: string) {
    return this.searchService.cancelSearch(id);
  }

  @Patch('candidates/:id/review')
  reviewCandidate(@Param('id') id: string, @Body() dto: ReviewCandidateDto) {
    return this.searchService.reviewCandidate(id, dto);
  }

  /** 等待人工验证时：打开独立的可见浏览器 */
  @Post('searches/:searchId/tasks/:taskId/verification/browser')
  openVerificationBrowser(
    @Param('searchId') searchId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.searchService.openVerificationBrowser(searchId, taskId);
  }

  /** 关闭验证浏览器窗口（用户数据目录随之释放） */
  @Delete('searches/:searchId/tasks/:taskId/verification/browser')
  closeVerificationBrowser(
    @Param('searchId') searchId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.searchService.closeVerificationBrowser(searchId, taskId);
  }

  /** 人工验证完成后继续采集 */
  @Post('searches/:searchId/tasks/:taskId/verification/resume')
  resumeVerification(
    @Param('searchId') searchId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.searchService.resumeVerification(searchId, taskId);
  }

  @Get('providers/status')
  getProviderStatuses() {
    return this.searchService.getProviderStatuses();
  }

  @Get('providers/everyinfra/usage')
  getEveryInfraUsage() {
    return this.searchService.getEveryInfraUsage();
  }

  /** 用户主动触发的 1688 图片搜索；默认关闭，只接受公网 HTTPS 图片地址。 */
  @Post('providers/everyinfra/alibaba1688/image-search')
  search1688ByImage(@Body('imageUrl') imageUrl: string) {
    return this.searchService.search1688ByImage(imageUrl);
  }
}
