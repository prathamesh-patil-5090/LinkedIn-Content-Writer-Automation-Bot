import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function apiBase() {
  return (
    process.env.API_INTERNAL_URL?.replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ||
    'http://localhost:3001/api/v1'
  );
}

export async function GET() {
  try {
    const res = await fetch(`${apiBase()}/health`, { cache: 'no-store' });
    const body = await res.json();
    return NextResponse.json(
      { ok: body.ok !== false, web: 'up', api: body },
      { status: res.ok && body.ok !== false ? 200 : 503 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        web: 'up',
        api: 'unreachable',
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
