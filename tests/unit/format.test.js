import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  formatBadge,
  formatClock,
  formatCountdown,
  formatDurationShort,
  formatWeekdayClock,
  localDayKey,
} from "../../extension/shared/format.js";
import { at, HOUR, MINUTE } from "./helpers.js";

const SECOND = 1000;

describe("formatCountdown", () => {
  const cases = [
    [0, "0:00"],
    [-5000, "0:00"],
    [NaN, "0:00"],
    [undefined, "0:00"],
    [1, "0:01"],
    [999, "0:01"],
    [SECOND, "0:01"],
    [SECOND + 1, "0:02"],
    [9 * MINUTE + 5 * SECOND, "9:05"],
    [59 * MINUTE + 59 * SECOND, "59:59"],
    [59 * MINUTE + 59 * SECOND + 1, "1:00:00"],
    [HOUR, "1:00:00"],
    [HOUR + 2 * MINUTE + 3 * SECOND, "1:02:03"],
    [10 * HOUR, "10:00:00"],
  ];
  for (const [ms, expected] of cases) {
    test(`${ms} ms -> ${expected}`, () => assert.equal(formatCountdown(ms), expected));
  }
});

describe("formatDurationShort", () => {
  const cases = [
    [0, "0 min"],
    [-MINUTE, "0 min"],
    [30 * SECOND, "1 min"],
    [45 * MINUTE, "45 min"],
    [59 * MINUTE + 1, "1 h"],
    [HOUR, "1 h"],
    [HOUR + 5 * MINUTE, "1 h 05"],
    [2 * HOUR + 30 * MINUTE, "2 h 30"],
    [12 * HOUR, "12 h"],
  ];
  for (const [ms, expected] of cases) {
    test(`${ms} ms -> ${expected} in en and fr`, () => {
      assert.equal(formatDurationShort(ms, "en"), expected);
      assert.equal(formatDurationShort(ms, "fr"), expected);
    });
  }
});

describe("formatBadge", () => {
  const cases = [
    [0, ""],
    [-1, ""],
    [NaN, ""],
    [1, "1m"],
    [25 * MINUTE, "25m"],
    [59 * MINUTE, "59m"],
    [59 * MINUTE + 1, "1h00"],
    [HOUR, "1h00"],
    [HOUR + 5 * MINUTE, "1h05"],
    [9 * HOUR + 59 * MINUTE, "9h59"],
    [9 * HOUR + 59 * MINUTE + 1, "10h+"],
    [24 * HOUR, "10h+"],
  ];
  for (const [ms, expected] of cases) {
    test(`${ms} ms -> ${JSON.stringify(expected)}`, () => assert.equal(formatBadge(ms), expected));
  }

  test("never longer than 4 characters", () => {
    for (let minutes = 1; minutes < 1000; minutes++) assert.ok(formatBadge(minutes * MINUTE).length <= 4);
  });
});

describe("formatClock", () => {
  test("French uses 24h with two digit hours", () => {
    assert.equal(formatClock(at(2026, 9, 28, 14), "fr"), "14:00");
    assert.equal(formatClock(at(2026, 9, 28, 7, 5), "fr"), "07:05");
    assert.equal(formatClock(at(2026, 9, 28, 0, 0), "fr"), "00:00");
  });

  test("English uses 12h with AM/PM", () => {
    assert.match(formatClock(at(2026, 9, 28, 14), "en"), /^2:00\sPM$/);
    assert.match(formatClock(at(2026, 9, 28, 7, 5), "en"), /^7:05\sAM$/);
  });

  test("invalid input gives an empty string, invalid locale falls back", () => {
    assert.equal(formatClock(NaN, "en"), "");
    assert.match(formatClock(at(2026, 9, 28, 14), "not a locale!"), /2:00|14:00/);
    assert.match(formatClock(at(2026, 9, 28, 14), undefined), /2:00|14:00/);
  });
});

describe("formatWeekdayClock", () => {
  test("weekday then time", () => {
    // 28 September 2026 is a Monday.
    assert.equal(formatWeekdayClock(at(2026, 9, 28, 7), "fr"), "lundi 07:00");
    assert.match(formatWeekdayClock(at(2026, 9, 28, 7), "en"), /^Monday 7:00\sAM$/);
    assert.equal(formatWeekdayClock(at(2026, 10, 4, 22, 30), "fr"), "dimanche 22:30");
  });

  test("invalid input gives an empty string", () => {
    assert.equal(formatWeekdayClock(undefined, "fr"), "");
  });
});

describe("localDayKey", () => {
  test("local calendar day, zero padded", () => {
    assert.equal(localDayKey(at(2026, 9, 27, 23, 59)), "2026-09-27");
    assert.equal(localDayKey(at(2026, 9, 28, 0, 0)), "2026-09-28");
    assert.equal(localDayKey(at(2026, 1, 5, 12)), "2026-01-05");
  });
});
