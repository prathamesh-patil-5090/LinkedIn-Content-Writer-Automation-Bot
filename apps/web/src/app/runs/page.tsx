'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, isUnauthorized } from '@/lib/api';
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
  const [email, setEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const me = await apiFetch<{ email: string }>('/me');
        setEmail(me.email);
        const res = await apiFetch<RunsResponse>('/runs');
        setData(res);
      } catch (err) {
        if (isUnauthorized(err)) router.replace('/login');
      }
    })();
  }, [router]);

  return (
    <AppShell
      title="Runs"
      email={email}
      kicker={data ? `${data.total} total` : 'History'}
    >
      {!data?.items.length ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            No runs yet.
          </p>
        </section>
      ) : (
        <div className="list">
          {data.items.map((run) => (
            <Link key={run.id} href={`/runs/${run.id}`} className="row-link">
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <span className="pill">{run.status.replaceAll('_', ' ')}</span>
                <span className="muted" style={{ fontSize: 12 }}>
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
