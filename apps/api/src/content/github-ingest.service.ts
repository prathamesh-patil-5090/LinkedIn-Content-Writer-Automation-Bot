import { Injectable, Logger } from '@nestjs/common';
import { ContentConfigService } from './content-config.service';
import { SourceEventsService } from './source-events.service';

type GhCommit = {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string };
  };
  html_url?: string;
};

/**
 * Optional GitHub commit → SourceEvent ingestion (Phase H).
 * Disabled unless GITHUB_TOKEN + GITHUB_REPOS are set.
 */
@Injectable()
export class GithubIngestService {
  private readonly log = new Logger(GithubIngestService.name);

  constructor(
    private readonly config: ContentConfigService,
    private readonly sources: SourceEventsService,
  ) {}

  configured(): boolean {
    return Boolean(
      this.config.githubToken() && this.config.githubRepos().length,
    );
  }

  async ingestRecent(limitPerRepo = 15): Promise<{ ingested: number; repos: string[] }> {
    if (!this.configured()) {
      return { ingested: 0, repos: [] };
    }
    const token = this.config.githubToken()!;
    const repos = this.config.githubRepos();
    const crag = this.config.cragProjectLabel();
    let ingested = 0;

    for (const repo of repos) {
      try {
        const commits = await this.fetchCommits(repo, token, limitPerRepo);
        for (const c of commits) {
          const project = /crag/i.test(repo) ? crag : repo;
          await this.sources.createGithubEvent({
            repo,
            sha: c.sha,
            message: c.commit.message,
            url: c.html_url,
            author: c.commit.author?.name,
            occurredAt: c.commit.author?.date
              ? new Date(c.commit.author.date)
              : undefined,
            project,
          });
          ingested += 1;
        }
      } catch (err) {
        this.log.warn(
          `GitHub ingest failed for ${repo}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.log.log(`GitHub ingest: ${ingested} events from ${repos.length} repo(s)`);
    return { ingested, repos };
  }

  private async fetchCommits(
    repo: string,
    token: string,
    limit: number,
  ): Promise<GhCommit[]> {
    const url = `https://api.github.com/repos/${repo}/commits?per_page=${Math.min(limit, 30)}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'linkedin-daily-poster',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${repo}`);
    }
    return (await res.json()) as GhCommit[];
  }
}
