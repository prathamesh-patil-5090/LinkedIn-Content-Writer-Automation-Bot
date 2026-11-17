/* Temporary smoke test: real LLM, no database, nothing published. */
import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../src/llm/llm.service';
import { AgentsService } from '../src/agents/agents.service';
import { AngleHookService } from '../src/content/angle-hook.service';
import { QualityGateService } from '../src/content/quality-gate.service';
import { ContentConfigService } from '../src/content/content-config.service';
import { fetchArticleExcerpt } from '../src/news/article-context';
import { polishDraft } from '../src/linkedin/polish';
import { checkPost } from '../src/content/post-rules';
import { topicPillar } from '../src/content/topic-authority';

const STORIES = [
  {
    title: 'Node.js 22 is now available',
    link: 'https://nodejs.org/en/blog/announcements/v22-release-announce',
    why_it_matters:
      'require() for ES modules, a built-in WebSocket client and a watch mode land in one release.',
    angle: 'js-lib',
  },
  {
    title: 'Building effective agents',
    link: 'https://www.anthropic.com/engineering/building-effective-agents',
    why_it_matters:
      'Anthropic separates workflows from agents and argues for the simplest composable pattern that works.',
    angle: 'ai-devtools',
  },
];

async function main() {
  const config = new ConfigService({ ...process.env });
  const llm = new LlmService(config);
  const agents = new AgentsService(llm, config);
  const angleHook = new AngleHookService(llm);
  const contentConfig = new ContentConfigService(config);
  const gate = new QualityGateService(llm, contentConfig);
  const max = contentConfig.maxRegenerationAttempts();
  const only = process.argv[2] ? Number(process.argv[2]) : undefined;

  for (const [i, winner] of STORIES.entries()) {
    if (only != null && only !== i) continue;
    console.log(`\n======== ${winner.title} ========`);
    console.log('pillar:', topicPillar(winner.title, winner.why_it_matters));
    const excerpt = await fetchArticleExcerpt(winner.link);
    console.log('excerpt chars:', excerpt?.length || 0);

    const angles = await angleHook.generateAngles({
      title: winner.title,
      why: winner.why_it_matters,
      pillar: 'engineering',
    });
    const hooks = await angleHook.generateHooks({
      title: winner.title,
      angle: angles.selected.angle,
      pillar: 'engineering',
    });
    console.log('angle:', angles.selected.format, '|', angles.selected.angle);
    console.log('hook :', hooks.selected.text);

    let feedback: string | undefined;
    for (let regen = 0; regen <= max; regen++) {
      const drafts = await agents.writeDrafts(
        { ...winner, angle: angles.selected.angle },
        { hooks: [] },
        winner.angle as never,
        excerpt,
      );
      const voice = await agents.applyVoice({
        drafts: drafts.data,
        winner,
        voiceSamples: [],
        articleExcerpt: excerpt,
        feedback: [
          feedback,
          `Writing brief (do NOT paste these labels into the post):\n- Angle to follow: ${angles.selected.angle}\n- Preferred hook energy (rewrite in your words, do not paste verbatim): ${hooks.selected.text}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      const polished = polishDraft({
        postText: voice.data.post_text,
        hook: voice.data.hook,
        hashtags: voice.data.hashtags,
        category: winner.angle,
        sourceLink: winner.link,
        sourceTitle: winner.title,
      });
      const check = checkPost(polished);
      const qc = await gate.evaluate({
        postText: polished.postText,
        hook: polished.hook,
        sourceTitle: winner.title,
        pillar: 'engineering',
        regenerationCount: regen,
      });
      console.log(
        `\n--- attempt ${regen + 1}: ${qc.decision} | words ${check.words} bullets ${check.bullets} question ${check.question} | quality ${qc.qualityScore} auth ${qc.authenticityScore} ai-generic ${qc.aiGenericnessScore}`,
      );
      console.log('reasons:', qc.reasons);
      console.log(polished.postText);
      if (qc.decision !== 'regenerate') break;
      feedback = [
        feedback,
        qc.feedback,
        `QC failed: ${qc.reasons.join('; ')}. Fix each of these in the rewrite.`,
      ]
        .filter(Boolean)
        .join('\n');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
