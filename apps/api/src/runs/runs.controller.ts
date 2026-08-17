import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.module';
import {
  CurrentUser,
  SessionAuthGuard,
  SessionUser,
} from '../auth/session.guard';
import { PipelineService } from '../pipeline/pipeline.service';
import { LinkedInService } from '../linkedin/linkedin.service';

class SelectedStoryDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  link!: string;

  @IsOptional()
  @IsString()
  why_it_matters?: string;

  @IsOptional()
  @IsString()
  angle?: string;

  @IsOptional()
  @IsNumber()
  trend_score?: number;

  @IsOptional()
  @IsString()
  prediction_reason?: string;
}

class CreateRunDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SelectedStoryDto)
  story?: SelectedStoryDto;
}

class PatchDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  postText?: string;

  @IsOptional()
  @IsString()
  hook?: string;

  @IsOptional()
  hashtags?: string[];
}

class FeedbackDto {
  @IsOptional()
  @IsString()
  feedback?: string;
}

@Controller('runs')
@UseGuards(SessionAuthGuard)
export class RunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly linkedin: LinkedInService,
  ) {}

  @Get('today')
  async today() {
    const run = await this.prisma.run.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        drafts: { orderBy: { version: 'desc' } },
      },
    });

    if (!run) {
      return { run: null, draft: null };
    }

    const draft =
      run.drafts.find((d) => d.status === 'pending') ?? run.drafts[0] ?? null;

    return { run, draft };
  }

  @Get()
  async list(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.run.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          drafts: {
            where: { status: { in: ['pending', 'approved'] } },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.run.count(),
    ]);

    return { items, total, page: Number(page) || 1, pageSize: take };
  }

  @Post()
  async create(@Body() body: CreateRunDto) {
    try {
      const run = await this.pipeline.startRun('manual', body.story);
      return { run };
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        drafts: { orderBy: { version: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  @Patch(':id/draft')
  async patchDraft(@Param('id') id: string, @Body() body: PatchDraftDto) {
    const draft = await this.pendingDraft(id);
    return this.prisma.draft.update({
      where: { id: draft.id },
      data: {
        postText: body.postText ?? draft.postText,
        hook: body.hook ?? draft.hook,
        hashtags: body.hashtags ?? draft.hashtags,
      },
    });
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    const draft = await this.pendingDraft(id);
    if (!draft.postText?.trim()) {
      throw new BadRequestException('Draft has no text to publish');
    }

    await this.prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'approved' },
    });
    await this.prisma.run.update({
      where: { id },
      data: { status: 'publishing', errorMessage: null },
    });

    try {
      const result = await this.linkedin.publishText(
        user.id,
        draft.postText,
        draft.imageUrl,
      );
      await this.prisma.run.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: new Date(),
          linkedinPostUrn: result.urn,
        },
      });
      // Grow voice bank from what you actually shipped
      await this.prisma.voiceSample.create({
        data: {
          title:
            draft.hook ||
            draft.sourceTitle ||
            `Published ${new Date().toISOString().slice(0, 10)}`,
          body: draft.postText,
          sourceUrl: draft.sourceLink,
          source: 'published_by_app',
          isActive: true,
        },
      });
      return {
        ok: true,
        urn: result.urn,
        runId: id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.run.update({
        where: { id },
        data: { status: 'pending_approval', errorMessage: message },
      });
      await this.prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'pending' },
      });
      throw new HttpException(message, 502);
    }
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: FeedbackDto) {
    try {
      const run = await this.pipeline.regenerate(id, body.feedback);
      return { run };
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post(':id/skip')
  async skip(@Param('id') id: string) {
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Run not found');

    await this.prisma.draft.updateMany({
      where: { runId: id, status: 'pending' },
      data: { status: 'rejected', feedback: 'skipped' },
    });
    await this.prisma.run.update({
      where: { id },
      data: { status: 'skipped' },
    });
    return { ok: true };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    try {
      return await this.pipeline.cancel(id);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post('cancel')
  async cancelLatest() {
    try {
      return await this.pipeline.cancel();
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post(':id/save-voice')
  async saveVoice(@Param('id') id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        drafts: {
          where: { status: { in: ['approved', 'pending'] } },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!run) throw new NotFoundException('Run not found');
    const draft = run.drafts[0];
    if (!draft?.postText) {
      throw new BadRequestException('No draft text to save');
    }

    const sample = await this.prisma.voiceSample.create({
      data: {
        title: draft.hook || draft.sourceTitle || `Published ${id.slice(0, 8)}`,
        body: draft.postText,
        sourceUrl: draft.sourceLink,
        source: 'published_by_app',
        isActive: true,
      },
    });
    return sample;
  }

  private async pendingDraft(runId: string) {
    const draft = await this.prisma.draft.findFirst({
      where: { runId, status: 'pending' },
      orderBy: { version: 'desc' },
    });
    if (!draft) throw new NotFoundException('No pending draft for this run');
    return draft;
  }

  private rethrow(err: unknown): never {
    if (err instanceof HttpException) throw err;
    if (err && typeof err === 'object' && 'status' in err) {
      const status = Number((err as { status: number }).status);
      const message = err instanceof Error ? err.message : String(err);
      if (status === 409) throw new ConflictException(message);
      if (status === 404) throw new NotFoundException(message);
      if (status === 400) throw new BadRequestException(message);
      throw new HttpException(message, status || 500);
    }
    throw err;
  }
}
