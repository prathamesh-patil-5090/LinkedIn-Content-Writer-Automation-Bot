import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
