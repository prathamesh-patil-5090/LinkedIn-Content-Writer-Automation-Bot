import {
  contentTypeForHour,
  cronWindowStatus,
  startOfIstDay,
} from './cron-window';
import { normalizeBucket } from '@ldp/shared';

describe('contentTypeForHour', () => {
  it('maps the IST slots to a mixed day', () => {
    expect(contentTypeForHour(7, false)).toBe('js-lib');
    expect(contentTypeForHour(9, false)).toBe('ai-devtools');
    expect(contentTypeForHour(11, false)).toBe('security-bug');
    expect(contentTypeForHour(13, false)).toBe('howto');
    expect(contentTypeForHour(19, false)).toBe('architecture');
  });

  it('caps evening security if a CVE already shipped today', () => {
    expect(contentTypeForHour(21, true)).toBe('js-lib');
    expect(contentTypeForHour(21, false)).toBe('security-bug');
  });
});

describe('startOfIstDay', () => {
  it('returns midnight IST', () => {
    const start = startOfIstDay(new Date('2026-08-18T12:00:00+05:30'));
    expect(cronWindowStatus(start).istHour).toBe(0);
  });
});

describe('normalizeBucket', () => {
  it('classifies security vs js vs ai', () => {
    expect(normalizeBucket('security-bug')).toBe('security-bug');
    expect(normalizeBucket('js-lib')).toBe('js-lib');
    expect(normalizeBucket('ai-devtools')).toBe('ai-devtools');
  });
});
