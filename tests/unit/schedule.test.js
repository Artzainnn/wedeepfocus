import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { blockState, isValidSlot, nextTransition, parseHM, slotOccurrences } from "../../extension/shared/schedule.js";
import { LOOKAHEAD_DAYS } from "../../extension/shared/constants.js";
import { at, DAY, HOUR, MINUTE, slot } from "./helpers.js";

// Reference week: Monday 28 September 2026 to Sunday 4 October 2026.
const WEEKDAYS = [1, 2, 3, 4, 5];

describe("parseHM", () => {
  test("parses valid 24h times", () => {
    assert.equal(parseHM("07:30"), 450);
    assert.equal(parseHM("00:00"), 0);
    assert.equal(parseHM("23:59"), 1439);
    assert.equal(parseHM("7:05"), 425);
    assert.equal(parseHM(" 07:30 "), 450);
  });

  test("returns NaN for invalid input", () => {
    for (const bad of ["24:00", "12:60", "abc", "", "7", "07:30:00", "07h30", "-1:00", null, undefined, 730, {}]) {
      assert.ok(Number.isNaN(parseHM(bad)), `expected NaN for ${JSON.stringify(bad)}`);
    }
  });
});

describe("isValidSlot", () => {
  test("accepts regular and overnight slots", () => {
    assert.equal(isValidSlot(slot(WEEKDAYS, "07:00", "14:00")), true);
    assert.equal(isValidSlot(slot([5], "22:00", "02:00")), true);
    assert.equal(isValidSlot(slot([0, 6], "00:00", "23:59")), true);
    assert.equal(isValidSlot({ days: [3], start: "09:00", end: "10:00" }), true);
  });

  test("rejects bad days, bad times and empty slots", () => {
    assert.equal(isValidSlot(slot([], "07:00", "14:00")), false);
    assert.equal(isValidSlot(slot([7], "07:00", "14:00")), false);
    assert.equal(isValidSlot(slot([-1], "07:00", "14:00")), false);
    assert.equal(isValidSlot(slot([1.5], "07:00", "14:00")), false);
    assert.equal(isValidSlot(slot(["1"], "07:00", "14:00")), false);
    assert.equal(isValidSlot({ days: "12345", start: "07:00", end: "14:00" }), false);
    assert.equal(isValidSlot(slot([1], "07:00", "07:00")), false);
    assert.equal(isValidSlot(slot([1], "07:00", "7:00")), false);
    assert.equal(isValidSlot(slot([1], "07:00", "25:00")), false);
    assert.equal(isValidSlot(slot([1], "", "14:00")), false);
    assert.equal(isValidSlot(null), false);
    assert.equal(isValidSlot("slot"), false);
  });
});

describe("slotOccurrences", () => {
  test("returns one interval per matching day", () => {
    const occurrences = slotOccurrences(slot(WEEKDAYS, "07:00", "14:00"), at(2026, 9, 28), at(2026, 10, 5));
    assert.deepEqual(
      occurrences,
      [28, 29, 30].map((d) => ({ start: at(2026, 9, d, 7), end: at(2026, 9, d, 14) })).concat(
        [1, 2].map((d) => ({ start: at(2026, 10, d, 7), end: at(2026, 10, d, 14) })),
      ),
    );
  });

  test("disabled or invalid slots produce nothing", () => {
    assert.deepEqual(slotOccurrences(slot(WEEKDAYS, "07:00", "14:00", { enabled: false }), at(2026, 9, 28), at(2026, 10, 5)), []);
    assert.deepEqual(slotOccurrences(slot([], "07:00", "14:00"), at(2026, 9, 28), at(2026, 10, 5)), []);
    assert.deepEqual(slotOccurrences(null, at(2026, 9, 28), at(2026, 10, 5)), []);
  });

  test("a slot without an enabled flag counts as enabled", () => {
    const occurrences = slotOccurrences({ days: [1], start: "07:00", end: "08:00" }, at(2026, 9, 28), at(2026, 9, 29));
    assert.deepEqual(occurrences, [{ start: at(2026, 9, 28, 7), end: at(2026, 9, 28, 8) }]);
  });

  test("an overnight slot belongs to its start day and spills into the next one", () => {
    // Friday 22:00 to Saturday 02:00, queried from Saturday midnight only.
    const occurrences = slotOccurrences(slot([5], "22:00", "02:00"), at(2026, 10, 3), at(2026, 10, 3, 12));
    assert.deepEqual(occurrences, [{ start: at(2026, 10, 2, 22), end: at(2026, 10, 3, 2) }]);
  });

  test("an overnight slot on Sunday wraps into Monday", () => {
    const occurrences = slotOccurrences(slot([0], "23:00", "01:00"), at(2026, 9, 28), at(2026, 9, 29));
    assert.deepEqual(occurrences, [{ start: at(2026, 9, 27, 23), end: at(2026, 9, 28, 1) }]);
  });

  test("end at 00:00 means midnight of the next day", () => {
    const occurrences = slotOccurrences(slot([1], "22:00", "00:00"), at(2026, 9, 28), at(2026, 9, 30));
    assert.deepEqual(occurrences, [{ start: at(2026, 9, 28, 22), end: at(2026, 9, 29, 0) }]);
  });

  test("crosses month and year boundaries", () => {
    // 31 December 2026 is a Thursday.
    const occurrences = slotOccurrences(slot([4], "21:00", "03:00"), at(2026, 12, 31, 12), at(2027, 1, 1, 12));
    assert.deepEqual(occurrences, [{ start: at(2026, 12, 31, 21), end: at(2027, 1, 1, 3) }]);
  });

  test("uses half open ranges: touching the edges is not overlapping", () => {
    const daily = slot([1], "07:00", "14:00");
    assert.deepEqual(slotOccurrences(daily, at(2026, 9, 28, 14), at(2026, 9, 28, 20)), []);
    assert.deepEqual(slotOccurrences(daily, at(2026, 9, 28, 0), at(2026, 9, 28, 7)), []);
    assert.equal(slotOccurrences(daily, at(2026, 9, 28, 13, 59), at(2026, 9, 28, 20)).length, 1);
    assert.equal(slotOccurrences(daily, at(2026, 9, 28, 0), at(2026, 9, 28, 7, 1)).length, 1);
  });

  test("returns nothing for an empty or reversed range", () => {
    const daily = slot([1], "07:00", "14:00");
    assert.deepEqual(slotOccurrences(daily, at(2026, 9, 28, 10), at(2026, 9, 28, 10)), []);
    assert.deepEqual(slotOccurrences(daily, at(2026, 9, 29), at(2026, 9, 28)), []);
    assert.deepEqual(slotOccurrences(daily, NaN, at(2026, 9, 28)), []);
  });

  test("keeps local wall clock times on every day (DST safe)", () => {
    const daily = slot([0, 1, 2, 3, 4, 5, 6], "09:00", "17:00");
    // Covers the European (25 October) and US (1 November) fall back changes.
    const occurrences = slotOccurrences(daily, at(2026, 10, 20), at(2026, 11, 5));
    assert.equal(occurrences.length, 16);
    for (const { start, end } of occurrences) {
      assert.equal(new Date(start).getHours(), 9);
      assert.equal(new Date(end).getHours(), 17);
    }
  });

  test("overnight slot across a DST night matches the local constructors", () => {
    // Saturday 24 October 2026 22:00 to Sunday 25 October 04:00 (Europe falls back that night).
    const occurrences = slotOccurrences(slot([6], "22:00", "04:00"), at(2026, 10, 24, 12), at(2026, 10, 25, 12));
    assert.deepEqual(occurrences, [{ start: at(2026, 10, 24, 22), end: at(2026, 10, 25, 4) }]);
  });

  test("a slot inside a DST gap never yields an empty or negative interval", () => {
    // In Europe/Paris 02:00 and 03:00 are the same instant on 29 March 2026.
    const gap = slot([0], "02:00", "03:00");
    const occurrences = slotOccurrences(gap, at(2026, 3, 29), at(2026, 3, 30));
    const start = at(2026, 3, 29, 2);
    const end = at(2026, 3, 29, 3);
    assert.deepEqual(occurrences, end > start ? [{ start, end }] : []);
    for (const occurrence of occurrences) assert.ok(occurrence.end > occurrence.start);
  });
});

describe("blockState", () => {
  const inactive = { active: false, source: null, until: null, startedAt: null, nextStart: null };

  test("nothing configured means inactive with no next start", () => {
    assert.deepEqual(blockState(at(2026, 9, 28, 10), { schedules: [], session: null }), inactive);
    assert.deepEqual(blockState(at(2026, 9, 28, 10), {}), inactive);
    assert.deepEqual(blockState(at(2026, 9, 28, 10)), inactive);
  });

  test("a schedule covering now is active until its end", () => {
    const state = blockState(at(2026, 9, 28, 10), { schedules: [slot(WEEKDAYS, "07:00", "14:00")], session: null });
    assert.deepEqual(state, {
      active: true,
      source: "schedule",
      until: at(2026, 9, 28, 14),
      startedAt: at(2026, 9, 28, 7),
      nextStart: null,
    });
  });

  test("a disabled schedule does not block", () => {
    const schedules = [slot(WEEKDAYS, "07:00", "14:00", { enabled: false })];
    assert.deepEqual(blockState(at(2026, 9, 28, 10), { schedules, session: null }), inactive);
  });

  test("invalid schedule entries are ignored", () => {
    const schedules = [null, "x", { days: [] }, slot([1], "09:00", "09:00"), slot([1], "07:00", "14:00")];
    assert.equal(blockState(at(2026, 9, 28, 10), { schedules }).active, true);
    assert.equal(blockState(at(2026, 9, 28, 10), { schedules: "nope" }).active, false);
  });

  test("inactive state reports the next scheduled start", () => {
    // Sunday noon: next weekday block is Monday 07:00.
    const state = blockState(at(2026, 9, 27, 12), { schedules: [slot(WEEKDAYS, "07:00", "14:00")] });
    assert.deepEqual(state, { ...inactive, nextStart: at(2026, 9, 28, 7) });
  });

  test("next start ignores disabled slots and picks the earliest enabled one", () => {
    const schedules = [
      slot([1], "08:00", "09:00", { enabled: false }),
      slot([1], "10:00", "11:00"),
      slot([2], "06:00", "07:00"),
    ];
    assert.equal(blockState(at(2026, 9, 28, 7), { schedules }).nextStart, at(2026, 9, 28, 10));
  });

  test("a weekly slot is always found within the lookahead", () => {
    // Monday only, asked right after it ended: next Monday, 7 days later.
    const state = blockState(at(2026, 9, 28, 14), { schedules: [slot([1], "07:00", "14:00")] });
    assert.equal(state.active, false);
    assert.equal(state.nextStart, at(2026, 10, 5, 7));
    assert.ok(state.nextStart - at(2026, 9, 28, 14) <= LOOKAHEAD_DAYS * DAY);
  });

  test("boundaries are half open: active at start, inactive at end", () => {
    const schedules = [slot([1], "07:00", "14:00")];
    assert.equal(blockState(at(2026, 9, 28, 7), { schedules }).active, true);
    const atEnd = blockState(at(2026, 9, 28, 14), { schedules });
    assert.equal(atEnd.active, false);
    assert.equal(atEnd.until, null);
  });

  test("overnight slot is active after midnight with the right start and end", () => {
    const state = blockState(at(2026, 9, 29, 1), { schedules: [slot([1], "22:00", "02:00")] });
    assert.equal(state.active, true);
    assert.equal(state.startedAt, at(2026, 9, 28, 22));
    assert.equal(state.until, at(2026, 9, 29, 2));
  });

  test("overnight slot does not apply to the day after the listed day", () => {
    // Monday only: Tuesday 23:00 is free.
    const state = blockState(at(2026, 9, 29, 23), { schedules: [slot([1], "22:00", "02:00")] });
    assert.equal(state.active, false);
    assert.equal(state.nextStart, at(2026, 10, 5, 22));
  });

  test("touching slots merge into one continuous period", () => {
    const schedules = [slot([1], "07:00", "10:00"), slot([1], "10:00", "12:00")];
    const state = blockState(at(2026, 9, 28, 8), { schedules });
    assert.equal(state.until, at(2026, 9, 28, 12));
    assert.equal(state.startedAt, at(2026, 9, 28, 7));
  });

  test("overlapping slots merge, whatever their order", () => {
    const schedules = [slot([1], "10:00", "12:00"), slot([1], "07:00", "11:00")];
    const state = blockState(at(2026, 9, 28, 11, 30), { schedules });
    assert.equal(state.startedAt, at(2026, 9, 28, 7));
    assert.equal(state.until, at(2026, 9, 28, 12));
  });

  test("a slot fully inside another does not shorten it", () => {
    const schedules = [slot([1], "07:00", "14:00"), slot([1], "09:00", "10:00")];
    assert.equal(blockState(at(2026, 9, 28, 9, 30), { schedules }).until, at(2026, 9, 28, 14));
  });

  test("an overnight slot chains with a slot starting at its end the next day", () => {
    const schedules = [slot([1], "22:00", "02:00"), slot([2], "02:00", "06:00")];
    const state = blockState(at(2026, 9, 28, 23), { schedules });
    assert.equal(state.until, at(2026, 9, 29, 6));
    assert.equal(state.startedAt, at(2026, 9, 28, 22));
  });

  test("an evening slot ending at midnight chains with an early morning slot", () => {
    const schedules = [slot([1], "20:00", "00:00"), slot([2], "00:00", "03:00")];
    assert.equal(blockState(at(2026, 9, 28, 21), { schedules }).until, at(2026, 9, 29, 3));
    assert.equal(blockState(at(2026, 9, 29, 1), { schedules }).startedAt, at(2026, 9, 28, 20));
  });

  test("a one minute gap is not merged", () => {
    const schedules = [slot([1], "07:00", "10:00"), slot([1], "10:01", "12:00")];
    assert.equal(blockState(at(2026, 9, 28, 8), { schedules }).until, at(2026, 9, 28, 10));
    const inGap = blockState(at(2026, 9, 28, 10), { schedules });
    assert.equal(inGap.active, false);
    assert.equal(inGap.nextStart, at(2026, 9, 28, 10, 1));
  });

  test("a manual session alone", () => {
    const now = at(2026, 9, 28, 16);
    const session = { startedAt: now - 5 * MINUTE, endsAt: now + 20 * MINUTE };
    assert.deepEqual(blockState(now, { schedules: [], session }), {
      active: true,
      source: "session",
      until: session.endsAt,
      startedAt: session.startedAt,
      nextStart: null,
    });
  });

  test("an expired session, or one ending exactly now, is inactive", () => {
    const now = at(2026, 9, 28, 16);
    assert.equal(blockState(now, { session: { startedAt: now - HOUR, endsAt: now - 1 } }).active, false);
    assert.equal(blockState(now, { session: { startedAt: now - HOUR, endsAt: now } }).active, false);
    assert.equal(blockState(now, { session: { startedAt: now - HOUR, endsAt: "later" } }).active, false);
  });

  test("session without startedAt, or starting in the future, starts now", () => {
    const now = at(2026, 9, 28, 16);
    assert.equal(blockState(now, { session: { endsAt: now + HOUR } }).startedAt, now);
    assert.equal(blockState(now, { session: { startedAt: now + MINUTE, endsAt: now + HOUR } }).startedAt, now);
  });

  test("session and schedule overlapping: source both, merged period", () => {
    const now = at(2026, 9, 28, 13);
    const session = { startedAt: now, endsAt: at(2026, 9, 28, 15) };
    const state = blockState(now, { schedules: [slot(WEEKDAYS, "07:00", "14:00")], session });
    assert.deepEqual(state, {
      active: true,
      source: "both",
      until: at(2026, 9, 28, 15),
      startedAt: at(2026, 9, 28, 7),
      nextStart: null,
    });
  });

  test("session touching the next scheduled block extends the countdown", () => {
    const now = at(2026, 9, 28, 6, 30);
    const session = { startedAt: now, endsAt: at(2026, 9, 28, 7) };
    const state = blockState(now, { schedules: [slot(WEEKDAYS, "07:00", "14:00")], session });
    assert.equal(state.source, "session");
    assert.equal(state.until, at(2026, 9, 28, 14));
    assert.equal(state.startedAt, now);
  });

  test("session ending before the next block does not merge with it", () => {
    const now = at(2026, 9, 28, 6);
    const session = { startedAt: now, endsAt: at(2026, 9, 28, 6, 30) };
    const state = blockState(now, { schedules: [slot(WEEKDAYS, "07:00", "14:00")], session });
    assert.equal(state.until, at(2026, 9, 28, 6, 30));
  });

  test("a session inside a scheduled block keeps the block's bounds", () => {
    const now = at(2026, 9, 28, 9);
    const session = { startedAt: now, endsAt: now + 10 * MINUTE };
    const state = blockState(now, { schedules: [slot(WEEKDAYS, "07:00", "14:00")], session });
    assert.equal(state.source, "both");
    assert.equal(state.until, at(2026, 9, 28, 14));
    assert.equal(state.startedAt, at(2026, 9, 28, 7));
  });

  test("a block running around the clock is clipped to the lookahead in both directions", () => {
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    const schedules = [slot(everyDay, "00:00", "12:00"), slot(everyDay, "12:00", "00:00")];
    const now = at(2026, 9, 28, 10);
    const state = blockState(now, { schedules });
    assert.equal(state.active, true);
    assert.equal(state.until, now + LOOKAHEAD_DAYS * DAY);
    assert.equal(state.startedAt, now - LOOKAHEAD_DAYS * DAY);
  });

  test("a weekend long block is merged across nights", () => {
    const schedules = [slot([5], "18:00", "00:00"), slot([6], "00:00", "23:59"), slot([6], "23:59", "08:00")];
    const state = blockState(at(2026, 10, 3, 12), { schedules });
    assert.equal(state.startedAt, at(2026, 10, 2, 18));
    assert.equal(state.until, at(2026, 10, 4, 8));
  });

  test("non finite now returns an inactive state", () => {
    assert.deepEqual(blockState(NaN, { schedules: [slot(WEEKDAYS, "07:00", "14:00")] }), inactive);
  });
});

describe("nextTransition", () => {
  test("null when nothing is configured", () => {
    assert.equal(nextTransition(at(2026, 9, 28, 10), { schedules: [], session: null, passes: {} }), null);
    assert.equal(nextTransition(at(2026, 9, 28, 10), {}), null);
    assert.equal(nextTransition(at(2026, 9, 28, 10)), null);
  });

  test("session end", () => {
    const now = at(2026, 9, 28, 10);
    assert.equal(nextTransition(now, { session: { startedAt: now, endsAt: now + 20 * MINUTE } }), now + 20 * MINUTE);
  });

  test("expired session and passes are ignored", () => {
    const now = at(2026, 9, 28, 10);
    const result = nextTransition(now, {
      session: { startedAt: now - HOUR, endsAt: now - MINUTE },
      passes: { "linkedin.com": now - 1, "x.com": now },
    });
    assert.equal(result, null);
  });

  test("the earliest pass expiry wins over a later session end", () => {
    const now = at(2026, 9, 28, 10);
    const result = nextTransition(now, {
      session: { startedAt: now, endsAt: now + 30 * MINUTE },
      passes: { "linkedin.com": now + 10 * MINUTE, "x.com": now + 5 * MINUTE, bad: "soon" },
    });
    assert.equal(result, now + 5 * MINUTE);
  });

  test("upcoming slot start when outside a slot", () => {
    assert.equal(nextTransition(at(2026, 9, 27, 12), { schedules: [slot(WEEKDAYS, "07:00", "14:00")] }), at(2026, 9, 28, 7));
  });

  test("slot end when inside a slot, strictly after now", () => {
    const schedules = [slot(WEEKDAYS, "07:00", "14:00")];
    assert.equal(nextTransition(at(2026, 9, 28, 10), { schedules }), at(2026, 9, 28, 14));
    assert.equal(nextTransition(at(2026, 9, 28, 7), { schedules }), at(2026, 9, 28, 14));
    assert.equal(nextTransition(at(2026, 9, 28, 14), { schedules }), at(2026, 9, 29, 7));
  });

  test("overnight slot end after midnight", () => {
    assert.equal(nextTransition(at(2026, 9, 28, 23), { schedules: [slot([1], "22:00", "02:00")] }), at(2026, 9, 29, 2));
  });

  test("disabled slots are ignored", () => {
    const schedules = [slot(WEEKDAYS, "07:00", "14:00", { enabled: false })];
    assert.equal(nextTransition(at(2026, 9, 28, 10), { schedules }), null);
  });

  test("picks the earliest across schedules, session and passes", () => {
    const now = at(2026, 9, 28, 6, 50);
    const result = nextTransition(now, {
      schedules: [slot(WEEKDAYS, "07:00", "14:00")],
      session: { startedAt: now, endsAt: now + 20 * MINUTE },
      passes: { "reddit.com": now + 15 * MINUTE },
    });
    assert.equal(result, at(2026, 9, 28, 7));
  });
});
