// When the popup asks for a store rating: after a first completed block, never during one, at most
// twice with "Not now", never again once the store page was opened.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RATE_LATER_DAYS, RATE_MAX_LATER, cleanRatePrefs, completedBlocks, rateLater, reviewUrl, shouldAskRating } from "../../extension/shared/rating.js";
import { REVIEW_URL } from "../../extension/shared/config.js";

const NOW = Date.UTC(2026, 9, 23, 9);
const DAY = 86_400_000;
const done = { days: { "2026-10-21": { completed: 1, focusMs: 1_800_000 } } };
const ask = (overrides = {}) => shouldAskRating({ history: done, active: false, prefs: null, now: NOW, ...overrides });

describe("reviewUrl", () => {
  test("is the store's review page, over https", () => {
    assert.equal(reviewUrl(), new URL(REVIEW_URL).href);
    assert.equal(new URL(reviewUrl()).protocol, "https:");
  });
});

describe("completedBlocks", () => {
  test("adds up blocks that ran to their end, ignoring those ended early and bad data", () => {
    assert.equal(completedBlocks(null), 0);
    assert.equal(completedBlocks({ days: { "2026-10-20": { endedFree: 3 } } }), 0);
    assert.equal(completedBlocks({ days: { "2026-10-20": { completed: 2 }, "2026-10-21": { completed: 1 }, nope: { completed: 9 } } }), 3);
  });
});

describe("shouldAskRating", () => {
  test("asks once a first block has run to its end", () => {
    assert.equal(ask(), true);
    assert.equal(ask({ history: null }), false, "no block yet");
    assert.equal(ask({ history: { days: { "2026-10-21": { endedFree: 1 } } } }), false, "a block ended early is not enough");
  });

  test("never during a block, and never without a store page", () => {
    assert.equal(ask({ active: true }), false);
    assert.equal(ask({ url: "" }), false);
  });

  test("stops once the store page was opened", () => {
    assert.equal(ask({ prefs: { rated: true } }), false);
  });

  test('"Not now" waits two weeks, and the second one is the last', () => {
    const once = rateLater(null, NOW);
    assert.deepEqual(once, { rated: false, later: 1, until: NOW + RATE_LATER_DAYS * DAY });
    assert.equal(ask({ prefs: once, now: NOW + DAY }), false);
    assert.equal(ask({ prefs: once, now: once.until }), true);
    const twice = rateLater(once, once.until);
    assert.equal(twice.later, RATE_MAX_LATER);
    assert.equal(ask({ prefs: twice, now: twice.until + 365 * DAY }), false);
  });

  test("bad stored values count as no answer", () => {
    assert.deepEqual(cleanRatePrefs("x"), { rated: false, later: 0, until: 0 });
    assert.deepEqual(cleanRatePrefs({ rated: "yes", later: -2, until: "soon" }), { rated: false, later: 0, until: 0 });
    assert.equal(ask({ prefs: { later: "9", until: NaN } }), true);
  });
});
