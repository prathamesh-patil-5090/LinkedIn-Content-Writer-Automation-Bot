import './load-env.cjs';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const DEFAULT_SOURCES = [
  {
    name: 'HN JavaScript',
    rssUrl:
      'https://hnrss.org/newest?q=JavaScript+OR+TypeScript+OR+React+OR+npm+OR+%22Node.js%22',
  },
  {
    name: 'HN AI for builders',
    rssUrl:
      'https://hnrss.org/newest?q=LLM+OR+Copilot+OR+Claude+OR+%22AI+coding%22+OR+RAG+OR+%22AI+agent%22',
  },
  {
    name: 'HN Security bugs',
    rssUrl:
      'https://hnrss.org/newest?q=CVE+OR+vulnerability+OR+RCE+OR+%22supply+chain%22+OR+exploit',
  },
  {
    name: 'HN Frontpage',
    rssUrl: 'https://hnrss.org/frontpage',
  },
  {
    name: 'Dev.to JavaScript',
    rssUrl: 'https://dev.to/feed/tag/javascript',
  },
  {
    name: 'Dev.to TypeScript',
    rssUrl: 'https://dev.to/feed/tag/typescript',
  },
  {
    name: 'Dev.to AI',
    rssUrl: 'https://dev.to/feed/tag/ai',
  },
  {
    name: 'Dev.to Security',
    rssUrl: 'https://dev.to/feed/tag/security',
  },
  {
    name: 'JavaScript Weekly',
    rssUrl: 'https://javascriptweekly.com/rss',
  },
  {
    name: 'Node Weekly',
    rssUrl: 'https://nodeweekly.com/rss',
  },
  {
    name: 'CSS-Tricks',
    rssUrl: 'https://css-tricks.com/feed/',
  },
  {
    name: 'GitHub Blog',
    rssUrl: 'https://github.blog/feed/',
  },
  {
    name: 'The Hacker News',
    rssUrl: 'https://feeds.feedburner.com/TheHackersNews',
  },
  {
    name: 'Snyk Blog',
    rssUrl: 'https://snyk.io/blog/feed/',
  },
  {
    name: 'Cloudflare Blog',
    rssUrl: 'https://blog.cloudflare.com/rss/',
  },
];

const DEACTIVATE_URLS = [
  'https://www.theverge.com/rss/index.xml',
  'https://www.wired.com/feed/rss',
  'https://changelog.com/feed',
  'https://feed.infoq.com/',
  'https://thenewstack.io/feed/',
  'https://techcrunch.com/feed/',
  'https://www.smashingmagazine.com/feed/',
  'https://dev.to/feed',
  'https://hnrss.org/best',
];


function parseVoiceSamples(markdown: string): { title: string; body: string }[] {
  const blocks = markdown.split(/\r?\n---\r?\n/).slice(1);
  const samples: { title: string; body: string }[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const heading = lines.find((l) => l.startsWith('## '));
    if (!heading) continue;
    const title = heading
      .replace(/^##\s+/, '')
      .replace(/^Sample\s+\d+\s+[—-]\s+/i, '')
      .trim();
    const bodyStart = lines.findIndex((l) => l.startsWith('## '));
    const bodyLines = lines.slice(bodyStart + 1);
    const body = bodyLines.join('\n').trim();
    if (body.length < 20) continue;
    samples.push({ title, body });
  }

  return samples;
}

async function main() {
  const email = process.env.SEED_EMAIL ?? 'you@example.com';
  const password = process.env.SEED_PASSWORD ?? 'changeme';
  const replaceVoice = process.env.SEED_REPLACE_VOICE !== '0';

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      settings: {
        create: {
          timezone: 'Asia/Kolkata',
          cronEnabled: true,
        },
      },
    },
  });

  for (const source of DEFAULT_SOURCES) {
    const existing = await prisma.newsSource.findFirst({
      where: { rssUrl: source.rssUrl },
    });
    if (!existing) {
      await prisma.newsSource.create({ data: source });
    } else if (!existing.isActive) {
      await prisma.newsSource.update({
        where: { id: existing.id },
        data: { isActive: true, name: source.name },
      });
    }
  }

  for (const rssUrl of DEACTIVATE_URLS) {
    await prisma.newsSource.updateMany({
      where: { rssUrl },
      data: { isActive: false },
    });
  }

  const samplesPath = path.resolve(__dirname, '../../../prompts/voice-samples.md');
  if (!fs.existsSync(samplesPath)) {
    console.warn(`Voice samples file not found at ${samplesPath}`);
  } else {
    const md = fs.readFileSync(samplesPath, 'utf8');
    const samples = parseVoiceSamples(md);

    if (replaceVoice) {
      const deleted = await prisma.voiceSample.deleteMany({});
      console.log(`Deleted ${deleted.count} existing voice samples`);
    }

    const count = await prisma.voiceSample.count();
    if (count === 0) {
      let order = 0;
      for (const sample of samples) {
        await prisma.voiceSample.create({
          data: {
            title: sample.title,
            body: sample.body,
            source: 'seed',
            isActive: true,
            sortOrder: order++,
          },
        });
      }
      console.log(`Seeded ${samples.length} voice samples from prompts/voice-samples.md`);
    } else {
      console.log(`Voice samples already present (${count}), skipping (set SEED_REPLACE_VOICE=1 to replace)`);
    }
  }

  console.log(`Seeded user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
