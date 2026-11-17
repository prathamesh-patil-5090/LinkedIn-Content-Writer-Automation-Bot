import {
  contentTypeForDay,
  cronWindowStatus,
  shouldRunCronSlot,
  startOfIstDay,
  startOfIstWeek,
  IST_PUBLISH_SLOTS,
  POSTS_PER_DAY,
  POSTS_PER_WEEK,
  linkedInCaps,
  linkedInScheduleLabel,
} from './cron-window';
import {
  AUTHORITY_BUCKETS,
  normalizeBucket,
  storyBucketsFor,
} from '@ldp/shared';

describe('daily LinkedIn cron slots', () => {
  it('defaults to 1/day and max 7/week', () => {
    expect(POSTS_PER_DAY).toBe(1);
    expect(POSTS_PER_WEEK).toBe(7);
    expect(linkedInCaps()).toEqual({ postsPerDay: 1, postsPerWeek: 7 });
    expect(IST_PUBLISH_SLOTS).toEqual(['08:30', '18:30']);
  });

  it('allows ticks only inside morning/evening IST windows', () => {
    expect(shouldRunCronSlot(new Date('2026-09-14T08:30:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T09:45:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T10:00:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T10:01:00+05:30'))).toBe(false);
    expect(shouldRunCronSlot(new Date('2026-09-14T07:00:00+05:30'))).toBe(false);
    expect(shouldRunCronSlot(new Date('2026-09-14T18:30:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T19:59:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T20:00:00+05:30'))).toBe(true);
    expect(shouldRunCronSlot(new Date('2026-09-14T20:01:00+05:30'))).toBe(false);
  });

  it('describes the LinkedIn schedule', () => {
    expect(linkedInScheduleLabel()).toContain('1 post/day');
    expect(linkedInScheduleLabel()).toContain('08:30');
  });
});

describe('contentTypeForDay', () => {
  const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  it('rotates by weekday for 1×/day cadence', () => {
    expect(week.map(contentTypeForDay)).toEqual([
      'js-lib',
      'ai-devtools',
      'howto',
      'ai-devtools',
      'architecture',
      'js-lib',
      'ai-devtools',
    ]);
  });

  it('only ever draws stories from the two authority pillars', () => {
    for (const day of week) {
      const buckets = storyBucketsFor(contentTypeForDay(day));
      expect(buckets.length).toBeGreaterThan(0);
      for (const b of buckets) expect(AUTHORITY_BUCKETS).toContain(b);
    }
  });
});

describe('startOfIstDay', () => {
  it('returns midnight IST', () => {
    const start = startOfIstDay(new Date('2026-08-18T12:00:00+05:30'));
    expect(cronWindowStatus(start).istHour).toBe(0);
  });
});

describe('startOfIstWeek', () => {
  it('returns Monday midnight IST', () => {
    // Wednesday → Monday of that week
    const start = startOfIstWeek(new Date('2026-09-16T12:00:00+05:30'));
    expect(start.toISOString()).toBe(
      startOfIstDay(new Date('2026-09-14T00:00:00+05:30')).toISOString(),
    );
  });
});

describe('normalizeBucket', () => {
  it('classifies security vs js vs ai', () => {
    expect(normalizeBucket('security-bug')).toBe('security-bug');
    expect(normalizeBucket('js-lib')).toBe('js-lib');
    expect(normalizeBucket('ai-devtools')).toBe('ai-devtools');
  });
});
