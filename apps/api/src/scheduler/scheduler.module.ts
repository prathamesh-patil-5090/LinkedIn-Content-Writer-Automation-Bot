import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { CronController } from './cron.controller';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  providers: [SchedulerService],
  controllers: [CronController],
  exports: [SchedulerService],
})
export class SchedulerModule {}
