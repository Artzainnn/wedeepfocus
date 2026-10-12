// DST checks in fixed time zones. process.env.TZ must be set before the first Date use, so each
// zone runs in a child Node process. Skipped if the zone database is not available.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const scheduleUrl = new URL("../../extension/shared/schedule.js", import.meta.url).href;
const HOUR = 60 * 60 * 1000;

function runInZone(timeZone, body) {
  const script = `
    const { slotOccurrences, blockState, nextTransition } = await import(${JSON.stringify(scheduleUrl)});
    const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
    const slot = (days, start, end) => ({ id: "s", days, start, end, enabled: true });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const out = {};
    ${body}
    process.stdout.write(JSON.stringify({ zone, ...out }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: timeZone },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || `child exited with ${result.status}`);
  return JSON.parse(result.stdout);
}

function zoneAvailable(timeZone) {
  try {
    const out = runInZone(timeZone, "out.winter = new Date(2026, 0, 15).getTimezoneOffset(); out.summer = new Date(2026, 6, 15).getTimezoneOffset();");
    return out.zone === timeZone && out.winter !== out.summer;
  } catch {
    return false;
  }
}

const paris = zoneAvailable("Europe/Paris");
const newYork = zoneAvailable("America/New_York");

describe("schedule across DST in Europe/Paris", { skip: !paris && "Europe/Paris zone data unavailable" }, () => {
  const out = paris
    ? runInZone(
        "Europe/Paris",
        `
        const night = slot([6], "22:00", "04:00");
        const [fallBack] = slotOccurrences(night, at(2026, 10, 24, 12), at(2026, 10, 25, 12));
        out.fallBackLength = fallBack.end - fallBack.start;
        const [springForward] = slotOccurrences(night, at(2026, 3, 28, 12), at(2026, 3, 29, 12));
        out.springForwardLength = springForward.end - springForward.start;

        out.gap = slotOccurrences(slot([0], "02:15", "02:45"), at(2026, 3, 29), at(2026, 3, 30))
          .map((o) => ({ hour: new Date(o.start).getHours(), minutes: new Date(o.start).getMinutes(), length: o.end - o.start }));
        out.collapsed = slotOccurrences(slot([0], "02:00", "03:00"), at(2026, 3, 29), at(2026, 3, 30));
        const [ambiguous] = slotOccurrences(slot([0], "02:00", "03:00"), at(2026, 10, 25), at(2026, 10, 26));
        out.ambiguousLength = ambiguous.end - ambiguous.start;

        const daily = slotOccurrences(slot([0, 1, 2, 3, 4, 5, 6], "09:00", "17:00"), at(2026, 10, 22), at(2026, 10, 28));
        out.dailyHours = daily.map((o) => [new Date(o.start).getHours(), new Date(o.end).getHours()]);
        out.dailyGaps = daily.slice(1).map((o, i) => o.start - daily[i].start);

        const before = at(2026, 10, 24, 23);
        const stateBefore = blockState(before, { schedules: [night] });
        out.remainingBefore = stateBefore.until - before;
        const after = at(2026, 10, 25, 3, 30);
        const stateAfter = blockState(after, { schedules: [night] });
        out.remainingAfter = stateAfter.until - after;
        out.elapsedAfter = after - stateAfter.startedAt;

        const saturdayNoon = at(2026, 3, 28, 12);
        const idle = blockState(saturdayNoon, { schedules: [slot([1], "07:00", "14:00")] });
        out.nextStartDelay = idle.nextStart - saturdayNoon;
        out.nextStartHour = new Date(idle.nextStart).getHours();
        out.transitionDelay = nextTransition(saturdayNoon, { schedules: [slot([1], "07:00", "14:00")] }) - saturdayNoon;

        const merged = blockState(at(2026, 10, 25, 1), { schedules: [night, slot([0], "04:00", "06:00")] });
        out.mergedLength = merged.until - merged.startedAt;
        `,
      )
    : {};

  test("overnight slot on the fall back night lasts 7 real hours", () => {
    assert.equal(out.fallBackLength, 7 * HOUR);
  });

  test("overnight slot on the spring forward night lasts 5 real hours", () => {
    assert.equal(out.springForwardLength, 5 * HOUR);
  });

  test("a slot inside the spring forward gap is shifted by the engine to 03:15", () => {
    assert.deepEqual(out.gap, [{ hour: 3, minutes: 15, length: 0.5 * HOUR }]);
  });

  test("a slot exactly covering the missing hour collapses and is skipped", () => {
    assert.deepEqual(out.collapsed, []);
  });

  test("02:00 to 03:00 on the fall back day covers the repeated hour", () => {
    assert.equal(out.ambiguousLength, 2 * HOUR);
  });

  test("daily slots keep their wall clock hours and one day is 25 hours long", () => {
    assert.ok(out.dailyHours.every(([start, end]) => start === 9 && end === 17));
    assert.deepEqual(out.dailyGaps.filter((gap) => gap !== 24 * HOUR), [25 * HOUR]);
  });

  test("countdowns use real elapsed time across the change", () => {
    assert.equal(out.remainingBefore, 6 * HOUR);
    assert.equal(out.remainingAfter, 0.5 * HOUR);
    assert.equal(out.elapsedAfter, 6.5 * HOUR);
  });

  test("next start and next transition across the spring forward weekend", () => {
    assert.equal(out.nextStartDelay, 42 * HOUR);
    assert.equal(out.nextStartHour, 7);
    assert.equal(out.transitionDelay, 42 * HOUR);
  });

  test("merging across the change keeps real durations", () => {
    // Saturday 22:00 CEST to Sunday 06:00 CET.
    assert.equal(out.mergedLength, 9 * HOUR);
  });
});

describe("schedule across DST in America/New_York", { skip: !newYork && "America/New_York zone data unavailable" }, () => {
  const out = newYork
    ? runInZone(
        "America/New_York",
        `
        const night = slot([6], "22:00", "04:00");
        const [spring] = slotOccurrences(night, at(2026, 3, 7, 12), at(2026, 3, 8, 12));
        out.springLength = spring.end - spring.start;
        const [fall] = slotOccurrences(night, at(2026, 10, 31, 12), at(2026, 11, 1, 12));
        out.fallLength = fall.end - fall.start;
        out.gap = slotOccurrences(slot([0], "02:10", "02:50"), at(2026, 3, 8), at(2026, 3, 9))
          .map((o) => ({ hour: new Date(o.start).getHours(), length: o.end - o.start }));
        out.collapsed = slotOccurrences(slot([0], "02:00", "03:00"), at(2026, 3, 8), at(2026, 3, 9));
        const now = at(2026, 3, 8, 3, 30);
        const state = blockState(now, { schedules: [night] });
        out.remaining = state.until - now;
        out.elapsed = now - state.startedAt;
        `,
      )
    : {};

  test("overnight slot lengths on both change nights", () => {
    assert.equal(out.springLength, 5 * HOUR);
    assert.equal(out.fallLength, 7 * HOUR);
  });

  test("a slot inside the gap is shifted one hour later, a slot equal to the gap is skipped", () => {
    assert.deepEqual(out.gap, [{ hour: 3, length: (40 / 60) * HOUR }]);
    assert.deepEqual(out.collapsed, []);
  });

  test("countdown right after the spring forward jump", () => {
    assert.equal(out.remaining, 0.5 * HOUR);
    assert.equal(out.elapsed, 4.5 * HOUR);
  });
});
