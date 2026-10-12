// Local usage history for the stats page and the streak (chrome.storage.local "history").
// Pure module: no chrome, no document. Nothing here ever leaves the browser.
//
// history = { days: { "2026-09-28": { focusMs, blocked, resisted, completed, endedFree, endedPaid, paid: { EUR: 5 } } } }

export const HISTORY_DAYS = 366;
// A day counts for the streak once a block protected at least this much focus time.
export const STREAK_MIN_MS = 60_000;
// Longest gap counted as focus between two reconciles (sleep or a closed browser don't count).
export const MAX_FOCUS_GAP_MS = 6 * 60_000;
// Upper bounds for the day grid colours (focus minutes): 0, then 4 levels.
const LEVELS_MIN = [1, 30, 60, 120];

const COUNTERS = ["focusMs", "blocked", "resisted", "completed", "endedFree", "endedPaid"];
const CURRENCIES = ["EUR", "USD"];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDay() {
  return { focusMs: 0, blocked: 0, resisted: 0, completed: 0, endedFree: 0, endedPaid: 0, paid: {} };
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function cleanDay(day) {
  const clean = emptyDay();
  if (!day || typeof day !== "object") return clean;
  for (const key of COUNTERS) clean[key] = count(day[key]);
  for (const currency of CURRENCIES) {
    const amount = count(day.paid?.[currency]);
    if (amount) clean.paid[currency] = amount;
  }
  return clean;
}

// Whatever storage returned, as a valid history (unknown or malformed entries dropped).
export function cleanHistory(history) {
  const days = {};
  const source = history && typeof history === "object" && history.days && typeof history.days === "object" ? history.days : {};
  for (const [key, day] of Object.entries(source)) {
    if (DAY_KEY.test(key)) days[key] = cleanDay(day);
  }
  return { days };
}

// A new history with `changes` added to the day `dayKey`: counters are summed, `paid` amounts too.
export function addToDay(history, dayKey, changes) {
  const clean = cleanHistory(history);
  const day = clean.days[dayKey] ?? emptyDay();
  for (const key of COUNTERS) if (changes[key]) day[key] += count(changes[key]);
  for (const [currency, amount] of Object.entries(changes.paid ?? {})) {
    if (CURRENCIES.includes(currency) && count(amount)) day.paid[currency] = (day.paid[currency] ?? 0) + count(amount);
  }
  clean.days[dayKey] = day;
  return pruneHistory(clean, dayKey);
}

// Keeps the last HISTORY_DAYS days up to `todayKey`.
export function pruneHistory(history, todayKey) {
  const oldest = shiftDay(todayKey, -(HISTORY_DAYS - 1));
  const days = {};
  for (const [key, day] of Object.entries(history.days)) if (key >= oldest && key <= todayKey) days[key] = day;
  return { days };
}

// Focus time since the last reconcile, capped (the machine may have slept in between).
export function focusSince(clock, now) {
  if (!clock || clock.active !== true || !Number.isFinite(clock.at) || now <= clock.at) return 0;
  return Math.min(now - clock.at, MAX_FOCUS_GAP_MS);
}

// Day keys are local dates; noon avoids DST edge cases when moving by whole days.
export function shiftDay(dayKey, delta) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d + delta, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayCounts(day) {
  return Boolean(day) && day.focusMs >= STREAK_MIN_MS;
}

// current: consecutive counted days ending today (or yesterday while today isn't counted yet).
export function streaks(history, todayKey) {
  const { days } = cleanHistory(history);
  let current = 0;
  let key = dayCounts(days[todayKey]) ? todayKey : shiftDay(todayKey, -1);
  while (dayCounts(days[key])) {
    current += 1;
    key = shiftDay(key, -1);
  }
  let best = 0;
  let run = 0;
  let previous = null;
  for (const dayKey of Object.keys(days).sort()) {
    if (!dayCounts(days[dayKey])) {
      run = 0;
      previous = null;
      continue;
    }
    run = previous && shiftDay(previous, 1) === dayKey ? run + 1 : 1;
    previous = dayKey;
    best = Math.max(best, run);
  }
  return { current, best: Math.max(best, current) };
}

// Totals over the last `lastDays` days up to today (null = the whole history).
export function summarize(history, todayKey, lastDays = null) {
  const { days } = cleanHistory(history);
  const from = lastDays ? shiftDay(todayKey, -(lastDays - 1)) : "";
  const total = { ...emptyDay(), paid: {}, daysUsed: 0 };
  for (const [key, day] of Object.entries(days)) {
    if (key < from || key > todayKey) continue;
    for (const field of COUNTERS) total[field] += day[field];
    for (const [currency, amount] of Object.entries(day.paid)) total.paid[currency] = (total.paid[currency] ?? 0) + amount;
    if (dayCounts(day)) total.daysUsed += 1;
  }
  total.ended = total.endedFree + total.endedPaid;
  return total;
}

// Colour level 0 to 4 for a day of the grid.
export function focusLevel(day) {
  const minutes = (day?.focusMs ?? 0) / 60_000;
  if (minutes < LEVELS_MIN[0]) return 0;
  return LEVELS_MIN.filter((bound) => minutes >= bound).length;
}

// The last `weeks` full weeks as columns of 7 day keys, Monday first; days after today are null.
export function gridWeeks(todayKey, weeks) {
  const [y, m, d] = todayKey.split("-").map(Number);
  const mondayOffset = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  const start = shiftDay(todayKey, -mondayOffset - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const key = shiftDay(start, w * 7 + i);
      return key <= todayKey ? key : null;
    }),
  );
}
