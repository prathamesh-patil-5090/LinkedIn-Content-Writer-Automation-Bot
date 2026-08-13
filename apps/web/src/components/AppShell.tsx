'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/voice', label: 'Voice' },
  { href: '/runs', label: 'Runs' },
  { href: '/settings', label: 'Settings' },
];

export function AppShell({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  return (
    <main className="shell">
      <header className="shell-header">
        <div>
          <p className="brand-kicker">{kicker || 'LinkedIn Daily Poster'}</p>
          <h1 className="brand-title">{title}</h1>
        </div>
        <nav className="nav">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? 'active' : undefined}
            >
              {l.label}
            </Link>
          ))}
          <button type="button" className="ghost" onClick={() => void logout()}>
            Log out
          </button>
        </nav>
      </header>
      {children}
    </main>
  );
}
