import type { ContentType } from '@ldp/shared';

/** Every 2 hours from 07:00 through 00:00 Asia/Kolkata. */
export const IST_CRON_HOURS = [7, 9, 11, 13, 15, 17, 19, 21, 23, 0];

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
    case 15:
      return 'js-lib';
    case 9:
    case 17:
      return 'ai-devtools';
    case 11:
      return 'security-bug';
    case 13:
      return 'howto';
    case 19:
      return 'architecture';
    case 21:
      return securityPostedToday ? 'js-lib' : 'security-bug';
    case 23:
    case 0:
    default:
      return 'js-lib';
  }
}
