// The generated _locales: en and fr must expose the same keys with the same placeholders, and every
// key the extension uses must exist. scripts/build-locales.mjs runs first, so this checks what ships.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHRASE_MAX, PHRASE_MIN } from "../../extension/shared/constants.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const LANGS = ["en", "fr"];

function buildLocales(...flags) {
  return spawnSync(process.execPath, [path.join(root, "scripts", "build-locales.mjs"), "--quiet", ...flags], {
    cwd: root,
    encoding: "utf8",
  });
}

function readMessages(lang) {
  const file = path.join(root, "extension", "_locales", lang, "messages.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

// Chrome placeholder names are case insensitive.
function declaredPlaceholders(entry) {
  return Object.keys(entry?.placeholders ?? {}).map((name) => name.toLowerCase()).sort();
}

// $name$ references in a message text, read left to right ("$$" is an escaped dollar sign).
function usedPlaceholders(message) {
  const names = new Set();
  for (let index = 0; index < message.length; index++) {
    if (message[index] !== "$") continue;
    if (message[index + 1] === "$") {
      index++;
      continue;
    }
    const end = message.indexOf("$", index + 1);
    if (end === -1) break;
    names.add(message.slice(index + 1, end).toLowerCase());
    index = end;
  }
  return [...names].sort();
}

describe("generated locales", () => {
  let build;
  const messages = {};

  before(() => {
    build = buildLocales();
    for (const lang of LANGS) messages[lang] = readMessages(lang);
  });

  test("scripts/build-locales.mjs succeeds", () => {
    assert.equal(build.status, 0, build.stderr || build.error?.message);
  });

  test("en and fr messages.json exist", () => {
    for (const lang of LANGS) assert.ok(messages[lang], `extension/_locales/${lang}/messages.json is missing`);
  });

  test("en and fr have exactly the same keys", () => {
    const { en, fr } = messages;
    const onlyEn = Object.keys(en).filter((key) => !Object.hasOwn(fr, key));
    const onlyFr = Object.keys(fr).filter((key) => !Object.hasOwn(en, key));
    assert.deepEqual({ onlyEn, onlyFr }, { onlyEn: [], onlyFr: [] });
  });

  test("each key declares the same placeholder names in en and fr", () => {
    const { en, fr } = messages;
    const mismatched = Object.keys(en)
      .filter((key) => Object.hasOwn(fr, key))
      .filter((key) => declaredPlaceholders(en[key]).join() !== declaredPlaceholders(fr[key]).join())
      .map((key) => `${key}: en [${declaredPlaceholders(en[key])}] fr [${declaredPlaceholders(fr[key])}]`);
    assert.deepEqual(mismatched, []);
  });

  test("every message is a non empty string that uses exactly its declared placeholders", () => {
    const problems = [];
    for (const lang of LANGS) {
      for (const [key, entry] of Object.entries(messages[lang])) {
        if (typeof entry?.message !== "string" || !entry.message.trim()) {
          problems.push(`${lang} ${key}: empty message`);
        } else if (usedPlaceholders(entry.message).join() !== declaredPlaceholders(entry).join()) {
          problems.push(`${lang} ${key}: uses [${usedPlaceholders(entry.message)}], declares [${declaredPlaceholders(entry)}]`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });

  test("every i18n key used in extension/ is defined (build-locales --strict)", () => {
    const strict = buildLocales("--strict");
    assert.equal(strict.status, 0, strict.stderr || strict.error?.message);
  });

  test("the default unlock sentences follow the custom sentence rules", () => {
    for (const lang of LANGS) {
      const phrase = messages[lang].blocked_friction_phrase?.message;
      assert.equal(typeof phrase, "string", `${lang}: blocked_friction_phrase is missing`);
      assert.doesNotMatch(phrase, /[\r\n]/, `${lang}: the default sentence must be one line`);
      const length = phrase.replace(/\s+/g, " ").trim().length;
      assert.ok(length >= PHRASE_MIN && length <= PHRASE_MAX, `${lang}: ${length} characters`);
    }
  });
});
