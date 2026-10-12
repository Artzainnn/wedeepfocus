// Shared helpers for unit tests (not a test file itself: node --test only runs *.test.js).

// Local time in ms, month is 1 based: at(2026, 9, 28, 7, 30) is Monday 28 September 2026, 07:30 local.
export function at(year, month, day, hours = 0, minutes = 0) {
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function slot(days, start, end, extra = {}) {
  return { id: `s_${days.join("")}_${start}_${end}`, days, start, end, enabled: true, ...extra };
}

// Minimal chrome.* fake with an event helper; tests override what they need.
export function fakeEvent() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    emit: (...args) => {
      for (const fn of [...listeners]) fn(...args);
    },
  };
}
