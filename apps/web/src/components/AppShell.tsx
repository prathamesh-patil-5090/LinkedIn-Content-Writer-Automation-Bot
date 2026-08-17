'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

const LINKS = [
  { href: '/', label: 'Today', icon: TodayIcon },
  { href: '/voice', label: 'Voice', icon: VoiceIcon },
  { href: '/runs', label: 'Runs', icon: RunsIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#5E6AD2" />
      <path
        d="M9 21.5 16 8.5 23 21.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M12.2 16.8h7.6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({
  title,
  kicker,
  children,
  email,
}: {
  title: string;
  kicker?: string;
  email?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <strong>Daily Poster</strong>
            <span>LinkedIn studio</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? 'active' : undefined}
            >
              <l.icon />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="sidebar-logout" onClick={() => void logout()}>
            <LogoutIcon />
            Log out
          </button>
          {email ? (
            <div className="sidebar-user">
              <span className="sidebar-avatar" aria-hidden>
                {email.slice(0, 1).toUpperCase()}
              </span>
              <span className="sidebar-email" title={email}>
                {email}
              </span>
            </div>
          ) : null}
        </div>
      </aside>
      <main className="main">
        <header className="page-head">
          <div>
            <h1>{title}</h1>
            {kicker ? <p>{kicker}</p> : null}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function TodayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  );
}
function VoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 10v4M12 7v10M16 10v4" strokeLinecap="round" />
    </svg>
  );
}
function RunsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 7h14M5 12h10M5 17h7" strokeLinecap="round" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h10M12 9l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
