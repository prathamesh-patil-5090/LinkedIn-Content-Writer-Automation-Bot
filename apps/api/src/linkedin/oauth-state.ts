import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

type Payload = { u: string; e: number; n: string };

function secret() {
  return process.env.SESSION_SECRET || 'dev-only-change-me';
}

/** Self-contained OAuth state — survives LinkedIn redirect without a session cookie. */
export function createLinkedInOauthState(userId: string): string {
  const payload: Payload = {
    u: userId,
    e: Date.now() + 15 * 60 * 1000,
    n: randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyLinkedInOauthState(state: string): string | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as Payload;
    if (!payload?.u || typeof payload.e !== 'number') return null;
    if (payload.e < Date.now()) return null;
    return payload.u;
  } catch {
    return null;
  }
}
