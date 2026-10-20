// Delivery date ka calculator. Settings page ka preview aur App Proxy, dono yahi use karte hain.

export type Schedule = {
  timezone: string;
  processingDays: number;
  cutoffHour: number; // 24 = koi cut-off nahi
  workingDays: number[]; // 0 = Sunday ... 6 = Saturday
  holidays: string[]; // "2026-11-08"
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY_MS);
}

// Store ke timezone mein "aaj" ki date aur abhi ka ghanta/minute
function storeNow(timezone: string, now: Date) {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).formatToParts(now);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    today: new Date(Date.UTC(get("year"), get("month") - 1, get("day"))), // din ko UTC midnight par rakhte hain
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

export function isWorkingDay(day: Date, s: Schedule) {
  return s.workingDays.includes(day.getUTCDay()) && !s.holidays.includes(toISODate(day));
}

// n working days aage (Sunday/holiday gine nahi jaate)
export function addWorkingDays(start: Date, n: number, s: Schedule) {
  let d = start;
  let left = n;
  let guard = 0;
  while (left > 0 && guard < 730) {
    d = addDays(d, 1);
    if (isWorkingDay(d, s)) left--;
    guard++;
  }
  return d;
}

export function calculateDelivery(s: Schedule, minDays: number, maxDays: number, now = new Date()) {
  const { today, hour, minute } = storeNow(s.timezone, now);

  const hasCutoff = s.cutoffHour < 24;
  const pastCutoff = hasCutoff && hour >= s.cutoffHour;

  // Aaj working day hai aur cut-off nahi nikla → order aaj gina jaayega, warna agle working day
  const todayCounts = isWorkingDay(today, s) && !pastCutoff;
  const orderDay = todayCounts ? today : addWorkingDays(today, 1, s);

  const dispatch = addWorkingDays(orderDay, s.processingDays, s);
  const from = addWorkingDays(dispatch, minDays, s);
  const to = addWorkingDays(dispatch, maxDays, s);

  // Cut-off tak kitne minute bache (countdown ke liye)
  const minutesLeft = hasCutoff && todayCounts ? s.cutoffHour * 60 - (hour * 60 + minute) : null;

  return { today, orderDay, dispatch, from, to, minutesLeft, todayCounts };
}

export function formatDay(d: Date, locale = "en-IN") {
  return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatCountdown(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// "Delivery by {from} – {to}" → asli dates ke saath
export function fillMessage(template: string, from: string, to: string) {
  return template.split("{from}").join(from).split("{to}").join(to);
}