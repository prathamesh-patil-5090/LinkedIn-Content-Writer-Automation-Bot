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
