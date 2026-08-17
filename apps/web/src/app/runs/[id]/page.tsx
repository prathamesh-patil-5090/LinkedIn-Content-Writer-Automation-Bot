'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, isUnauthorized } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

type RunDetail = {
  id: string;
  status: string;
  createdAt: string;
  errorMessage?: string | null;
  storyCount?: number | null;
  linkedinPostUrn?: string | null;
  winnerJson?: { winner?: { title?: string; link?: string } } | null;
  drafts: Array<{
    id: string;
    version: number;
    status: string;
    hook?: string | null;
    postText?: string | null;
    imageUrl?: string | null;
  }>;
  logs: Array<{
    id: string;
    step: string;
    latencyMs?: number | null;
    createdAt: string;
    inputExcerpt?: string | null;
  }>;
};

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<{ email: string }>('/me');
        setEmail(me.email);
        const res = await apiFetch<RunDetail>(`/runs/${id}`);
        setRun(res);
      } catch (err) {
        if (isUnauthorized(err)) router.replace('/login');
      }
    })();
  }, [id, router]);

  if (!run) {
    return (
      <div className="app">
        <main className="main muted">Loading…</main>
      </div>
    );
  }

  return (
    <AppShell
      title={`Run ${run.id.slice(0, 8)}`}
      email={email}
      kicker={run.status.replaceAll('_', ' ')}
    >
      <section className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          {new Date(run.createdAt).toLocaleString()}
          {run.storyCount != null ? ` · ${run.storyCount} stories` : ''}
        </p>
        {run.errorMessage ? <p className="error-text">{run.errorMessage}</p> : null}
        {run.winnerJson?.winner?.title ? (
          <p style={{ margin: 0 }}>
            {run.winnerJson.winner.link ? (
              <a
                href={run.winnerJson.winner.link}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent-2)' }}
              >
                {run.winnerJson.winner.title}
              </a>
            ) : (
              run.winnerJson.winner.title
            )}
          </p>
        ) : null}
      </section>

      <section className="card stack" style={{ marginTop: 16 }}>
        <h2>Drafts</h2>
        {run.drafts.map((d) => (
          <article key={d.id} className="stack">
            <strong>
              v{d.version} · {d.status}
            </strong>
            {d.hook ? <p className="hook">{d.hook}</p> : null}
            {d.postText ? (
              <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {d.postText}
              </p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="card stack" style={{ marginTop: 16 }}>
        <h2>Logs</h2>
        <div className="list">
          {run.logs.map((l) => (
            <div key={l.id}>
              <strong>{l.step}</strong>
              {l.latencyMs != null ? (
                <span className="muted"> · {l.latencyMs}ms</span>
              ) : null}
              {l.inputExcerpt ? (
                <div className="muted">{l.inputExcerpt.slice(0, 160)}</div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
