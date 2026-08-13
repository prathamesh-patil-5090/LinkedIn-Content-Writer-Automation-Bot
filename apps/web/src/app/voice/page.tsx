'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

type VoiceSample = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  source: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ||
  'http://localhost:3001/api/v1';

export default function VoicePage() {
  const router = useRouter();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const list = await apiFetch<VoiceSample[]>('/voice-samples');
    setSamples(list);
  }

  useEffect(() => {
    (async () => {
      try {
        await apiFetch('/me');
        await refresh();
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  async function onImport(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/voice-samples/import`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `Import failed (${res.status})`);
      const json = JSON.parse(text) as { imported: number };
      setMsg(`Imported ${json.imported} samples.`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message.slice(0, 300) : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, isActive: boolean) {
    await apiFetch(`/voice-samples/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !isActive }),
    });
    await refresh();
  }

  async function remove(id: string) {
    if (!confirm('Delete this sample?')) return;
    await apiFetch(`/voice-samples/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return (
    <AppShell title="Voice bank" kicker={`${samples.length} samples`}>
      <section className="panel">
        <p className="muted" style={{ margin: 0 }}>
          Import LinkedIn <code>Shares.csv</code> or the data export zip to keep
          your voice sharp.
        </p>
        <label className="field">
          <span>Import CSV / ZIP</span>
          <input
            type="file"
            accept=".csv,.zip,text/csv,application/zip"
            disabled={busy}
            onChange={(e) => void onImport(e.target.files?.[0] || null)}
          />
        </label>
        {msg ? <p style={{ margin: 0, fontSize: 14 }}>{msg}</p> : null}
      </section>

      <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {samples.map((s) => (
          <article key={s.id} className="panel">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <strong>{s.title}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {s.source}
                {s.isActive ? ' · active' : ' · inactive'}
              </span>
            </div>
            <pre
              className="muted"
              style={{
                whiteSpace: 'pre-wrap',
                margin: 0,
                fontFamily: 'inherit',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {s.body.slice(0, 420)}
              {s.body.length > 420 ? '…' : ''}
            </pre>
            <div className="btn-row">
              <button
                className="btn"
                onClick={() => void toggle(s.id, s.isActive)}
              >
                {s.isActive ? 'Deactivate' : 'Activate'}
              </button>
              <button className="btn danger" onClick={() => void remove(s.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </AppShell>
  );
}
