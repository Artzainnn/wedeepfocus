import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_DAYS,
  MAX_FOCUS_GAP_MS,
  STREAK_MIN_MS,
  addToDay,
  cleanHistory,
  focusLevel,
  focusSince,
  gridWeeks,
  shiftDay,
  streaks,
  summarize,
} from "../../extension/shared/stats.js";

const MIN = 60_000;
const withFocus = (entries) => ({ days: Object.fromEntries(entries.map(([key, minutes]) => [key, { focusMs: minutes * MIN }])) });

describe("stats history", () => {
  test("shiftDay moves by calendar days across months, years and DST", () => {
    assert.equal(shiftDay("2026-09-28", 1), "2026-09-29");
    assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
    assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftDay("2026-03-29", 1), "2026-03-30");
    assert.equal(shiftDay("2026-10-25", -1), "2026-10-24");
  });

  test("addToDay sums counters and paid amounts per currency", () => {
    let history = addToDay({}, "2026-09-28", { blocked: 1, focusMs: 5 * MIN });
    history = addToDay(history, "2026-09-28", { blocked: 2, endedPaid: 1, paid: { EUR: 5 } });
    history = addToDay(history, "2026-09-28", { paid: { EUR: 10, USD: 2, GBP: 3 } });
    const day = history.days["2026-09-28"];
    assert.equal(day.blocked, 3);
    assert.equal(day.focusMs, 5 * MIN);
    assert.equal(day.endedPaid, 1);
    assert.deepEqual(day.paid, { EUR: 15, USD: 2 }, "unknown currencies are ignored");
  });

  test("cleanHistory drops malformed data and old days are pruned", () => {
    const clean = cleanHistory({ days: { nope: {}, "2026-09-28": { blocked: -3, focusMs: "x", completed: 2.7 } } });
    assert.deepEqual(Object.keys(clean.days), ["2026-09-28"]);
    assert.equal(clean.days["2026-09-28"].blocked, 0);
    assert.equal(clean.days["2026-09-28"].completed, 2);
    const old = addToDay({ days: { [shiftDay("2026-09-28", -HISTORY_DAYS)]: { blocked: 1 } } }, "2026-09-28", { blocked: 1 });
    assert.deepEqual(Object.keys(old.days), ["2026-09-28"]);
    assert.deepEqual(cleanHistory(null), { days: {} });
  });

  test("focusSince counts only while active, capped for sleep", () => {
    assert.equal(focusSince({ at: 1000, active: true }, 61_000), 60_000);
    assert.equal(focusSince({ at: 1000, active: false }, 61_000), 0);
    assert.equal(focusSince(null, 61_000), 0);
    assert.equal(focusSince({ at: 0, active: true }, 60 * MIN), MAX_FOCUS_GAP_MS);
  });
});

describe("streaks", () => {
  test("current streak ends today, or yesterday while today isn't counted yet", () => {
    const history = withFocus([["2026-09-25", 30], ["2026-09-26", 10], ["2026-09-27", 45]]);
    assert.deepEqual(streaks(history, "2026-09-27"), { current: 3, best: 3 });
    assert.deepEqual(streaks(history, "2026-09-28"), { current: 3, best: 3 }, "the morning before a session keeps the streak");
    assert.deepEqual(streaks(history, "2026-09-29"), { current: 0, best: 3 }, "a missed day breaks it");
  });

  test("a day needs at least a minute of protected focus", () => {
    const history = { days: { "2026-09-27": { focusMs: STREAK_MIN_MS - 1, blocked: 9 }, "2026-09-28": { focusMs: STREAK_MIN_MS } } };
    assert.deepEqual(streaks(history, "2026-09-28"), { current: 1, best: 1 });
  });

  test("best streak is the longest run in the history", () => {
    const history = withFocus([["2026-09-01", 5], ["2026-09-02", 5], ["2026-09-03", 5], ["2026-09-04", 5], ["2026-09-10", 5], ["2026-09-11", 5]]);
    assert.deepEqual(streaks(history, "2026-09-11"), { current: 2, best: 4 });
  });
});

describe("summaries and grid", () => {
  test("summarize totals a period and counts used days", () => {
    const history = {
      days: {
        "2026-09-20": { focusMs: 60 * MIN, blocked: 4 },
        "2026-09-27": { focusMs: 30 * MIN, blocked: 2, completed: 1, endedFree: 1 },
        "2026-09-28": { focusMs: 0, blocked: 1, endedPaid: 2, paid: { EUR: 7 } },
      },
    };
    const week = summarize(history, "2026-09-28", 7);
    assert.equal(week.blocked, 3);
    assert.equal(week.focusMs, 30 * MIN);
    assert.equal(week.ended, 3);
    assert.deepEqual(week.paid, { EUR: 7 });
    assert.equal(week.daysUsed, 1);
    assert.equal(summarize(history, "2026-09-28").blocked, 7, "null period = everything");
  });

  test("focusLevel maps minutes to 5 colour levels", () => {
    assert.equal(focusLevel(undefined), 0);
    assert.equal(focusLevel({ focusMs: 30_000 }), 0);
    assert.equal(focusLevel({ focusMs: 10 * MIN }), 1);
    assert.equal(focusLevel({ focusMs: 45 * MIN }), 2);
    assert.equal(focusLevel({ focusMs: 90 * MIN }), 3);
    assert.equal(focusLevel({ focusMs: 180 * MIN }), 4);
  });

  test("gridWeeks gives Monday-first columns ending with the current week", () => {
    const weeks = gridWeeks("2026-09-30", 2); // a Wednesday
    assert.equal(weeks.length, 2);
    assert.equal(weeks[1][0], "2026-09-28", "the last column starts on this week's Monday");
    assert.equal(weeks[1][2], "2026-09-30");
    assert.equal(weeks[1][3], null, "days after today are empty");
    assert.equal(weeks[0][0], "2026-09-21");
  });
});
