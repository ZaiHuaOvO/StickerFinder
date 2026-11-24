import { Controller, Get, Param, Query } from '@nestjs/common';
import { SearchHistoryQueryDto } from './dto/search-history-query.dto';
import { SearchHistoryService } from './search-history.service';
import { SearchService } from './search.service';

/**
 * 搜索历史只读取数据库快照：不调用 EveryInfra 或任何外部接口。
 */
@Controller('search-history')
export class SearchHistoryController {
  constructor(
    private readonly historyService: SearchHistoryService,
    private readonly searchService: SearchService,
  ) {}

  @Get()
  list(@Query() query: SearchHistoryQueryDto) {
    return this.historyService.list(query);
  }

  @Get(':id')
  getDetail(@Param('id') id: string) {
    return this.searchService.getSearch(id);
  }
}
