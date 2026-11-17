import { toBoldSans } from '../linkedin/format';
import {
  CURATED_HOOK,
  CURATED_POST,
  FABRICATED_HOOK,
  FABRICATED_POST,
} from './post-fixtures-spec';
import {
  POST_WORDS,
  bannedPhraseHits,
  checkPost,
  firstPersonClaims,
  postRulesPrompt,
} from './post-rules';

describe('firstPersonClaims', () => {
  it('catches a "we/our" story about work the poster never did', () => {
    const claims = firstPersonClaims(
      'When we first tried to share a motion-rich widget, our churn exploded. We called it the Core Vanilla Engine.',
    );
    expect(claims.length).toBeGreaterThanOrEqual(3);
    expect(claims.join(' ')).toMatch(/we first tried/i);
    expect(claims.join(' ')).toMatch(/We called it/);
  });

  it('catches singular experience claims', () => {
    expect(firstPersonClaims('I built this last year.')).not.toEqual([]);
    expect(firstPersonClaims("I've been running it in prod.")).not.toEqual([]);
    expect(firstPersonClaims('My team hit the same wall.')).not.toEqual([]);
    expect(firstPersonClaims('It gave us a cleaner API.')).not.toEqual([]);
    expect(firstPersonClaims("We're seeing this everywhere.")).not.toEqual([]);
  });

  it('sees through LinkedIn Unicode bold', () => {
    expect(firstPersonClaims(toBoldSans('We built the engine'))).not.toEqual(
      [],
    );
  });

  it('allows opinions, quotes and words that only look like first person', () => {
    expect(firstPersonClaims("I think this is right. I'd reach for it.")).toEqual(
      [],
    );
    expect(firstPersonClaims('My read: it pays off late.')).toEqual([]);
    expect(
      firstPersonClaims('The author writes "we called it the engine".'),
    ).toEqual([]);
    expect(firstPersonClaims('Hosted in us-east-1 for US users.')).toEqual([]);
    expect(firstPersonClaims('Check your bundle. Focus on the hours saved.')).toEqual(
      [],
    );
  });
});

describe('bannedPhraseHits', () => {
  it('finds the classic LLM giveaways', () => {
    expect(
      bannedPhraseHits(
        "In today's fast-paced world. Here's how we did it. The breakthrough came when it clicked. Takeaway: ship.",
      ),
    ).toEqual(
      expect.arrayContaining([
        "in today's fast-paced",
        "here's how we did it",
        'the breakthrough came when',
        'takeaway:',
      ]),
    );
  });

  it('matches curly apostrophes too', () => {
    expect(bannedPhraseHits('Here\u2019s how we did it')).toEqual([
      "here's how we did it",
    ]);
  });
});

describe('checkPost', () => {
  it('passes a curated breakdown', () => {
    const check = checkPost({ postText: CURATED_POST, hook: CURATED_HOOK });
    expect(check.violations).toEqual([]);
    expect(check.words).toBeGreaterThanOrEqual(POST_WORDS.targetMin);
    expect(check.words).toBeLessThanOrEqual(POST_WORDS.targetMax);
    expect(check.bullets).toBe(4);
    expect(check.question).toBe(true);
  });

  it('ignores hashtags and the source credit', () => {
    const check = checkPost({
      postText: `${CURATED_POST}\n\nSource: "How we built a cross-framework engine" by some_user on DEV\n\n#TypeScript #WebDev`,
      hook: CURATED_HOOK,
    });
    expect(check.violations).toEqual([]);
  });

  it('fails the fabricated first-person rewrite', () => {
    const check = checkPost({
      postText: FABRICATED_POST,
      hook: FABRICATED_HOOK,
    });
    expect(check.violations.join(' | ')).toMatch(/fabricated first-person/);
    expect(check.violations.join(' | ')).toMatch(/banned phrases/);
    expect(check.feedback.join(' ')).toMatch(/third person/);
  });

  it('allows first person when the story is the author\u2019s own work', () => {
    const check = checkPost({
      postText: FABRICATED_POST.replace('The breakthrough came when', 'It clicked when'),
      hook: FABRICATED_HOOK,
      ownWork: true,
    });
    expect(check.claims).toEqual([]);
    expect(check.violations).toEqual([]);
  });

  it('fails links, including bare domains', () => {
    for (const link of [
      'https://dev.to/some_user/engine',
      'github.com/some_user/engine',
    ]) {
      const check = checkPost({
        postText: CURATED_POST.replace('on DEV by some_user', `at ${link}`),
        hook: CURATED_HOOK,
      });
      expect(check.violations).toContain('external link in post body');
    }
  });

  it('fails essays, walls of text and posts with no question', () => {
    const essay = Array.from({ length: 60 }, () => 'Seven more words of filler go here.').join(' ');
    expect(
      checkPost({ postText: `${CURATED_POST}\n\n${essay}` }).violations.join(' '),
    ).toMatch(/length \d+ words/);

    const noBullets = CURATED_POST.replace(/^- /gm, '');
    expect(checkPost({ postText: noBullets }).violations).toContain(
      'no bulleted breakdown',
    );

    const noQuestion = CURATED_POST.replace(/\n\nWhich part.*$/s, '');
    expect(checkPost({ postText: noQuestion }).violations).toContain(
      'no closing question',
    );
  });
});

describe('postRulesPrompt', () => {
  it('bans first person for curated stories only', () => {
    expect(postRulesPrompt()).toMatch(/Never write "we", "our" or "us"/);
    expect(postRulesPrompt(true)).not.toMatch(/Never write "we"/);
  });

  it('carries the format and the negative prompt', () => {
    const prompt = postRulesPrompt();
    expect(prompt).toContain('150-250 words');
    expect(prompt).toContain('No URLs');
    for (const phrase of [
      "here's how we did it",
      'the breakthrough came when',
      'takeaway:',
      "in today's fast-paced",
    ]) {
      expect(prompt).toContain(`"${phrase}"`);
    }
  });
});
