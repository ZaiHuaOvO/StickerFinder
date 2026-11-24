import { Body, Controller, Get, Post } from '@nestjs/common';
import { ReplaySearchDto } from './dto/replay-search.dto';
import { ReplayService } from './replay.service';

/**
 * 本地历史数据回放：只读 fixtures，重新执行当前规则。
 * 不写数据库、不调用任何外部接口。
 */
@Controller('replay')
export class ReplayController {
  constructor(private readonly replayService: ReplayService) {}

  @Get('fixtures')
  listFixtures() {
    return this.replayService.listFixtures();
  }

  @Post()
  replay(@Body() dto: ReplaySearchDto) {
    return this.replayService.replay(dto);
  }
}
