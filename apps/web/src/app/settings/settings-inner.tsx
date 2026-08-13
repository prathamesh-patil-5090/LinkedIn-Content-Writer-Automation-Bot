'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/AppShell';

type Me = { linkedinConnected: boolean };
type Settings = {
  timezone: string;
  cronEnabled: boolean;
  telegramEnabled: boolean;
  telegramChatId?: string | null;
  integrations?: {
    telegram: { ready: boolean; envTokenSet: boolean; envChatIdSet: boolean };
    storage: { driver: string; ready: boolean; hint?: string };
  };
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ||
  'http://localhost:3001/api/v1';

export default function SettingsInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tgMsg, setTgMsg] = useState<string | null>(null);
  const [stMsg, setStMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'tg' | 'st' | 'li' | 'cron' | null>(null);
  const liFlash = search.get('linkedin');

  useEffect(() => {
    (async () => {
      try {
        const user = await apiFetch<Me>('/me');
        setMe(user);
        const s = await apiFetch<Settings>('/settings');
        setSettings(s);
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  async function testTelegram() {
    setBusy('tg');
    setTgMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>(
        '/settings/test-telegram',
        { method: 'POST' },
      );
      setTgMsg(res.ok ? 'Sent. Check Telegram.' : res.error || 'Failed');
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function testStorage() {
    setBusy('st');
    setStMsg(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        driver: string;
        url?: string;
        error?: string;
      }>('/settings/test-storage', { method: 'POST' });
      setStMsg(
        res.ok
          ? `OK (${res.driver})${res.url ? ` — ${res.url}` : ''}`
          : res.error || 'Failed',
      );
    } catch (err) {
      setStMsg(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggleCron() {
    if (!settings) return;
    setBusy('cron');
    try {
      const next = await apiFetch<Settings>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ cronEnabled: !settings.cronEnabled }),
      });
      setSettings({ ...settings, cronEnabled: next.cronEnabled });
    } finally {
      setBusy(null);
    }
  }

  async function disconnectLinkedIn() {
    setBusy('li');
    try {
      await apiFetch('/linkedin/connection', { method: 'DELETE' });
      setMe({ linkedinConnected: false });
    } finally {
      setBusy(null);
    }
  }

  const tg = settings?.integrations?.telegram;
  const storage = settings?.integrations?.storage;

  if (!settings || !me) {
    return <main className="shell muted">Loading…</main>;
  }

  return (
    <AppShell title="Settings" kicker="Integrations & schedule">
      {liFlash === 'connected' ? (
        <p className="pill ok" style={{ marginBottom: 12 }}>
          LinkedIn connected
        </p>
      ) : null}
      {liFlash === 'error' || liFlash === 'state' ? (
        <p className="error-text" style={{ marginBottom: 12 }}>
          LinkedIn connect failed. Try again.
        </p>
      ) : null}

      <section className="panel">
        <h2>Schedule</h2>
        <p style={{ margin: 0 }}>
          Timezone: <strong>{settings.timezone}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Cron (07:00 IST):{' '}
          <strong>{settings.cronEnabled ? 'on' : 'off'}</strong>
        </p>
        <button
          className="btn"
          onClick={() => void toggleCron()}
          disabled={busy === 'cron'}
        >
          {settings.cronEnabled ? 'Disable cron' : 'Enable cron'}
        </button>
      </section>

      <section className="panel">
        <h2>LinkedIn</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {me.linkedinConnected
            ? 'Connected — Approve will publish to your profile.'
            : 'Not connected. OAuth needs w_member_social.'}
        </p>
        {me.linkedinConnected ? (
          <button
            className="btn danger"
            onClick={() => void disconnectLinkedIn()}
            disabled={busy === 'li'}
          >
            Disconnect
          </button>
        ) : (
          <a className="btn primary" href={`${API_BASE}/linkedin/oauth/start`}>
            Connect LinkedIn
          </a>
        )}
      </section>

      <section className="panel">
        <h2>Telegram</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Token in .env: {tg?.envTokenSet ? 'yes' : 'no'} · Chat ID in .env:{' '}
          {tg?.envChatIdSet ? 'yes' : 'no'}
        </p>
        <button
          className="btn"
          onClick={() => void testTelegram()}
          disabled={busy === 'tg' || !tg?.ready}
        >
          {busy === 'tg' ? 'Sending…' : 'Send test ping'}
        </button>
        {tgMsg ? <p style={{ margin: 0, fontSize: 14 }}>{tgMsg}</p> : null}
      </section>

      <section className="panel">
        <h2>Storage</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Driver: {storage?.driver}
          {storage?.ready
            ? ' · ready'
            : ` · not ready${storage?.hint ? ` (${storage.hint})` : ''}`}
        </p>
        <button
          className="btn"
          onClick={() => void testStorage()}
          disabled={busy === 'st'}
        >
          {busy === 'st' ? 'Checking…' : 'Test upload'}
        </button>
        {stMsg ? (
          <p style={{ margin: 0, fontSize: 14, wordBreak: 'break-all' }}>
            {stMsg}
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}
