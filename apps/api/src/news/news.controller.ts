import { Controller, Post, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session.guard';
import { NewsService } from './news.service';
import { AgentsService } from '../agents/agents.service';
import { PrismaService } from '../prisma/prisma.module';
import { loadUsedIndex } from '../pipeline/uniqueness';

@Controller('news')
@UseGuards(SessionAuthGuard)
export class NewsController {
  constructor(
    private readonly news: NewsService,
    private readonly agents: AgentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('candidates')
  async candidates() {
    const used = await loadUsedIndex(this.prisma);
    const { stories, collectedAt } = await this.news.collect(50);
    const fresh = used.unusedStories(stories);
    if (fresh.length === 0) {
      return {
        collectedAt,
        stories: [],
        suggested: null,
        storyCount: 0,
      };
    }

    const research = await this.agents.research(fresh);
    const top = used.unusedStories(research.data.top_stories).slice(0, 12);
    if (top.length === 0) {
      return {
        collectedAt,
        stories: [],
        suggested: null,
        storyCount: fresh.length,
      };
    }
    const rank = await this.agents.rank({ top_stories: top }, used.summary());

    let suggested = rank.data.winner;
    if (used.matchesStory(suggested.title, suggested.link)) {
      suggested = top[0];
    }
    const storiesWithFlag = top.map((s) => ({
      ...s,
      suggested:
        s.title === suggested.title ||
        s.link === suggested.link,
    }));

    // Ensure suggested is first if present in list, else prepend
    const hasSuggested = storiesWithFlag.some((s) => s.suggested);
    const ordered = hasSuggested
      ? [
          ...storiesWithFlag.filter((s) => s.suggested),
          ...storiesWithFlag.filter((s) => !s.suggested),
        ]
      : [
          {
            rank: 0,
            title: suggested.title,
            link: suggested.link,
            why_it_matters: suggested.why_it_matters,
            trend_score: suggested.trend_score ?? 8,
            angle: suggested.angle,
            suggested: true,
          },
          ...storiesWithFlag,
        ];

    return {
      collectedAt,
      storyCount: stories.length,
      stories: ordered,
      suggested,
    };
  }
}
