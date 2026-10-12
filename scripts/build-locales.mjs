#!/usr/bin/env node
// Merges i18n/*.json part files into extension/_locales/{en,fr}/messages.json.
//
// Part file format: { "key": { "en": "...", "fr": "...", "description": "..." } }
// Positional placeholders are written {1}, {2} ... and become Chrome named
// placeholders p1, p2 ... with content $1, $2 ...
//
// Usage: node scripts/build-locales.mjs [--strict] [--quiet]
//   --strict  also fail when a key used by the manifest or the extension code is missing
//   --quiet   only print errors

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N_DIR = path.join(ROOT, "i18n");
const EXT_DIR = path.join(ROOT, "extension");
const LOCALES_DIR = path.join(EXT_DIR, "_locales");
const LANGS = ["en", "fr"];
const ALLOWED_FIELDS = new Set([...LANGS, "description"]);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const FORBIDDEN_CHARS = new Map([
  [0x2012, "figure dash (U+2012)"],
  [0x2013, "en dash (U+2013)"],
  [0x2014, "em dash (U+2014)"],
  [0x2015, "horizontal bar (U+2015)"],
].map(([code, name]) => [String.fromCodePoint(code), name]));
const AREA_PREFIX = {
  common: null,
  background: "bg_",
  popup: "popup_",
  options: "options_",
  onboarding: "onb_",
  blocked: "blocked_",
  stats: "stats_",
  home: "home_",
};
const MAX_LENGTH = { appDescription: 132, appShortName: 45, appName: 75 };

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const quiet = args.has("--quiet");

const errors = [];
const warnings = [];
const error = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

function findForbidden(text) {
  for (const [ch, name] of FORBIDDEN_CHARS) {
    if (text.includes(ch)) return name;
  }
  return null;
}

// Converts {N} (and tolerated bare $N) into $pN$ references, escapes literal "$".
function convertText(text, where) {
  const indices = new Set();
  let out = "";
  for (let i = 0; i < text.length; ) {
    const brace = /^\{([1-9])\}/.exec(text.slice(i));
    if (brace) {
      indices.add(Number(brace[1]));
      out += `$p${brace[1]}$`;
      i += brace[0].length;
      continue;
    }
    if (text[i] === "$") {
      const bare = /^\$([1-9])(?![0-9])/.exec(text.slice(i));
      if (bare) {
        warn(`${where}: "$${bare[1]}" converted to a placeholder, prefer writing {${bare[1]}}`);
        indices.add(Number(bare[1]));
        out += `$p${bare[1]}$`;
        i += bare[0].length;
        continue;
      }
      out += "$$";
      i += 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return { message: out, indices };
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

async function readParts() {
  if (!existsSync(I18N_DIR)) return [];
  const files = (await readdir(I18N_DIR)).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
  const parts = [];
  for (const file of files) {
    const full = path.join(I18N_DIR, file);
    const raw = await readFile(full, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      error(`i18n/${file}: invalid JSON (${e.message})`);
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      error(`i18n/${file}: top level must be an object of messages`);
      continue;
    }
    parts.push({ file, area: file.replace(/\.json$/, ""), data, raw });
  }
  return parts;
}

// JSON.parse silently keeps the last duplicate, so scan the raw text for repeated top level keys.
function duplicateTopLevelKeys(raw) {
  const seen = new Set();
  const dups = new Set();
  let depth = 0;
  let inString = false;
  let escaped = false;
  let token = "";
  let pendingKey = null; // last string closed at depth 1, until the next non-space char
  for (const ch of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        pendingKey = depth === 1 ? JSON.parse(`"${token}"`) : null;
        continue;
      }
      token += ch;
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (ch === ":" && pendingKey !== null) {
      if (seen.has(pendingKey)) dups.add(pendingKey);
      seen.add(pendingKey);
    }
    pendingKey = null;
    if (ch === '"') {
      inString = true;
      token = "";
    } else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return [...dups];
}

function buildMessages(parts) {
  const out = Object.fromEntries(LANGS.map((l) => [l, {}]));
  const owner = new Map(); // lowercased key -> "file:key" (Chrome keys are case-insensitive)

  for (const { file, area, data, raw } of parts) {
    for (const dup of duplicateTopLevelKeys(raw)) error(`i18n/${file}: key "${dup}" is defined twice in the same file`);

    const prefix = AREA_PREFIX[area];
    if (!(area in AREA_PREFIX)) warn(`i18n/${file}: unknown area, no key prefix enforced`);

    for (const key of Object.keys(data)) {
      const where = `i18n/${file} "${key}"`;
      const entry = data[key];

      if (!KEY_RE.test(key)) {
        error(`${where}: invalid key (letters, digits and underscore only, starting with a letter)`);
        continue;
      }
      if (prefix && !key.startsWith(prefix)) error(`${where}: keys in ${file} must start with "${prefix}"`);

      const lower = key.toLowerCase();
      if (owner.has(lower)) {
        error(`${where}: duplicate key, already defined in ${owner.get(lower)}`);
        continue;
      }
      owner.set(lower, `i18n/${file}`);

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        error(`${where}: value must be an object { en, fr, description }`);
        continue;
      }
      for (const field of Object.keys(entry)) {
        if (!ALLOWED_FIELDS.has(field)) error(`${where}: unexpected field "${field}" (allowed: ${[...ALLOWED_FIELDS].join(", ")}; placeholders are written {1}, {2} in the text)`);
      }
      if (entry.description !== undefined && typeof entry.description !== "string") error(`${where}: description must be a string`);
      if (typeof entry.description === "string") {
        const bad = findForbidden(entry.description);
        if (bad) error(`${where}: description contains an ${bad}`);
      }

      const converted = {};
      for (const lang of LANGS) {
        const text = entry[lang];
        if (typeof text !== "string" || text.trim() === "") {
          error(`${where}: missing or empty "${lang}" text`);
          continue;
        }
        const bad = findForbidden(text);
        if (bad) error(`${where}: "${lang}" text contains an ${bad}`);
        if (MAX_LENGTH[key] && [...text].length > MAX_LENGTH[key]) {
          error(`${where}: "${lang}" text is ${[...text].length} characters, max ${MAX_LENGTH[key]}`);
        }
        converted[lang] = convertText(text, `${where} (${lang})`);
      }
      if (converted.en && converted.fr && !sameSet(converted.en.indices, converted.fr.indices)) {
        error(`${where}: en and fr do not use the same placeholders ({${[...converted.en.indices].sort().join("},{")}} vs {${[...converted.fr.indices].sort().join("},{")}})`);
      }

      for (const lang of LANGS) {
        const c = converted[lang];
        if (!c) continue;
        const msg = { message: c.message };
        if (typeof entry.description === "string" && entry.description.trim()) msg.description = entry.description.trim();
        if (c.indices.size) {
          msg.placeholders = {};
          for (const n of [...c.indices].sort((a, b) => a - b)) msg.placeholders[`p${n}`] = { content: `$${n}` };
        }
        out[lang][key] = msg;
      }
    }
  }
  return out;
}

function sortedObject(obj) {
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

async function walk(dir) {
  const result = [];
  if (!existsSync(dir)) return result;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "_locales") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(full)));
    else if (/\.(js|mjs|html|json)$/.test(entry.name)) result.push(full);
  }
  return result;
}

// Literal keys referenced by the manifest (__MSG_x__), HTML (data-i18n*) and JS (t("x")).
async function referencedKeys() {
  const refs = new Map();
  const add = (key, file) => {
    if (key.startsWith("@@")) return;
    if (!refs.has(key)) refs.set(key, new Set());
    refs.get(key).add(path.relative(ROOT, file));
  };
  for (const file of await walk(EXT_DIR)) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) add(m[1], file);
    if (file.endsWith(".html")) {
      for (const m of text.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([A-Za-z0-9_]+)"/g)) add(m[1], file);
    }
    if (/\.m?js$/.test(file)) {
      for (const m of text.matchAll(/\b(?:t|getMessage)\(\s*["']([A-Za-z0-9_@]+)["']/g)) add(m[1], file);
    }
  }
  return refs;
}

async function writeIfChanged(file, content) {
  const current = existsSync(file) ? await readFile(file, "utf8") : null;
  if (current === content) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

async function main() {
  const parts = await readParts();
  if (parts.length === 0) warn("no part files found in i18n/, generating empty locales");

  const messages = buildMessages(parts);
  const known = new Set(Object.keys(messages.en).map((k) => k.toLowerCase()));

  const refs = await referencedKeys();
  const missing = [...refs.keys()].filter((k) => !known.has(k.toLowerCase())).sort();
  for (const key of missing) {
    const msg = `key "${key}" is used in ${[...refs.get(key)].sort().join(", ")} but defined in no i18n part`;
    if (strict) error(msg);
    else warn(msg);
  }

  if (errors.length) {
    console.error(`build-locales: ${errors.length} error(s)`);
    for (const e of errors) console.error(`  error: ${e}`);
    for (const w of warnings) console.error(`  warning: ${w}`);
    process.exit(1);
  }

  const changed = [];
  for (const lang of LANGS) {
    const file = path.join(LOCALES_DIR, lang, "messages.json");
    const content = JSON.stringify(sortedObject(messages[lang]), null, 2) + "\n";
    if (await writeIfChanged(file, content)) changed.push(path.relative(ROOT, file));
  }

  if (!quiet) {
    for (const w of warnings) console.warn(`  warning: ${w}`);
    const count = Object.keys(messages.en).length;
    const files = parts.map((p) => p.file).join(", ") || "none";
    console.log(`build-locales: ${count} messages from ${parts.length} part(s) [${files}] -> ${changed.length ? changed.join(", ") : "unchanged"}`);
  }
}

main().catch((e) => {
  console.error(`build-locales: ${e.stack || e.message}`);
  process.exit(1);
});
