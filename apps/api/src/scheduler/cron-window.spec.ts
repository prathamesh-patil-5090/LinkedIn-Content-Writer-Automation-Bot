import {
  contentTypeForHour,
  cronWindowStatus,
  shouldRunCronSlot,
  startOfIstDay,
  IST_CRON_HOURS,
  POSTS_PER_DAY,
} from './cron-window';
import { normalizeBucket } from '@ldp/shared';

describe('daily cron slots', () => {
  it('schedules 6 IST hours', () => {
    expect(POSTS_PER_DAY).toBe(6);
    expect(IST_CRON_HOURS).toEqual([7, 10, 13, 16, 19, 22]);
  });

  it('allows ticks only in the first minutes of a slot hour', () => {
    expect(shouldRunCronSlot(new Date('2026-09-14T07:00:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T07:05:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T07:06:00+05:30'))).toBe(false);
    expect(shouldRunCronSlot(new Date('2026-09-14T08:00:00+05:30'))).toBe(false);
  });
});

describe('contentTypeForHour', () => {
  it('maps the IST slots to a mixed day', () => {
    expect(contentTypeForHour(7, false)).toBe('js-lib');
    expect(contentTypeForHour(10, false)).toBe('ai-devtools');
    expect(contentTypeForHour(13, false)).toBe('howto');
    expect(contentTypeForHour(16, false)).toBe('security-bug');
    expect(contentTypeForHour(19, false)).toBe('architecture');
    expect(contentTypeForHour(22, false)).toBe('ai-devtools');
  });

  it('avoids a second security post in the last slot', () => {
    expect(contentTypeForHour(22, true)).toBe('js-lib');
    expect(contentTypeForHour(22, false)).toBe('ai-devtools');
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
