// Checks i18n/common.json against the i18n contract. The no dash rule lives in no-dashes.test.js.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORY_IDS,
  MAX_CUSTOM_DOMAINS,
  PHRASE_MAX,
  PHRASE_MIN,
  SESSION_MAX,
  SESSION_MIN,
} from "../../extension/shared/constants.js";

const root = new URL("../../", import.meta.url);
const common = JSON.parse(readFileSync(new URL("i18n/common.json", root), "utf8"));

const REQUIRED = [
  "appName", "appShortName", "appDescription",
  "category_social", "category_video", "category_messaging", "category_news", "category_shopping",
  "common_save", "common_saved", "common_cancel", "common_add", "common_remove", "common_allow",
  "common_settings", "common_coffee", "common_back", "common_continue", "common_minutes_short",
  "reason_lock_group", "reason_lock_group_site", "reason_lock_custom", "reason_lock_schedule", "reason_lock_phrase",
  "reason_invalid_minutes", "reason_not_blocked", "reason_invalid_domain", "reason_duplicate_domain",
  "reason_too_many_domains", "reason_invalid_schedule", "reason_invalid_phrase", "reason_invalid_groups",
  "badge_title_active", "privacy_line",
];
const CAMEL_CASE_ALLOWED = new Set(["appName", "appShortName", "appDescription"]);
// Every refusal lock.checkChange can return (SPEC 12.3), shown to the user through reasonText().
const LOCK_REASONS = ["lock_group", "lock_group_site", "lock_custom", "lock_schedule", "lock_phrase"];
// V2 refusals nothing returns anymore.
const RETIRED = ["reason_lock_category", "reason_lock_exclude"];

function placeholders(text) {
  return [...text.matchAll(/\{(\d)\}/g)].map((match) => match[1]).sort();
}

describe("i18n/common.json", () => {
  test("contains every required key", () => {
    for (const key of REQUIRED) assert.ok(key in common, `missing ${key}`);
  });

  test("every lock refusal has a reason_ message", () => {
    for (const reason of LOCK_REASONS) assert.ok(`reason_${reason}` in common, `missing reason_${reason}`);
  });

  test("lock.js returns exactly the listed refusals", () => {
    const source = readFileSync(new URL("extension/shared/lock.js", root), "utf8");
    const found = [...source.matchAll(/\brefuse\(\s*"([a-z0-9_]+)"\s*\)/g)].map((match) => match[1]);
    assert.deepEqual(found.sort(), [...LOCK_REASONS].sort());
  });

  test("retired V2 refusals are gone", () => {
    for (const key of RETIRED) assert.ok(!(key in common), `${key} is no longer used`);
  });

  test("every refusal the background or api.js can return has a reason_ message", () => {
    const sources = ["background/logic.js", "background/service-worker.js", "shared/api.js"];
    const reasons = new Set();
    for (const file of sources) {
      const source = readFileSync(new URL(`extension/${file}`, root), "utf8");
      for (const match of source.matchAll(/\bfail\(\s*"([a-z0-9_]+)"\s*\)|\breason:\s*"([a-z0-9_]+)"/g)) {
        reasons.add(match[1] ?? match[2]);
      }
    }
    assert.ok(reasons.has("invalid_phrase") && reasons.has("invalid_groups"), "the scan finds the refusals");
    // An unexpected exception in the worker: shown with the generic reason_unknown on purpose.
    reasons.delete("internal_error");
    for (const reason of reasons) assert.ok(`reason_${reason}` in common, `missing reason_${reason}`);
  });

  test("every entry has non empty en, fr and a description, and nothing else", () => {
    for (const [key, entry] of Object.entries(common)) {
      assert.deepEqual(Object.keys(entry).sort(), ["description", "en", "fr"], key);
      for (const field of ["en", "fr", "description"]) {
        assert.equal(typeof entry[field], "string", `${key}.${field}`);
        assert.ok(entry[field].trim().length > 0, `${key}.${field} is empty`);
        assert.equal(entry[field], entry[field].trim(), `${key}.${field} has stray spaces`);
      }
    }
  });

  test("keys are lowercase with digits and underscores (app* keys excepted)", () => {
    for (const key of Object.keys(common)) {
      assert.ok(CAMEL_CASE_ALLOWED.has(key) || /^[a-z][a-z0-9_]*$/.test(key), key);
    }
  });

  test("placeholders use {n} and match between languages; no raw $ signs", () => {
    for (const [key, entry] of Object.entries(common)) {
      assert.deepEqual(placeholders(entry.fr), placeholders(entry.en), key);
      assert.ok(!entry.en.includes("$") && !entry.fr.includes("$"), `${key} contains $`);
    }
    assert.deepEqual(placeholders(common.common_minutes_short.en), ["1"]);
    assert.deepEqual(placeholders(common.badge_title_active.en), ["1"]);
  });

  test("limits written in the messages match the constants", () => {
    const expected = {
      reason_invalid_minutes: [SESSION_MIN, SESSION_MAX],
      reason_too_many_domains: [MAX_CUSTOM_DOMAINS],
      reason_invalid_phrase: [PHRASE_MIN, PHRASE_MAX],
    };
    for (const [key, numbers] of Object.entries(expected)) {
      for (const lang of ["en", "fr"]) {
        const written = (common[key][lang].match(/\d+/g) ?? []).map(Number);
        assert.deepEqual(written, numbers, `${key}.${lang}`);
      }
    }
  });

  test("store limits", () => {
    assert.ok(common.appDescription.en.length <= 132, `en is ${common.appDescription.en.length}`);
    assert.ok(common.appDescription.fr.length <= 132, `fr is ${common.appDescription.fr.length}`);
    assert.ok(common.appShortName.en.length <= 12 && common.appShortName.fr.length <= 12);
    assert.ok(common.appName.en.length <= 45 && common.appName.fr.length <= 45);
  });

  test("suggested texts", () => {
    assert.equal(common.appName.en, "WeDeepFocus");
    assert.equal(common.common_coffee.en, "Buy a dev a coffee");
    assert.equal(common.common_coffee.fr, "Offrir un café au dev");
    assert.equal(common.common_minutes_short.en, "{1} min");
    assert.equal(common.badge_title_active.en, "Blocking until {1}");
  });

  test("V3 copy stays short: refusals and errors are one sentence or two, 90 characters at most", () => {
    for (const [key, entry] of Object.entries(common)) {
      if (!key.startsWith("reason_")) continue;
      for (const lang of ["en", "fr"]) assert.ok(entry[lang].length <= 90, `${key}.${lang} is ${entry[lang].length} characters`);
    }
  });

  test("category names exist for every preset (group display names)", () => {
    for (const id of CATEGORY_IDS) assert.ok(`category_${id}` in common, `missing category_${id}`);
  });

  test("French speaks with tu, never vous", () => {
    for (const [key, entry] of Object.entries(common)) {
      assert.doesNotMatch(entry.fr, /\b(vous|votre|vos)\b/i, key);
    }
  });
});

describe("pure modules stay free of chrome and document", () => {
  const shared = ["constants", "schedule", "domains", "presets", "lock", "friction", "rules", "format"];
  const pure = [...shared.map((name) => `shared/${name}.js`), "background/logic.js"];
  for (const file of pure) {
    test(file, () => {
      const source = readFileSync(new URL(`extension/${file}`, root), "utf8").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(source, /\b(chrome|document|window)\s*[.[]/);
    });
  }
});
