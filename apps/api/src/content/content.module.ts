import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ContentConfigService } from './content-config.service';
import { SourceEventsService } from './source-events.service';
import { OpportunityScorerService } from './opportunity-scorer.service';
import { PillarService } from './pillar.service';
import { AngleHookService } from './angle-hook.service';
import { QualityGateService } from './quality-gate.service';
import { WritingProfileService } from './writing-profile.service';
import { FeedbackService } from './feedback.service';
import { GithubIngestService } from './github-ingest.service';
import { ContentController } from './content.controller';

@Module({
  imports: [LlmModule],
  controllers: [ContentController],
  providers: [
    ContentConfigService,
    SourceEventsService,
    OpportunityScorerService,
    PillarService,
    AngleHookService,
    QualityGateService,
    WritingProfileService,
    FeedbackService,
    GithubIngestService,
  ],
  exports: [
    ContentConfigService,
    SourceEventsService,
    OpportunityScorerService,
    PillarService,
    AngleHookService,
    QualityGateService,
    WritingProfileService,
    FeedbackService,
    GithubIngestService,
  ],
})
export class ContentModule {}
