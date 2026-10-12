// Weekly schedule engine. Pure module: no chrome, no document.
// All local times are built with new Date(y, m, d, h, min) so the JS engine handles DST.

import { LOOKAHEAD_DAYS } from "./constants.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_MS = LOOKAHEAD_DAYS * DAY_MS;
const MAX_SCANNED_DAYS = 4000;

export function parseHM(str) {
  if (typeof str !== "string") return NaN;
  const match = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

export function isValidSlot(slot) {
  if (!slot || typeof slot !== "object") return false;
  const { days } = slot;
  if (!Array.isArray(days) || days.length === 0) return false;
  if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) return false;
  const start = parseHM(slot.start);
  const end = parseHM(slot.end);
  return !Number.isNaN(start) && !Number.isNaN(end) && start !== end;
}

function isEnabledSlot(slot) {
  return isValidSlot(slot) && slot.enabled !== false;
}

export function slotOccurrences(slot, fromMs, toMs) {
  if (!isEnabledSlot(slot)) return [];
  const from = Number(fromMs);
  const to = Number(toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];

  const startMinutes = parseHM(slot.start);
  const endMinutes = parseHM(slot.end);
  const overnight = endMinutes < startMinutes;
  const days = new Set(slot.days);

  // Start one day early: an overnight slot from the previous day can spill into the range.
  const origin = new Date(from);
  const year = origin.getFullYear();
  const month = origin.getMonth();
  const date = origin.getDate() - 1;

  const occurrences = [];
  for (let offset = 0; offset < MAX_SCANNED_DAYS; offset++) {
    const day = new Date(year, month, date + offset);
    if (day.getTime() >= to) break;
    if (!days.has(day.getDay())) continue;
    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();
    const start = localTime(y, m, d, startMinutes);
    const end = localTime(y, m, overnight ? d + 1 : d, endMinutes);
    // A slot that falls entirely inside a DST gap collapses to nothing.
    if (end <= start) continue;
    if (start < to && end > from) occurrences.push({ start, end });
  }
  return occurrences;
}

function localTime(year, month, date, minutes) {
  return new Date(year, month, date, Math.floor(minutes / 60), minutes % 60).getTime();
}

function enabledSlots(schedules) {
  return Array.isArray(schedules) ? schedules.filter(isEnabledSlot) : [];
}

function sessionInterval(session, now) {
  if (!session || typeof session !== "object") return null;
  const endsAt = Number(session.endsAt);
  if (!Number.isFinite(endsAt) || endsAt <= now) return null;
  const startedAt = Number(session.startedAt);
  const start = Number.isFinite(startedAt) ? Math.min(startedAt, now) : now;
  return { start, end: endsAt };
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

function contains(interval, time) {
  return interval.start <= time && time < interval.end;
}

const INACTIVE = Object.freeze({ active: false, source: null, until: null, startedAt: null, nextStart: null });

export function blockState(nowMs, { schedules, session } = {}) {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return { ...INACTIVE };
  const windowStart = now - HORIZON_MS;
  const windowEnd = now + HORIZON_MS;

  const scheduled = enabledSlots(schedules).flatMap((slot) => slotOccurrences(slot, windowStart, windowEnd));
  const manual = sessionInterval(session, now);
  const merged = mergeIntervals(manual ? [...scheduled, manual] : scheduled);
  const current = merged.find((interval) => contains(interval, now));

  if (current) {
    const inSchedule = scheduled.some((interval) => contains(interval, now));
    const source = manual && inSchedule ? "both" : manual ? "session" : "schedule";
    return {
      active: true,
      source,
      until: Math.min(current.end, windowEnd),
      startedAt: Math.max(current.start, windowStart),
      nextStart: null,
    };
  }

  let nextStart = null;
  for (const interval of scheduled) {
    if (interval.start > now && (nextStart === null || interval.start < nextStart)) nextStart = interval.start;
  }
  return { ...INACTIVE, nextStart };
}

// Earliest future instant among slot starts and ends, the session end, pass expiries and the end of
// a suspend (a session ended early: the schedules take over again then).
export function nextTransition(nowMs, { schedules, session, passes, suspend } = {}) {
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return null;
  let next = null;
  const consider = (time) => {
    if (Number.isFinite(time) && time > now && (next === null || time < next)) next = time;
  };

  for (const slot of enabledSlots(schedules)) {
    for (const { start, end } of slotOccurrences(slot, now, now + HORIZON_MS)) {
      consider(start);
      consider(end);
    }
  }
  if (session && typeof session === "object") consider(Number(session.endsAt));
  if (passes && typeof passes === "object") {
    for (const expiresAt of Object.values(passes)) consider(Number(expiresAt));
  }
  if (suspend && typeof suspend === "object") consider(Number(suspend.until));
  return next;
}
