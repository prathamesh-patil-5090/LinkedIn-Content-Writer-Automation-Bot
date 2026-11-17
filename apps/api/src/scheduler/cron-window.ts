import type { ContentType } from '@ldp/shared';

/**
 * LinkedIn: 1 post/day (max 5–7/week). Post half-life ~23h — more than 1/day
 * splits the first-hour audience and kills distribution.
 *
 * Windows (IST): 08:30–10:00 (India morning) · 18:30–20:00 (EU afternoon / US East morning).
 * Nest fires at 08:30 and 18:30; daily cap ensures only one publish.
 */
export const POSTS_PER_DAY = 1;
export const POSTS_PER_WEEK = 7;

/** Publish fire times as "HH:MM" IST (Nest cron mirrors these). */
export const IST_PUBLISH_SLOTS = ['08:30', '18:30'] as const;

/** Inclusive minute ranges from midnight IST. */
const MORNING_START = 8 * 60 + 30; // 08:30
const MORNING_END = 10 * 60; // 10:00
const EVENING_START = 18 * 60 + 30; // 18:30
const EVENING_END = 20 * 60; // 20:00

/** @deprecated Prefer IST_PUBLISH_SLOTS — kept for health/settings display helpers. */
export const IST_CRON_HOURS = IST_PUBLISH_SLOTS.map((s) =>
  Number(s.split(':')[0]),
);

function envInt(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Resolve caps with sane bounds (1/day, 5–7/week by default). */
export function linkedInCaps() {
  return {
    postsPerDay: envInt('POSTS_PER_DAY', POSTS_PER_DAY, 1, 3),
    postsPerWeek: envInt('POSTS_PER_WEEK', POSTS_PER_WEEK, 5, 7),
  };
}

export function cronWindowStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? -1);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const mins = hour * 60 + minute;
  const inMorning = mins >= MORNING_START && mins <= MORNING_END;
  const inEvening = mins >= EVENING_START && mins <= EVENING_END;
  const inWindow = inMorning || inEvening;

  return {
    timezone: 'Asia/Kolkata',
    istHour: hour,
    istMinute: minute,
    istWeekday: weekday,
    inWindow,
    inMorning,
    inEvening,
    slots: [...IST_PUBLISH_SLOTS],
    hours: IST_CRON_HOURS,
  };
}

export function shouldRunCronSlot(now = new Date()) {
  return cronWindowStatus(now).inWindow;
}

export function startOfIstDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return new Date(`${y}-${m}-${d}T00:00:00+05:30`);
}

/** Monday 00:00 Asia/Kolkata for the week containing `now`. */
export function startOfIstWeek(now = new Date()) {
  const dayStart = startOfIstDay(now);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
  }).format(now);
  const offset: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const daysFromMonday = offset[weekday] ?? 0;
  return new Date(dayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
}

/**
 * Day-of-week rotation across the two topic pillars (TypeScript / full-stack
 * and AI engineering). howto and architecture are treatments that draw from
 * either pillar. Security is not in the rotation: it is off-niche.
 */
export function contentTypeForDay(weekday: string): ContentType {
  switch (weekday.slice(0, 3)) {
    case 'Mon':
      return 'js-lib';
    case 'Tue':
      return 'ai-devtools';
    case 'Wed':
      return 'howto';
    case 'Thu':
      return 'ai-devtools';
    case 'Fri':
      return 'architecture';
    case 'Sat':
      return 'js-lib';
    case 'Sun':
      return 'ai-devtools';
    default:
      return 'js-lib';
  }
}

export function linkedInScheduleLabel() {
  const { postsPerDay, postsPerWeek } = linkedInCaps();
  return `${postsPerDay} post/day (max ${postsPerWeek}/week) · ${IST_PUBLISH_SLOTS.join(' + ')} Asia/Kolkata`;
}
