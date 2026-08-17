import { escapeLinkedInCommentary } from './commentary';

describe('escapeLinkedInCommentary', () => {
  it('escapes parentheses so CVE ids do not truncate the post', () => {
    const input =
      'React Server Components just got a nasty RCE (CVE-2025-55182).\nPatch to React 19.0.0+.';
    expect(escapeLinkedInCommentary(input)).toBe(
      'React Server Components just got a nasty RCE \\(CVE-2025-55182\\).\nPatch to React 19.0.0+.',
    );
  });

  it('leaves hashtags clickable', () => {
    expect(escapeLinkedInCommentary('Ship it. #react')).toBe('Ship it. #react');
  });
});
