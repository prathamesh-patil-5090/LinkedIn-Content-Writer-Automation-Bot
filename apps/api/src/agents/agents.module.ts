import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
