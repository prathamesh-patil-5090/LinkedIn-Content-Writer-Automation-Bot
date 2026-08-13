'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
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

  useEffect(() => {
    (async () => {
      try {
        await apiFetch('/me');
        const res = await apiFetch<RunDetail>(`/runs/${id}`);
        setRun(res);
      } catch {
        router.replace('/login');
      }
    })();
  }, [id, router]);

  if (!run) {
    return <main className="shell muted">Loading…</main>;
  }

  return (
    <AppShell title={`Run ${run.id.slice(0, 8)}`} kicker={run.status}>
      <section className="panel">
        <p className="muted" style={{ margin: 0 }}>
          {new Date(run.createdAt).toLocaleString()}
          {run.storyCount != null ? ` · ${run.storyCount} stories` : ''}
        </p>
        {run.errorMessage ? (
          <p className="error-text">{run.errorMessage}</p>
        ) : null}
        {run.winnerJson?.winner?.title ? (
          <p style={{ margin: 0 }}>
            Winner:{' '}
            {run.winnerJson.winner.link ? (
              <a
                href={run.winnerJson.winner.link}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', fontWeight: 600 }}
              >
                {run.winnerJson.winner.title}
              </a>
            ) : (
              run.winnerJson.winner.title
            )}
          </p>
        ) : null}
        {run.linkedinPostUrn ? (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            LinkedIn URN: {run.linkedinPostUrn}
          </p>
        ) : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Drafts</h2>
        {run.drafts.map((d) => (
          <article key={d.id} style={{ display: 'grid', gap: 8 }}>
            <strong>
              v{d.version} · {d.status}
            </strong>
            {d.hook ? <p style={{ margin: 0 }}>{d.hook}</p> : null}
            {d.postText ? (
              <pre
                className="muted"
                style={{
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  margin: 0,
                }}
              >
                {d.postText}
              </pre>
            ) : null}
          </article>
        ))}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Pipeline logs</h2>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {run.logs.map((l) => (
            <li key={l.id} style={{ marginBottom: 8, fontSize: 14 }}>
              <strong>{l.step}</strong>
              {l.latencyMs != null ? ` · ${l.latencyMs}ms` : ''}
              {l.inputExcerpt ? (
                <div className="muted">{l.inputExcerpt.slice(0, 160)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
