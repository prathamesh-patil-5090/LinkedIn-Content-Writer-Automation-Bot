'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, isUnauthorized } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { LinkedInFormatToolbar } from '@/components/LinkedInFormatToolbar';
import {
  CONTENT_TYPE_LABELS,
  normalizeBucket,
  type ContentType,
} from '@ldp/shared';

type Me = { id: string; email: string; linkedinConnected: boolean };
type Story = {
  title: string;
  link: string;
  why_it_matters?: string;
  angle?: string;
  trend_score?: number;
  suggested?: boolean;
};
type TodayResponse = {
  run: {
    id: string;
    status: string;
    createdAt: string;
    winnerJson?: {
      winner?: { title?: string; link?: string };
      title?: string;
      link?: string;
      intelligence?: {
        pillar?: string;
        contentScore?: number;
        selectedAngle?: string;
        selectedHook?: string;
      };
    } | null;
    errorMessage?: string | null;
  } | null;
  draft: {
    id: string;
    hook?: string | null;
    postText?: string | null;
    tweetText?: string | null;
    imageUrl?: string | null;
    chosenStyle?: string | null;
    sourceTitle?: string | null;
    sourceLink?: string | null;
    hashtags?: string[];
    status: string;
    version?: number;
  } | null;
  meta?: {
    pillar?: string | null;
    format?: string | null;
    contentScore?: number | null;
    qualityScore?: number | null;
    authenticityScore?: number | null;
    aiGenericnessScore?: number | null;
    decision?: string | null;
    decisionReasons?: string[];
    selectedAngle?: string | null;
    selectedHook?: string | null;
    regenerationCount?: number;
  } | null;
  contentConfig?: { autonomousPublish?: boolean } | null;
};

const GENERATING = new Set([
  'collecting',
  'researching',
  'ranking',
  'writing',
  'imaging',
  'regenerating',
  'publishing',
]);

export default function TodayPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<TodayResponse | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [selected, setSelected] = useState<Story | null>(null);
  const [text, setText] = useState('');
  const [tweet, setTweet] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const imageWaitStarted = useRef<number | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadToday = useCallback(async () => {
    const today = await apiFetch<TodayResponse>('/runs/today');
    setData(today);
    if (today.draft?.status === 'pending' || today.draft?.status === 'auto_approved') {
      setText(today.draft.postText || '');
      setTweet(today.draft.tweetText || '');
    } else if (!today.draft) {
      setText('');
      setTweet('');
    } else {
      setTweet(today.draft.tweetText || '');
    }
    return today;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await apiFetch<Me>('/me');
        if (cancelled) return;
        setMe(user);
        await loadToday();
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) router.replace('/login');
        else setError(err instanceof Error ? err.message : 'Could not load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadToday]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const status = data?.run?.status;
    const waitingForImage =
      (status === 'pending_approval' || status === 'auto_approved') &&
      Boolean(data?.draft?.postText) &&
      !data?.draft?.imageUrl;
    if (waitingForImage && !imageWaitStarted.current) {
      imageWaitStarted.current = Date.now();
    }
    if (!waitingForImage) imageWaitStarted.current = null;
    const imageWaitTimedOut =
      imageWaitStarted.current != null &&
      Date.now() - imageWaitStarted.current > 120_000;
    if (
      !status ||
      (!GENERATING.has(status) && (!waitingForImage || imageWaitTimedOut))
    ) {
      return;
    }
    pollRef.current = setInterval(() => {
      void loadToday().catch(() => undefined);
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.run?.status, data?.draft?.postText, data?.draft?.imageUrl, loadToday]);

  async function loadStories() {
    setBusy('stories');
    setError(null);
    try {
      const res = await apiFetch<{
        stories: Story[];
        suggested: Story | null;
      }>('/news/candidates', { method: 'POST' });
      setStories(res.stories);
      const pick =
        res.stories.find((s) => s.suggested) ||
        res.suggested ||
        res.stories[0] ||
        null;
      setSelected(pick);
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function generate(fromSelection: boolean) {
    setBusy('generate');
    setError(null);
    try {
      await apiFetch('/runs', {
        method: 'POST',
        body: JSON.stringify(
          fromSelection && selected ? { story: selected } : {},
        ),
      });
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdits() {
    if (!data?.run?.id) return;
    setBusy('save');
    setError(null);
    try {
      await apiFetch(`/runs/${data.run.id}/draft`, {
        method: 'PATCH',
        body: JSON.stringify({ postText: text, tweetText: tweet || undefined }),
      });
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendTweetTelegram(regenerate = false) {
    if (!data?.run?.id) return;
    setBusy(regenerate ? 'tweet-regen' : 'tweet');
    setError(null);
    try {
      if (tweet && tweet !== data.draft?.tweetText && !regenerate) {
        await apiFetch(`/runs/${data.run.id}/draft`, {
          method: 'PATCH',
          body: JSON.stringify({ tweetText: tweet }),
        });
      }
      const res = await apiFetch<{ ok: boolean; tweet: string }>(
        `/runs/${data.run.id}/telegram-tweet`,
        {
          method: 'POST',
          body: JSON.stringify({ regenerate }),
        },
      );
      if (res.tweet) setTweet(res.tweet);
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!data?.run?.id) return;
    if (!me?.linkedinConnected) {
      setError('Connect LinkedIn in Settings before approving.');
      return;
    }
    setBusy('approve');
    setError(null);
    try {
      if (
        text !== data.draft?.postText ||
        tweet !== (data.draft?.tweetText || '')
      ) {
        await apiFetch(`/runs/${data.run.id}/draft`, {
          method: 'PATCH',
          body: JSON.stringify({
            postText: text,
            tweetText: tweet || undefined,
          }),
        });
      }
      await apiFetch(`/runs/${data.run.id}/approve`, { method: 'POST' });
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
      await loadToday().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!data?.run?.id) return;
    setBusy('reject');
    setError(null);
    try {
      await apiFetch(`/runs/${data.run.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ feedback: feedback || undefined }),
      });
      setFeedback('');
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function skip() {
    if (!data?.run?.id) return;
    setBusy('skip');
    setError(null);
    try {
      await apiFetch(`/runs/${data.run.id}/skip`, { method: 'POST' });
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  async function stopPipeline() {
    if (!data?.run?.id) return;
    setBusy('stop');
    setError(null);
    try {
      await apiFetch(`/runs/${data.run.id}/cancel`, { method: 'POST' });
      await loadToday();
    } catch (err) {
      setError(parseErr(err));
      await loadToday().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  async function saveVoice() {
    if (!data?.run?.id) return;
    setBusy('voice');
    setError(null);
    try {
      await apiFetch(`/runs/${data.run.id}/save-voice`, { method: 'POST' });
      alert('Saved to voice bank.');
    } catch (err) {
      setError(parseErr(err));
    } finally {
      setBusy(null);
    }
  }

  if (!me) {
    return (
      <div className="app">
        <main className="main muted">Loading…</main>
      </div>
    );
  }

  const status = data?.run?.status ?? 'no_run';
  const generating = GENERATING.has(status);
  const autonomous = data?.contentConfig?.autonomousPublish !== false;
  const pending =
    data?.draft?.status === 'pending' && status === 'pending_approval';
  const showApprove = pending && !autonomous;
  // Allow a new Generate whenever the pipeline is idle (supersedes pending drafts).
  const canGenerate = !generating;
  const winnerTitle =
    data?.run?.winnerJson?.winner?.title || data?.run?.winnerJson?.title;
  const meta = data?.meta;
  const intel = data?.run?.winnerJson?.intelligence;

  return (
    <AppShell
      title="Today"
      email={me.email}
      kicker={
        me.linkedinConnected
          ? data?.contentConfig?.autonomousPublish !== false
            ? 'Autonomous mode: score → QC → publish. Dashboard is observability.'
            : 'Kill-switch on: Approve required before publish.'
          : 'LinkedIn is not connected — connect it in Settings.'
      }
    >
      <div className="workspace">
        <div className="workspace-col">
          <section className="card stack status-card">
            <div className="btn-row" style={{ alignItems: 'center' }}>
              <span
                className={`pill ${
                  status === 'failed' || status === 'rejected'
                    ? 'bad'
                    : status === 'published' || status === 'auto_approved'
                      ? 'ok'
                      : generating
                        ? 'warn'
                        : ''
                }`}
              >
                {status.replaceAll('_', ' ')}
              </span>
              {data?.draft?.version ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  v{data.draft.version}
                  {data.draft.chosenStyle ? ` · ${data.draft.chosenStyle}` : ''}
                </span>
              ) : null}
            </div>
            {(meta || intel) && (
              <div className="stack" style={{ gap: 6, fontSize: 13 }}>
                {(meta?.pillar || intel?.pillar) && (
                  <div>
                    Pillar:{' '}
                    <strong>{meta?.pillar || intel?.pillar}</strong>
                    {meta?.format ? ` · ${meta.format}` : ''}
                  </div>
                )}
                <div className="btn-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {meta?.contentScore != null || intel?.contentScore != null ? (
                    <span className="pill">
                      content {meta?.contentScore ?? intel?.contentScore}
                    </span>
                  ) : null}
                  {meta?.qualityScore != null ? (
                    <span className="pill">quality {meta.qualityScore}</span>
                  ) : null}
                  {meta?.authenticityScore != null ? (
                    <span className="pill">
                      authenticity {meta.authenticityScore}
                    </span>
                  ) : null}
                  {meta?.aiGenericnessScore != null ? (
                    <span className="pill">
                      ai-generic {meta.aiGenericnessScore}
                    </span>
                  ) : null}
                  {meta?.regenerationCount != null &&
                  meta.regenerationCount > 0 ? (
                    <span className="pill">
                      regen ×{meta.regenerationCount}
                    </span>
                  ) : null}
                </div>
                {meta?.decisionReasons?.length ? (
                  <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {meta.decisionReasons.slice(0, 6).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                {(meta?.selectedAngle || intel?.selectedAngle) && (
                  <p className="muted" style={{ margin: 0 }}>
                    Angle: {meta?.selectedAngle || intel?.selectedAngle}
                  </p>
                )}
              </div>
            )}
            {generating ? (
              <p className="muted" style={{ margin: 0 }}>
                Pipeline running… updates every few seconds.
              </p>
            ) : null}
            {data?.run?.errorMessage ? (
              <p className="error-text">{data.run.errorMessage}</p>
            ) : null}
          </section>

          {canGenerate ? (
            <section className="card stack news-card">
              <div>
                <h2>News</h2>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  JS/TS libraries, AI devtools, and security bugs.
                </p>
              </div>
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void loadStories()}
                >
                  {busy === 'stories' ? 'Finding…' : 'Suggest'}
                </button>
                <button
                  className="btn primary"
                  disabled={busy !== null || !selected}
                  onClick={() => void generate(true)}
                >
                  {busy === 'generate' ? 'Starting…' : 'Generate selected'}
                </button>
                <button
                  className="btn ghost"
                  disabled={busy !== null}
                  onClick={() => void generate(false)}
                >
                  Auto-pick
                </button>
              </div>
              {stories.length ? (
                <div className="story-list">
                  {stories.map((s) => {
                    const isSelected = selected
                      ? selected.link && s.link
                        ? selected.link === s.link
                        : selected.title === s.title
                      : false;
                    return (
                      <label
                        key={`${s.link}-${s.title}`}
                        className={`story-card ${isSelected ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="story"
                          checked={isSelected}
                          onChange={() => setSelected(s)}
                        />
                        <div>
                          <strong>{s.title}</strong>
                          <div className="story-meta">
                            {s.why_it_matters || s.angle || s.link}
                          </div>
                          <div className="story-tags">
                            {s.angle ? (
                              <span className={`type-pill type-${normalizeBucket(s.angle)}`}>
                                {CONTENT_TYPE_LABELS[normalizeBucket(s.angle) as ContentType] ||
                                  s.angle}
                              </span>
                            ) : null}
                            {s.suggested ? (
                              <span className="badge-suggest">Suggested</span>
                            ) : null}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="muted story-empty">
                  Load suggestions, or auto-pick a story.
                </p>
              )}
            </section>
          ) : null}
        </div>

        <section className="card stack draft-card">
          <h2>Draft</h2>
          <div className="draft-body">
          {!data?.run ? (
            <p className="muted" style={{ margin: 0 }}>
              Choose a story, then generate a post in your voice.
            </p>
          ) : (
            <>
              {winnerTitle ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {winnerTitle}
                </p>
              ) : null}
              {/* Hook is already the first line of post_text — don't render it twice. */}
              {!data.draft?.postText && data.draft?.hook ? (
                <p className="hook">{data.draft.hook}</p>
              ) : null}
              {data.draft?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="draft-image"
                  src={data.draft.imageUrl}
                  alt="Draft visual"
                />
              ) : data.draft?.postText &&
                (generating ||
                  status === 'pending_approval' ||
                  status === 'imaging') ? (
                <p className="muted" style={{ margin: 0 }}>
                  {status === 'imaging' || generating
                    ? 'Generating image…'
                    : 'No image yet.'}
                </p>
              ) : null}
              {data.draft?.postText || pending ? (
                <label className="field draft-text">
                  <span>Post text — **bold** and *italic* convert on publish</span>
                  {pending ? (
                    <LinkedInFormatToolbar
                      value={text}
                      onChange={setText}
                      textareaRef={textAreaRef}
                      disabled={busy !== null}
                    />
                  ) : null}
                  <textarea
                    ref={textAreaRef}
                    value={pending ? text : data.draft?.postText || ''}
                    onChange={(e) => setText(e.target.value)}
                    readOnly={!pending}
                    rows={12}
                  />
                </label>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  No draft text yet for this run.
                </p>
              )}
              {data.draft?.postText || tweet ? (
                <label className="field draft-text">
                  <span>
                    X / Twitter ({(pending ? tweet : data.draft?.tweetText || '').length}
                    /280)
                  </span>
                  <textarea
                    value={pending ? tweet : data.draft?.tweetText || ''}
                    onChange={(e) => setTweet(e.target.value)}
                    readOnly={!pending}
                    rows={4}
                    placeholder="Shorter version for X — also sent to Telegram when the draft is ready"
                  />
                </label>
              ) : null}
              {data.draft?.sourceTitle ? (
                <p style={{ margin: 0, fontSize: 13 }}>
                  {data.draft.sourceLink ? (
                    <a
                      href={data.draft.sourceLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--accent-2)' }}
                    >
                      {data.draft.sourceTitle}
                    </a>
                  ) : (
                    data.draft.sourceTitle
                  )}
                </p>
              ) : null}
              {pending ? (
                <label className="field">
                  <span>Reject feedback</span>
                  <input
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Shorter, more personal, different angle…"
                  />
                </label>
              ) : null}
            </>
          )}
          {error ? <p className="error-text">{error}</p> : null}
          </div>

          <div className="btn-row draft-actions">
            {generating ? (
              <button
                className="btn danger"
                disabled={busy !== null}
                onClick={() => void stopPipeline()}
              >
                {busy === 'stop' ? 'Stopping…' : 'Stop'}
              </button>
            ) : null}
            {showApprove ? (
              <>
                <button
                  className="btn"
                  disabled={!pending || busy !== null}
                  onClick={() => void saveEdits()}
                >
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="btn primary"
                  disabled={!pending || busy !== null}
                  onClick={() => void approve()}
                >
                  {busy === 'approve' ? 'Publishing…' : 'Approve'}
                </button>
                <button
                  className="btn"
                  disabled={!pending || busy !== null}
                  onClick={() => void reject()}
                >
                  {busy === 'reject' ? 'Regenerating…' : 'Reject'}
                </button>
              </>
            ) : null}
            <button
              className="btn ghost"
              disabled={
                busy !== null ||
                !data?.run ||
                !['pending_approval', 'auto_approved', 'writing', 'imaging'].includes(
                  status,
                )
              }
              onClick={() => void skip()}
            >
              Skip
            </button>
            <button
              className="btn ghost"
              disabled={
                busy !== null ||
                !data?.draft?.postText ||
                !['published', 'pending_approval', 'auto_approved'].includes(status)
              }
              onClick={() => void saveVoice()}
            >
              Save voice
            </button>
            <button
              className="btn ghost"
              disabled={busy !== null || !data?.draft?.postText || !data?.run}
              onClick={() => void sendTweetTelegram(false)}
              title="Send the ≤280 tweet version to Telegram"
            >
              {busy === 'tweet' ? 'Sending…' : 'Tweet → Telegram'}
            </button>
            <button
              className="btn ghost"
              disabled={busy !== null || !data?.draft?.postText || !data?.run}
              onClick={() => void sendTweetTelegram(true)}
              title="Rewrite tweet and send to Telegram"
            >
              {busy === 'tweet-regen' ? 'Rewriting…' : 'Regen tweet'}
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function parseErr(err: unknown) {
  if (!(err instanceof Error)) return 'Request failed';
  try {
    const j = JSON.parse(err.message) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(', ');
    if (j.message) return j.message;
  } catch {
    /* plain */
  }
  return err.message.slice(0, 400);
}
