import session from 'express-session';
import { PrismaService } from '../prisma/prisma.module';

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

type SessionRow = { data: string; expires_at: Date };

export class PrismaSessionStore extends session.Store {
  constructor(private readonly prisma: PrismaService) {
    super();
    const timer = setInterval(() => {
      void this.prisma
        .$executeRaw`DELETE FROM sessions WHERE expires_at < NOW()`
        .catch(() => undefined);
    }, 60 * 60 * 1000);
    timer.unref();
  }

  get(
    sid: string,
    callback: (err: unknown, session?: session.SessionData | null) => void,
  ) {
    void this.prisma
      .$queryRaw<SessionRow[]>`
        SELECT data, expires_at FROM sessions WHERE sid = ${sid}
      `
      .then((rows) => {
        const row = rows[0];
        if (!row || new Date(row.expires_at).getTime() < Date.now()) {
          if (row) {
            void this.prisma
              .$executeRaw`DELETE FROM sessions WHERE sid = ${sid}`;
          }
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(row.data) as session.SessionData);
      })
      .catch((err) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + THIRTY_DAYS_MS);
    const data = JSON.stringify(sess);
    void this.prisma
      .$executeRaw`
        INSERT INTO sessions (id, sid, data, expires_at, created_at, updated_at)
        VALUES (gen_random_uuid(), ${sid}, ${data}, ${expiresAt}, NOW(), NOW())
        ON CONFLICT (sid) DO UPDATE
        SET data = EXCLUDED.data,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
      `
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    void this.prisma
      .$executeRaw`DELETE FROM sessions WHERE sid = ${sid}`
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  touch(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void) {
    const expiresAt = sess.cookie?.expires
      ? new Date(sess.cookie.expires)
      : new Date(Date.now() + THIRTY_DAYS_MS);
    void this.prisma
      .$executeRaw`
        UPDATE sessions
        SET expires_at = ${expiresAt}, updated_at = NOW()
        WHERE sid = ${sid}
      `
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }
}
