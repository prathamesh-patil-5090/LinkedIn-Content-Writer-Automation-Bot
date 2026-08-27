import type { ContentType } from '@ldp/shared';

/** Six posts/day, every 3 hours, Asia/Kolkata. */
export const POSTS_PER_DAY = 6;
export const IST_CRON_HOURS = [7, 10, 13, 16, 19, 22];

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
  const inWindow = IST_CRON_HOURS.includes(hour);

  return {
    timezone: 'Asia/Kolkata',
    istHour: hour,
    istMinute: minute,
    inWindow,
    hours: IST_CRON_HOURS,
  };
}

export function shouldRunCronSlot(now = new Date()) {
  const { inWindow } = cronWindowStatus(now);
  return inWindow;
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

/** Slot rotation so the day is not ten CVE posts. */
export function contentTypeForHour(
  istHour: number,
  securityPostedToday: boolean,
): ContentType {
  switch (istHour) {
    case 7:
      return 'js-lib';
    case 10:
      return 'ai-devtools';
    case 13:
      return 'howto';
    case 16:
      return 'security-bug';
    case 19:
      return 'architecture';
    case 22:
      return securityPostedToday ? 'js-lib' : 'ai-devtools';
    default:
      return 'js-lib';
  }
}
