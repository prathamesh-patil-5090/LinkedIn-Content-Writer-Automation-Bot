import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

export type WritingProfileJson = {
  tone: string[];
  prefer: string[];
  avoid: string[];
  humour: boolean;
  noEmDash: boolean;
  noBackticks: boolean;
  sampleHooks: string[];
  sampleOpeners: string[];
  updatedFrom: number;
};

const DEFAULT_PROFILE: WritingProfileJson = {
  tone: ['pragmatic', 'builder', 'honest', 'casual'],
  prefer: [
    'concrete engineering detail',
    'first-person lessons',
    'short paragraphs',
    'LinkedIn **bold** / *italic* sparingly',
  ],
  avoid: [
    'em dashes',
    'backticks',
    'excited to announce',
    'game changer',
    'pure product marketing',
  ],
  humour: true,
  noEmDash: true,
  noBackticks: true,
  sampleHooks: [],
  sampleOpeners: [],
  updatedFrom: 0,
};

@Injectable()
export class WritingProfileService {
  private readonly log = new Logger(WritingProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<WritingProfileJson> {
    const row = await this.prisma.writingProfile.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!row) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...(row.profileJson as WritingProfileJson) };
  }

  async rebuildFromSamples(): Promise<WritingProfileJson> {
    const samples = await this.prisma.voiceSample.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { title: true, body: true },
    });
    const published = await this.prisma.draft.findMany({
      where: { status: { in: ['approved', 'auto_approved'] }, postText: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { hook: true, postText: true },
    });

    const profile: WritingProfileJson = {
      ...DEFAULT_PROFILE,
      sampleHooks: [
        ...samples.map((s) => s.title).filter(Boolean),
        ...published.map((d) => d.hook || '').filter(Boolean),
      ].slice(0, 8),
      sampleOpeners: published
        .map((d) => (d.postText || '').split('\n').find(Boolean) || '')
        .filter(Boolean)
        .slice(0, 6),
      updatedFrom: samples.length + published.length,
    };

    await this.prisma.writingProfile.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    const latest = await this.prisma.writingProfile.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    await this.prisma.writingProfile.create({
      data: {
        version: (latest?.version || 0) + 1,
        profileJson: profile,
        isActive: true,
      },
    });
    this.log.log(`WritingProfile v${(latest?.version || 0) + 1} rebuilt`);
    return profile;
  }

  formatForPrompt(profile: WritingProfileJson): string {
    return [
      'Writing profile constraints:',
      `Tone: ${profile.tone.join(', ')}`,
      `Prefer: ${profile.prefer.join('; ')}`,
      `Avoid: ${profile.avoid.join('; ')}`,
      profile.humour ? 'Light humour OK when it serves the point.' : '',
      profile.noEmDash ? 'Never use em/en dashes or spaced hyphen pauses.' : '',
      profile.noBackticks ? 'No backticks; use **bold** or *italic*.' : '',
      profile.sampleHooks.length
        ? `Recent hooks to not echo:\n- ${profile.sampleHooks.slice(0, 5).join('\n- ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
