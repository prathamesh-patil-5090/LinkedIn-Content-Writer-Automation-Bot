import {
  createLinkedInOauthState,
  verifyLinkedInOauthState,
} from './oauth-state';

describe('linkedin oauth state', () => {
  const prev = process.env.SESSION_SECRET;

  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
  });

  afterAll(() => {
    process.env.SESSION_SECRET = prev;
  });

  it('round-trips a user id', () => {
    const state = createLinkedInOauthState('user-123');
    expect(verifyLinkedInOauthState(state)).toBe('user-123');
  });

  it('rejects tampered state', () => {
    const state = createLinkedInOauthState('user-123');
    const [body] = state.split('.');
    expect(verifyLinkedInOauthState(`${body}.deadbeef`)).toBeNull();
  });
});
