type SameSite = 'lax' | 'strict' | 'none';

export function sessionCookieOpts(): {
  path: string;
  httpOnly: true;
  sameSite: SameSite;
  secure: boolean;
} {
  const raw = process.env.COOKIE_SAMESITE;
  const sameSite: SameSite =
    raw === 'lax' || raw === 'strict' || raw === 'none'
      ? raw
      : process.env.NODE_ENV === 'production'
        ? 'none'
        : 'lax';

  return {
    path: '/',
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
  };
}
