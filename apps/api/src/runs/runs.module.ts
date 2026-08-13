import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { LinkedInModule } from '../linkedin/linkedin.module';

@Module({
  imports: [PipelineModule, LinkedInModule],
  controllers: [RunsController],
})
export class RunsModule {}
