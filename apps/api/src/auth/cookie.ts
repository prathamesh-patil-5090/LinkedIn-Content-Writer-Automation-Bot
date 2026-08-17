export function sessionCookieOpts() {
  const sameSite =
    process.env.COOKIE_SAMESITE === 'lax' ||
    process.env.COOKIE_SAMESITE === 'strict'
      ? process.env.COOKIE_SAMESITE
      : process.env.NODE_ENV === 'production'
        ? 'none'
        : 'lax';

  return {
    path: '/',
    httpOnly: true as const,
    sameSite,
    secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
  };
}
