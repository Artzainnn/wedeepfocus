// Time formatting helpers. Pure module: no chrome, no document.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function wholeUnits(ms, unitMs) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / unitMs);
}

export function formatCountdown(ms) {
  const total = wholeUnits(ms, SECOND_MS);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

// Same output in English and French: "45 min", "1 h 05", "12 h".
export function formatDurationShort(ms, locale) {
  const total = wholeUnits(ms, MINUTE_MS);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${pad2(minutes)}`;
}

export function formatBadge(ms) {
  const total = wholeUnits(ms, MINUTE_MS);
  if (total <= 0) return "";
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  if (hours >= 10) return "10h+";
  return `${hours}h${pad2(total % 60)}`;
}

const formatters = new Map();

function formatter(locale, options) {
  const tag = cleanLocale(locale);
  const key = `${tag}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    try {
      cached = new Intl.DateTimeFormat(tag, options);
    } catch {
      cached = new Intl.DateTimeFormat("en", options);
    }
    formatters.set(key, cached);
  }
  return cached;
}

function cleanLocale(locale) {
  return typeof locale === "string" && locale ? locale.replace(/_/g, "-") : "en";
}

// 24 hour locales get "07:00" (two digit hours), 12 hour locales keep "7:00 AM".
function clockFormatter(locale) {
  const probe = formatter(locale, { hour: "numeric", minute: "2-digit" });
  const { hourCycle, hour12 } = probe.resolvedOptions();
  const is24h = hourCycle ? hourCycle === "h23" || hourCycle === "h24" : hour12 === false;
  return is24h ? formatter(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : probe;
}

function toDate(ms) {
  const date = new Date(Number(ms));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatClock(ms, locale) {
  const date = toDate(ms);
  return date ? clockFormatter(locale).format(date) : "";
}

export function formatWeekdayClock(ms, locale) {
  const date = toDate(ms);
  if (!date) return "";
  const weekday = formatter(locale, { weekday: "long" }).format(date);
  return `${weekday} ${clockFormatter(locale).format(date)}`;
}

export function localDayKey(ms) {
  const date = toDate(ms) ?? new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
