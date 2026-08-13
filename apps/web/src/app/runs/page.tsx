'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

type RunsResponse = {
  items: Array<{
    id: string;
    status: string;
    createdAt: string;
    drafts: Array<{ hook?: string | null }>;
  }>;
  total: number;
};

export default function RunsPage() {
  const router = useRouter();
  const [data, setData] = useState<RunsResponse | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await apiFetch('/me');
        const res = await apiFetch<RunsResponse>('/runs');
        setData(res);
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  return (
    <AppShell title="Runs" kicker={data ? `${data.total} total` : 'History'}>
      {!data?.items.length ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No runs yet.
          </p>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {data.items.map((run) => (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="panel"
              style={{ textDecoration: 'none' }}
            >
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <span className="pill">{run.status.replaceAll('_', ' ')}</span>
                <span className="muted" style={{ fontSize: 13 }}>
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
              {run.drafts[0]?.hook ? (
                <p style={{ margin: 0, fontWeight: 600 }}>{run.drafts[0].hook}</p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
