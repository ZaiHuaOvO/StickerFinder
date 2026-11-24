import { Module } from '@nestjs/common';
import { FixtureService } from './fixture.service';
import { ReplayController } from './replay.controller';
import { ReplayService } from './replay.service';

@Module({
  controllers: [ReplayController],
  providers: [FixtureService, ReplayService],
  exports: [FixtureService, ReplayService],
})
export class ReplayModule {}
