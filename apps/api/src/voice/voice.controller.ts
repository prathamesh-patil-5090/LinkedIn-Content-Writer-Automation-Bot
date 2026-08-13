import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { memoryStorage } from 'multer';
import AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.module';
import { SessionAuthGuard } from '../auth/session.guard';

class CreateVoiceDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(50)
  body!: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;
}

class UpdateVoiceDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Controller('voice-samples')
@UseGuards(SessionAuthGuard)
export class VoiceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.voiceSample.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  @Post()
  create(@Body() body: CreateVoiceDto) {
    return this.prisma.voiceSample.create({
      data: {
        title: body.title,
        body: body.body,
        sourceUrl: body.sourceUrl,
        source: 'manual',
        isActive: true,
      },
    });
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async importFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Upload a Shares.csv or LinkedIn zip export');
    }

    const name = (file.originalname || '').toLowerCase();
    let csvText = '';

    if (name.endsWith('.zip') || file.mimetype === 'application/zip') {
      const zip = new AdmZip(file.buffer);
      const entry =
        zip.getEntries().find((e) => /shares\.csv$/i.test(e.entryName)) ||
        zip.getEntries().find((e) => /\.csv$/i.test(e.entryName));
      if (!entry) {
        throw new BadRequestException('No Shares.csv found inside zip');
      }
      csvText = entry.getData().toString('utf8');
    } else {
      csvText = file.buffer.toString('utf8');
    }

    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];

    const created: Array<{ id: string; title: string }> = [];
    for (const row of rows) {
      const body =
        pick(row, [
          'ShareCommentary',
          'shareCommentary',
          'Commentary',
          'commentary',
          'ShareText',
          'Text',
          'text',
          'Body',
          'body',
        ])?.trim() || '';
      if (body.length < 50) continue;

      const link = pick(row, [
        'ShareLink',
        'shareLink',
        'SharedUrl',
        'URL',
        'Url',
        'url',
        'Link',
      ]);
      const date = pick(row, ['Date', 'date', 'Created', 'createdAt']);
      const title = `LinkedIn export${date ? ` · ${date.slice(0, 10)}` : ''}`;

      const sample = await this.prisma.voiceSample.create({
        data: {
          title,
          body,
          sourceUrl: link || null,
          source: 'linkedin_export',
          isActive: true,
        },
      });
      created.push({ id: sample.id, title: sample.title });
    }

    return { imported: created.length, samples: created };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateVoiceDto) {
    const existing = await this.prisma.voiceSample.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    return this.prisma.voiceSample.update({
      where: { id },
      data: {
        title: body.title,
        body: body.body,
        isActive: body.isActive,
      },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.voiceSample.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    await this.prisma.voiceSample.delete({ where: { id } });
    return { ok: true };
  }
}

function pick(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v) return v;
  }
  return undefined;
}
