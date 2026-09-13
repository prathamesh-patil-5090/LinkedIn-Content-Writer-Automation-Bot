import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { WritingProfileService } from './writing-profile.service';
import { GithubIngestService } from './github-ingest.service';
import { FeedbackService } from './feedback.service';
import { PillarService } from './pillar.service';
import { ContentConfigService } from './content-config.service';

@Controller('content')
@UseGuards(SessionAuthGuard)
export class ContentController {
  constructor(
    private readonly writing: WritingProfileService,
    private readonly github: GithubIngestService,
    private readonly feedback: FeedbackService,
    private readonly pillars: PillarService,
    private readonly config: ContentConfigService,
  ) {}

  @Get('config')
  configSnapshot() {
    return {
      autonomousPublish: this.config.autonomousPublish(),
      contentScoreThreshold: this.config.contentScoreThreshold(),
      qualityScoreThreshold: this.config.qualityScoreThreshold(),
      authenticityThreshold: this.config.authenticityThreshold(),
      aiGenericnessMax: this.config.aiGenericnessMax(),
      maxRegenerationAttempts: this.config.maxRegenerationAttempts(),
      pillarWeights: this.config.pillarWeights(),
      githubConfigured: this.github.configured(),
    };
  }

  @Get('pillars')
  async pillarStats() {
    const distribution = await this.pillars.recentDistribution(20);
    const boosts = await this.pillars.diversityBoosts(20);
    const feedback = await this.feedback.cautiousPillarHints();
    return { distribution, boosts, feedback };
  }

  @Get('writing-profile')
  async writingProfile() {
    return this.writing.getActive();
  }

  @Post('writing-profile/rebuild')
  async rebuildProfile() {
    return this.writing.rebuildFromSamples();
  }

  @Post('github/ingest')
  async ingestGithub() {
    return this.github.ingestRecent();
  }
}
