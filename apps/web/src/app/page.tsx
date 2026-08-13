'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

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
    } | null;
    errorMessage?: string | null;
  } | null;
  draft: {
    id: string;
    hook?: string | null;
    postText?: string | null;
    imageUrl?: string | null;
    chosenStyle?: string | null;
    sourceTitle?: string | null;
    sourceLink?: string | null;
    hashtags?: string[];
    status: string;
    version?: number;
  } | null;
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
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadToday = useCallback(async () => {
    const today = await apiFetch<TodayResponse>('/runs/today');
    setData(today);
    if (today.draft?.status === 'pending') {
      setText(today.draft.postText || '');
    } else if (!today.draft) {
      setText('');
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
      } catch {
        if (!cancelled) router.replace('/login');
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
    if (!status || !GENERATING.has(status)) return;
    pollRef.current = setInterval(() => {
      void loadToday().catch(() => undefined);
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [data?.run?.status, loadToday]);

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
        body: JSON.stringify({ postText: text }),
      });
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
      if (text !== data.draft?.postText) {
        await apiFetch(`/runs/${data.run.id}/draft`, {
          method: 'PATCH',
          body: JSON.stringify({ postText: text }),
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
    return <main className="shell muted">Loading…</main>;
  }

  const status = data?.run?.status ?? 'no_run';
  const generating = GENERATING.has(status);
  const pending =
    data?.draft?.status === 'pending' && status === 'pending_approval';
  const canGenerate =
    !generating &&
    (!data?.run ||
      ['published', 'skipped', 'failed'].includes(status) ||
      status === 'no_run');
  const winnerTitle =
    data?.run?.winnerJson?.winner?.title || data?.run?.winnerJson?.title;

  return (
    <AppShell
      title="Today"
      kicker={
        me.linkedinConnected
          ? me.email
          : `${me.email} · LinkedIn not connected`
      }
    >
      <section className="panel">
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <span
            className={`pill ${status === 'failed' ? 'bad' : status === 'published' ? 'ok' : ''}`}
          >
            {status.replaceAll('_', ' ')}
          </span>
          {data?.draft?.version ? (
            <span className="muted" style={{ fontSize: 13 }}>
              Draft v{data.draft.version}
              {data.draft.chosenStyle ? ` · ${data.draft.chosenStyle}` : ''}
            </span>
          ) : null}
        </div>

        {generating ? (
          <p className="muted" style={{ margin: 0 }}>
            Pipeline running… status updates every few seconds.
          </p>
        ) : null}
        {data?.run?.errorMessage ? (
          <p className="error-text">{data.run.errorMessage}</p>
        ) : null}
      </section>

      {canGenerate ? (
        <section className="panel">
          <div>
            <h2>Pick developer news</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              Focus: JS/TS libraries, AI tools for developers, and new
              security bugs. We suggest one — pick another anytime.
            </p>
          </div>

          <div className="btn-row">
            <button
              className="btn teal"
              disabled={busy !== null}
              onClick={() => void loadStories()}
            >
              {busy === 'stories' ? 'Finding stories…' : 'Suggest stories'}
            </button>
            <button
              className="btn primary"
              disabled={busy !== null || !selected}
              onClick={() => void generate(true)}
            >
              {busy === 'generate'
                ? 'Starting…'
                : 'Generate from selected'}
            </button>
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => void generate(false)}
            >
              Auto-pick & generate
            </button>
          </div>

          {stories.length ? (
            <div className="story-list">
              {stories.map((s) => {
                const isSelected =
                  selected?.link === s.link || selected?.title === s.title;
                return (
                  <label
                    key={`${s.link}-${s.title}`}
                    className={`story-card ${isSelected ? 'selected' : ''} ${s.suggested ? 'suggested' : ''}`}
                  >
                    <input
                      type="radio"
                      name="story"
                      checked={isSelected}
                      onChange={() => setSelected(s)}
                      style={{ marginTop: 4 }}
                    />
                    <div>
                      <strong>{s.title}</strong>
                      <div className="story-meta">
                        {s.why_it_matters || s.angle || s.link}
                      </div>
                      {s.suggested ? (
                        <span className="badge-suggest">Suggested for you</span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No candidates loaded yet. Hit Suggest stories.
            </p>
          )}
        </section>
      ) : null}

      <section className="panel">
        <h2>Draft</h2>
        {!data?.run ? (
          <p className="muted" style={{ margin: 0 }}>
            Choose a developer story above, then generate a post in your voice.
          </p>
        ) : (
          <>
            {winnerTitle ? (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Winner: {winnerTitle}
              </p>
            ) : null}
            {data.draft?.hook ? (
              <div>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Hook
                </p>
                <p
                  style={{
                    margin: '4px 0 0',
                    fontSize: 22,
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {data.draft.hook}
                </p>
              </div>
            ) : null}
            {data.draft?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="draft-image"
                src={data.draft.imageUrl}
                alt="Draft visual"
              />
            ) : null}
            {data.draft?.postText || pending ? (
              <label className="field">
                <span>Post text</span>
                <textarea
                  value={pending ? text : data.draft?.postText || ''}
                  onChange={(e) => setText(e.target.value)}
                  readOnly={!pending}
                  rows={14}
                  style={{ background: pending ? '#fff' : '#f8fafc' }}
                />
              </label>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No draft text yet for this run.
              </p>
            )}
            {data.draft?.sourceTitle ? (
              <p style={{ margin: 0, fontSize: 14 }}>
                Source:{' '}
                {data.draft.sourceLink ? (
                  <a
                    href={data.draft.sourceLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)', fontWeight: 600 }}
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
                <span>Reject feedback (optional)</span>
                <input
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="e.g. more personal, shorter, different angle"
                />
              </label>
            ) : null}
          </>
        )}

        {error ? <p className="error-text">{error}</p> : null}

        <div className="btn-row">
          {generating ? (
            <button
              className="btn danger"
              disabled={busy !== null}
              onClick={() => void stopPipeline()}
            >
              {busy === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
          ) : null}
          <button
            className="btn"
            disabled={!pending || busy !== null}
            onClick={() => void saveEdits()}
          >
            {busy === 'save' ? 'Saving…' : 'Save edits'}
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
          <button
            className="btn"
            disabled={!pending || busy !== null}
            onClick={() => void skip()}
          >
            Skip
          </button>
          <button
            className="btn"
            disabled={
              busy !== null ||
              !data?.draft?.postText ||
              !['published', 'pending_approval'].includes(status)
            }
            onClick={() => void saveVoice()}
          >
            Save as voice
          </button>
        </div>
      </section>
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
