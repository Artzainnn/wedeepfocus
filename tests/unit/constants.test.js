import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as constants from "../../extension/shared/constants.js";
import { isValidSlot } from "../../extension/shared/schedule.js";

describe("constants", () => {
  test("values from the spec", () => {
    assert.equal(constants.PASS_MINUTES, 10);
    assert.deepEqual(constants.SESSION_PRESETS, [15, 30, 60]);
    assert.equal(constants.SESSION_MIN, 1);
    assert.equal(constants.SESSION_MAX, 480);
    assert.equal(constants.EXTEND_MINUTES, 15);
    assert.equal(constants.MAX_CUSTOM_DOMAINS, 200);
    assert.equal(constants.GOAL_MAX_LENGTH, 140);
    assert.equal(constants.GOAL_COUNT, 1);
    assert.equal(constants.LOOKAHEAD_DAYS, 8);
    assert.match(constants.COFFEE_URLS.fr, /^https:\/\/buy\.stripe\.com\//);
    assert.match(constants.COFFEE_URLS.other, /^https:\/\/buy\.stripe\.com\//);
    assert.deepEqual(constants.CATEGORY_IDS, ["social", "video", "messaging", "news", "shopping"]);
    assert.equal(constants.PHRASE_MIN, 40);
    assert.equal(constants.PHRASE_MAX, 300);
    assert.equal(constants.RESET_DURING_BLOCK, true);
  });

  test("V3 groups and badge", () => {
    assert.equal(constants.MAX_GROUPS, 20);
    assert.equal(constants.MAX_GROUP_DOMAINS, 100);
    assert.equal(constants.GROUP_NAME_MAX, 30);
    assert.deepEqual(constants.GROUP_ICONS, [
      "users", "play", "mail", "news", "cart", "chat", "game", "music",
      "briefcase", "heart", "star", "globe", "book", "sparkles", "target", "coffee",
    ]);
    assert.ok(Object.isFrozen(constants.GROUP_ICONS));
    assert.ok(constants.GROUP_ICONS.includes(constants.DEFAULT_GROUP_ICON));
    assert.equal(constants.BADGE_COLOR, "#4f7df0");
  });

  test("SETTINGS_KEYS lists the six sync keys in order", () => {
    assert.deepEqual(constants.SETTINGS_KEYS, ["groups", "sites", "schedules", "goals", "prefs", "unlock"]);
    assert.ok(Object.isFrozen(constants.SETTINGS_KEYS));
  });

  test("default settings: own sites empty, no schedule, one empty goal, quote on, not onboarded, default phrase, free", () => {
    assert.deepEqual(constants.DEFAULT_SETTINGS, {
      sites: { custom: [] },
      schedules: [],
      goals: { items: [""], showQuote: true },
      prefs: { onboarded: false },
      unlock: { phrase: "", mode: "free", amount: 5 },
    });
  });

  test("V4 ending a session early: modes, amounts and payment server", () => {
    assert.deepEqual(constants.UNLOCK_MODES, ["free", "money"]);
    assert.ok(Object.isFrozen(constants.UNLOCK_MODES));
    assert.deepEqual(constants.PAYMENT_AMOUNTS, [2, 5, 10, 20]);
    assert.ok(Object.isFrozen(constants.PAYMENT_AMOUNTS));
    assert.deepEqual({ ...constants.PAYMENT_CURRENCIES }, { fr: "EUR", other: "USD" });
    assert.equal(constants.DEFAULT_AMOUNT, 5);
    assert.equal(constants.CUSTOM_AMOUNT_MIN, 1);
    assert.equal(constants.CUSTOM_AMOUNT_MAX, 500);
    assert.match(constants.PAYMENT_API, /^https:\/\/[^/]+$/, "an https origin without a trailing slash");
  });

  test("the default unlock is valid: free mode, a preset amount within the custom range", () => {
    const { unlock } = constants.DEFAULT_SETTINGS;
    assert.ok(constants.UNLOCK_MODES.includes(unlock.mode));
    assert.equal(unlock.amount, constants.DEFAULT_AMOUNT);
    assert.ok(constants.PAYMENT_AMOUNTS.includes(constants.DEFAULT_AMOUNT));
    for (const amount of constants.PAYMENT_AMOUNTS) {
      assert.ok(Number.isInteger(amount) && amount >= constants.CUSTOM_AMOUNT_MIN && amount <= constants.CUSTOM_AMOUNT_MAX);
    }
  });

  test("the honor system constants of the first V4 draft are gone (SPEC 13.8)", () => {
    assert.ok(!("PAYMENT_LINKS" in constants));
    assert.ok(!("CONFIRM_DELAY_SECONDS" in constants));
  });

  test("default settings leave groups out (they depend on the locale) and hold GOAL_COUNT goals", () => {
    assert.ok(!("groups" in constants.DEFAULT_SETTINGS));
    assert.deepEqual(
      Object.keys(constants.DEFAULT_SETTINGS),
      constants.SETTINGS_KEYS.filter((key) => key !== "groups"),
    );
    assert.equal(constants.DEFAULT_SETTINGS.goals.items.length, constants.GOAL_COUNT);
  });

  test("defaults are deeply frozen and clone into mutable copies", () => {
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS));
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS.sites));
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS.sites.custom));
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS.goals.items));
    assert.ok(Object.isFrozen(constants.DEFAULT_SETTINGS.unlock));
    assert.throws(() => {
      constants.DEFAULT_SETTINGS.prefs.onboarded = true;
    }, TypeError);
    const copy = structuredClone(constants.DEFAULT_SETTINGS);
    copy.prefs.onboarded = true;
    assert.equal(copy.prefs.onboarded, true);
  });

  test("every sync key stays far below the 8 KB per item quota", () => {
    for (const value of Object.values(constants.DEFAULT_SETTINGS)) {
      assert.ok(JSON.stringify(value).length < 8192);
    }
  });

  test("DEFAULT_SLOT is a valid Monday to Friday 09:00 to 12:00 slot", () => {
    assert.deepEqual({ ...constants.DEFAULT_SLOT }, { days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", enabled: true });
    assert.ok(isValidSlot(constants.DEFAULT_SLOT));
    assert.ok(Object.isFrozen(constants.DEFAULT_SLOT.days));
  });
});
