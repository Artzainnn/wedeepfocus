// Shared e2e helpers (SPEC sections 9, 11.5 and 12).
// launch() copies extension/ to a fresh temp dir with host access pre-granted (permission
// prompts can't be automated; `hostPermissions` narrows it for the fallback block tests),
// starts the local fixture server, launches Chromium with the extension loaded and returns a
// harness with thin wrappers around the service worker.
//
// Env: FOCUS_E2E_HEADED=1 shows the browser, FOCUS_E2E_KEEP=1 keeps the temp dirs.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFixtureServer } from "./fixture-server.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXT_SRC = path.join(ROOT, "extension");
export const MINUTE = 60_000;
// `npm run test:e2e` passes --test-timeout=180000, which also caps each test FILE at 180 s:
// suites stay under it so a stuck test is reported by name instead of cancelling the file.
export const SUITE_TIMEOUT = 170_000;

const LOCALES_SCRIPT = path.join(ROOT, "scripts", "build-locales.mjs");
const I18N_DIR = path.join(ROOT, "i18n");
const LOCALES = ["en", "fr"];
/** chrome.storage.sync keys holding settings, in SETTINGS_KEYS order (SPEC 12.2). */
export const SETTINGS_KEYS = ["groups", "sites", "schedules", "goals", "prefs", "unlock"];
/** Dynamic rule ids (SPEC 11.1): 1 redirects granted sites, 2 blocks the others. */
export const REDIRECT_RULE_ID = 1;
export const FALLBACK_RULE_ID = 2;
/** The single alarm re-armed by every reconcile (SPEC 11.2). */
export const RECONCILE_ALARM = "reconcile";
export const DEFAULT_HOST_PERMISSIONS = Object.freeze(["<all_urls>"]);
// Chrome refuses to load extensions with root entries starting with "_", hence no "__e2e__".
const HARNESS_PAGE = "e2e-harness/harness.html";
export const HEADED = process.env.FOCUS_E2E_HEADED === "1";
const KEEP_TEMP = process.env.FOCUS_E2E_KEEP === "1";

export const MAPPED_HOSTS = [
  "linkedin.com",
  "*.linkedin.com",
  "facebook.com",
  "*.facebook.com",
  "example.org",
  "news.ycombinator.com",
  "slack.com",
  "*.slack.com",
  "youtube.com",
  "*.youtube.com",
  "wikipedia.org",
  "*.wikipedia.org",
  "pay.test",
];
const HOST_RESOLVER_RULES = MAPPED_HOSTS.map((host) => `MAP ${host} 127.0.0.1`).join(", ");

// ---------------------------------------------------------------------------
// V3 contracts (SPEC 12)

/** Default unlock sentences (`blocked_friction_phrase`, SPEC 12.7). */
export const DEFAULT_PHRASE = Object.freeze({
  en: "I am choosing to give up on my goals. I am trading my aspirations and commitments for a few minutes of distractions.",
  fr: "Je choisis de renoncer à mes objectifs. J'échange mes aspirations et mes engagements contre quelques minutes de distraction.",
});
/** `common_coffee` (SPEC 12.8). */
export const COFFEE_LABEL = Object.freeze({ en: "Buy a dev a coffee", fr: "Offrir un café au dev" });
/** Preset groups in display order with their icons (SPEC 5 presets, 12.2). */
export const PRESET_ICONS = Object.freeze({ social: "users", video: "play", messaging: "mail", news: "news", shopping: "cart" });
export const PRESET_IDS = Object.freeze(Object.keys(PRESET_ICONS));
export const GROUP_ICONS = Object.freeze([
  "users", "play", "mail", "news", "cart", "chat", "game", "music",
  "briefcase", "heart", "star", "globe", "book", "sparkles", "target", "coffee",
]);
/** Id pattern of groups created by the user (SPEC 12.2). */
export const USER_GROUP_ID = /^g_[0-9a-z]{6,10}$/;
/** MAX_GROUPS, MAX_GROUP_DOMAINS and GROUP_NAME_MAX (SPEC 12.2). */
export const MAX_GROUPS = 20;
export const MAX_GROUP_DOMAINS = 100;
export const GROUP_NAME_MAX = 30;
/** Social sites used by the seeds: the two hosts the fixture server answers for, plus a few. */
export const SOCIAL_DOMAINS = Object.freeze(["facebook.com", "instagram.com", "linkedin.com", "pinterest.com", "reddit.com", "x.com"]);

/** A group born from a preset: an empty name shows the translated preset name (SPEC 12.2). */
export function presetGroup(id, { domains = [], enabled = false, name = "", icon = PRESET_ICONS[id] } = {}) {
  return { id, preset: id, name, icon, domains: [...domains], enabled };
}

/** A group created by the user (`id` must match USER_GROUP_ID). */
export function userGroup(id, name, { icon = "star", domains = [], enabled = true } = {}) {
  return { id, name, icon, domains: [...domains], enabled };
}

/** `groups` with `changes` merged into the group `id` only. */
export function withGroup(groups, id, changes) {
  return groups.map((group) => (group.id === id ? { ...group, ...changes } : group));
}

/** Group(s) with sorted domains, for comparisons: the background may store domains in another order. */
export function comparableGroups(value) {
  const one = (group) => (group && typeof group === "object" ? { ...group, domains: [...(group.domains ?? [])].sort() } : group);
  return Array.isArray(value) ? value.map(one) : one(value);
}

/** Settings where only the social group blocks (SOCIAL_DOMAINS), plus `custom` sites. */
export function socialOnlySettings({ custom = [] } = {}) {
  return {
    groups: [
      presetGroup("social", { domains: SOCIAL_DOMAINS, enabled: true }),
      presetGroup("video", { domains: ["youtube.com", "twitch.tv"] }),
    ],
    sites: { custom: [...custom] },
  };
}

/** Straight quotes and single spaces, to compare copy that may use typographic apostrophes. */
export function normalizeCopy(text) {
  return String(text ?? "").replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

/** `defaultGroups(locale)` from extension/shared/presets.js (SPEC 12.2), or null if it can't be loaded. */
export async function loadDefaultGroups(locale) {
  try {
    const presets = await import(pathToFileURL(path.join(EXT_SRC, "shared", "presets.js")).href);
    return typeof presets.defaultGroups === "function" ? presets.defaultGroups(locale) : null;
  } catch {
    return null;
  }
}

/** Checks `groups` are the defaults: the 5 presets in order, localized domains, social on only. */
export async function assertDefaultGroups(groups, locale = "en") {
  assert.ok(Array.isArray(groups), `settings.groups should be an array, got ${describeValue(groups)}`);
  assert.deepEqual(groups.map((group) => group.id), PRESET_IDS, "the 5 preset groups, in order");
  for (const group of groups) {
    assert.equal(group.preset, group.id, `${group.id} is born from its preset`);
    assert.equal(group.name, "", `${group.id} keeps an empty name (the translated preset name shows)`);
    assert.equal(group.icon, PRESET_ICONS[group.id], `${group.id} icon`);
    assert.equal(group.enabled, group.id === "social", `only social is enabled by default (${group.id})`);
    assert.ok(Array.isArray(group.domains) && group.domains.length > 0, `${group.id} has domains`);
  }
  const [social] = groups;
  assert.ok(social.domains.includes("facebook.com") && social.domains.includes("linkedin.com"), "social blocks facebook.com and linkedin.com");
  const news = groups.find((group) => group.id === "news").domains;
  const [local, foreign] = locale === "fr" ? ["lemonde.fr", "cnn.com"] : ["cnn.com", "lemonde.fr"];
  assert.ok(news.includes(local) && !news.includes(foreign), `news uses the ${locale} presets: ${describeValue(news)}`);
  const expected = await loadDefaultGroups(locale);
  if (expected) assert.deepEqual(groups, expected, `settings.groups should equal defaultGroups("${locale}")`);
}

// ---------------------------------------------------------------------------
// Generic utilities

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Polls `getter` until `predicate(value)` holds and returns that value; throws with the last
 * value (or error) seen when the timeout expires. `message` may be a function so it can
 * describe the state at the time of failure.
 */
export async function waitForValue(getter, predicate, { timeout = 10_000, interval = 100, message = "value" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  let lastError;
  for (;;) {
    try {
      last = await getter();
      lastError = undefined;
      if (predicate(last)) return last;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      const what = typeof message === "function" ? message() : message;
      const detail = lastError ? `last error: ${lastError.message}` : `last value: ${describeValue(last)}`;
      throw new Error(`Timed out after ${timeout} ms waiting for ${what} (${detail})`);
    }
    await sleep(interval);
  }
}

/** Polls `fn` until it returns a truthy value (returned) or the timeout expires (throws). */
export function waitFor(fn, options = {}) {
  return waitForValue(fn, Boolean, { message: "condition", ...options });
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function hm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function localDayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function wallClockMs(date, dayOffset = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset, date.getHours(), date.getMinutes()).getTime();
}

/**
 * Weekly slot built relative to `nowMs`, independent of the time of day: it starts
 * `beforeMin` minutes ago and ends `afterMin` minutes from now (total must stay under 24 h).
 * The slot belongs to the day it starts on, so near midnight it naturally becomes an
 * overnight slot (end < start). `dayOffset` moves it to another weekday.
 * Returns { slot, startsAt, endsAt } where the ms values are the occurrence `dayOffset` days away.
 */
export function slotAroundNow(nowMs, { id = "s_e2e", beforeMin = 60, afterMin = 60, dayOffset = 0, enabled = true } = {}) {
  const start = new Date(nowMs - beforeMin * MINUTE);
  const end = new Date(nowMs + afterMin * MINUTE);
  const slot = { id, days: [(start.getDay() + dayOffset) % 7], start: hm(start), end: hm(end), enabled };
  return { slot, startsAt: wallClockMs(start, dayOffset), endsAt: wallClockMs(end, dayOffset) };
}

/** "9:05" / "59:59" / "1:02:03" -> ms. NaN when no countdown is found. */
export function parseCountdown(text) {
  const match = String(text).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!match) return NaN;
  const parts = match.slice(1).filter((part) => part !== undefined).map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}

/** formatBadge output: "25m", "1h05", "9h59", "10h+". */
export const BADGE_PATTERN = /^(\d{1,2}m|\dh\d{2}|10h\+)$/;

/** Collapses whitespace runs and trims, for comparing displayed text with a message. */
export function normalizeSpaces(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** "détour" -> "detour": what a user without an accent key types (SPEC 11.3). */
export function stripDiacritics(text) {
  return String(text).normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

export function sorted(list) {
  return [...list].sort();
}

// ---------------------------------------------------------------------------
// Extension sources

export function requireExtensionFiles(...relPaths) {
  const missing = relPaths.filter((rel) => !fs.existsSync(path.join(EXT_SRC, rel)));
  if (missing.length) {
    throw new Error(`Missing extension files (not written yet?): ${missing.map((rel) => `extension/${rel}`).join(", ")}`);
  }
}

function localeFile(locale) {
  return path.join(EXT_SRC, "_locales", locale, "messages.json");
}

/** Built catalog for a locale: { key: { message, ... } }. */
export function readMessages(locale) {
  return JSON.parse(fs.readFileSync(localeFile(locale), "utf8"));
}

function localesExist() {
  return LOCALES.every((locale) => fs.existsSync(localeFile(locale)));
}

function localesAreStale() {
  if (!localesExist()) return true;
  if (!fs.existsSync(I18N_DIR)) return false;
  const builtAt = Math.min(...LOCALES.map((locale) => fs.statSync(localeFile(locale)).mtimeMs));
  return fs
    .readdirSync(I18N_DIR)
    .filter((file) => file.endsWith(".json"))
    .some((file) => fs.statSync(path.join(I18N_DIR, file)).mtimeMs > builtAt);
}

function buildLocales() {
  const result = spawnSync(process.execPath, [LOCALES_SCRIPT], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(`node scripts/build-locales.mjs failed (exit ${result.status}):\n${output}`);
  }
}

async function withFileLock(lockDir, fn, { timeout = 60_000, staleAfter = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const stat = fs.statSync(lockDir, { throwIfNoEntry: false });
      if (stat && Date.now() - stat.mtimeMs > staleAfter) {
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the lock ${lockDir}`);
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

let localesChecked = false;

/**
 * Builds extension/_locales from i18n/*.json when missing or older than the part files.
 * Serialized across test processes with a lock dir, since node --test may run files in parallel.
 */
export async function ensureLocales() {
  if (localesChecked) return;
  if (localesAreStale()) {
    if (fs.existsSync(LOCALES_SCRIPT)) {
      const lockName = `focus-e2e-locales-${createHash("sha1").update(ROOT).digest("hex").slice(0, 10)}.lock`;
      await withFileLock(path.join(os.tmpdir(), lockName), async () => {
        if (localesAreStale()) buildLocales();
      });
    } else if (!localesExist()) {
      throw new Error(
        "extension/_locales/{en,fr}/messages.json are missing and scripts/build-locales.mjs does not exist yet, " +
          "so the extension cannot load its messages.",
      );
    }
  }
  localesChecked = true;
}

/** extension/manifest.json as shipped (before the e2e patches). */
export function readSourceManifest() {
  return JSON.parse(fs.readFileSync(path.join(EXT_SRC, "manifest.json"), "utf8"));
}

function prepareExtension(tmpDir, { locale, hostPermissions, paymentApi, accountability = true }) {
  const dir = path.join(tmpDir, "extension");
  fs.cpSync(EXT_SRC, dir, { recursive: true, filter: (src) => !path.basename(src).startsWith(".") });

  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // Granted at install for an unpacked extension, like accepting the permission prompt.
  manifest.host_permissions = [...hostPermissions];

  // On macOS Chrome picks the message catalog from the OS language and ignores --lang, so
  // keep only the catalog under test: the UI language is then the same on every machine.
  const localesDir = path.join(dir, "_locales");
  for (const entry of fs.readdirSync(localesDir)) {
    if (entry !== locale) fs.rmSync(path.join(localesDir, entry), { recursive: true, force: true });
  }
  manifest.default_locale = locale;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Payments go to the fixture server's fake payment API instead of the real one (SPEC 13.8).
  if (paymentApi) {
    const constantsPath = path.join(dir, "shared", "config.js");
    const source = fs.readFileSync(constantsPath, "utf8");
    let patched = source.replace(/export const PAYMENT_API = "[^"]*";/, `export const PAYMENT_API = "${paymentApi}";`);
    if (patched === source) throw new Error("PAYMENT_API not found in shared/config.js");
    // Most suites cover the full feature set; free-only.test.js checks the shipped (free only) build.
    const flagged = patched.replace(/export const ACCOUNTABILITY_ENABLED = (true|false);/, `export const ACCOUNTABILITY_ENABLED = ${accountability};`);
    if (flagged === patched && !patched.includes(`ACCOUNTABILITY_ENABLED = ${accountability};`)) {
      throw new Error("ACCOUNTABILITY_ENABLED not found in shared/config.js");
    }
    fs.writeFileSync(constantsPath, flagged);
  }

  // Blank extension page used to call chrome.runtime.sendMessage like a real page would
  // (the service worker can't message its own onMessage listener).
  const harnessPath = path.join(dir, HARNESS_PAGE);
  fs.mkdirSync(path.dirname(harnessPath), { recursive: true });
  fs.writeFileSync(harnessPath, '<!doctype html>\n<meta charset="utf-8">\n<title>e2e harness</title>\n');

  return { dir, manifest };
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Best effort: Chromium sometimes keeps a file open for a moment after closing.
  }
}

// ---------------------------------------------------------------------------
// Browser

function collectLogs(context) {
  const entries = [];
  context.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // An extension page framed by a web page reports the web page as its page(): prefer the script location.
    const location = msg.location()?.url || "";
    const source = location.startsWith("chrome-extension://") ? location : msg.page()?.url() || msg.worker()?.url() || location;
    entries.push({ kind: "console.error", source, text: msg.text() });
  });
  context.on("weberror", (webError) => {
    const error = webError.error();
    entries.push({ kind: "uncaught", source: webError.page()?.url() || "", text: error?.stack || error?.message || String(error) });
  });
  return entries;
}

async function waitForServiceWorker(context, workerPath, timeout = 20_000) {
  const matches = (worker) => worker.url().startsWith("chrome-extension://") && worker.url().endsWith(`/${workerPath}`);
  const pending = context.waitForEvent("serviceworker", { predicate: matches, timeout }).catch(() => null);
  const worker = context.serviceWorkers().find(matches) ?? (await pending);
  if (!worker) {
    throw new Error(
      `The extension service worker (extension/${workerPath}) did not start within ${timeout / 1000} s: ` +
        "it is missing, fails to parse, or one of its module imports fails.",
    );
  }
  return worker;
}

function isClosedError(err) {
  return /closed|detached|destroyed/i.test(String(err?.message));
}

class ExtensionHarness {
  constructor({ context, server, worker, tmpDir, extDir, manifest, locale, logs }) {
    this.context = context;
    this.server = server;
    this.tmpDir = tmpDir;
    this.extDir = extDir;
    /** The manifest actually loaded (with the e2e host_permissions). */
    this.manifest = manifest;
    this.locale = locale;
    this.logs = logs;
    this.port = server.port;
    this.extId = new URL(worker.url()).host;
    this.extOrigin = `chrome-extension://${this.extId}`;
    this.blockedPageUrl = this.extUrl("blocked/blocked.html");
    this._worker = worker;
    this._workerUrl = worker.url();
    this._harness = null;
  }

  /** Current service worker (re-acquired transparently if Chrome restarted it). */
  get sw() {
    return this._worker;
  }

  extUrl(relPath = "") {
    return `${this.extOrigin}/${relPath.replace(/^\//, "")}`;
  }

  /** URL on the fixture server for a mapped host, e.g. site("linkedin.com", "/feed"). */
  site(host, pathname = "/") {
    return `http://${host}:${this.port}${pathname}`;
  }

  blockedUrlFor(originalUrl) {
    return `${this.blockedPageUrl}#${originalUrl}`;
  }

  async swEval(fn, arg) {
    try {
      return await this._worker.evaluate(fn, arg);
    } catch (err) {
      if (!isClosedError(err)) throw err;
      this._worker = await this._wakeWorker();
      return this._worker.evaluate(fn, arg);
    }
  }

  async _wakeWorker() {
    const matches = (worker) => worker.url() === this._workerUrl && worker !== this._worker;
    const pending = this.context.waitForEvent("serviceworker", { predicate: matches, timeout: 15_000 });
    await this.inExtensionPage(() => chrome.runtime.sendMessage({ type: "getState" }).catch(() => null));
    const live = this.context.serviceWorkers().find(matches);
    if (live) {
      pending.catch(() => {});
      return live;
    }
    return pending;
  }

  setSync(obj) {
    return this.swEval((items) => chrome.storage.sync.set(items), obj);
  }

  getSync(keys = null) {
    return this.swEval((k) => chrome.storage.sync.get(k), keys);
  }

  setLocal(obj) {
    return this.swEval((items) => chrome.storage.local.set(items), obj);
  }

  getLocal(keys = null) {
    return this.swEval((k) => chrome.storage.local.get(k), keys);
  }

  /** Runs the background reconcile (test hook globalThis.__focus) and waits for it. */
  reconcile() {
    return this.swEval(async () => {
      if (typeof globalThis.__focus?.reconcile !== "function") {
        throw new Error("globalThis.__focus.reconcile is missing in the service worker (SPEC section 6 test hook)");
      }
      await globalThis.__focus.reconcile();
      return true;
    });
  }

  getBadge() {
    return this.swEval(() => chrome.action.getBadgeText({}));
  }

  getRules() {
    return this.swEval(() => chrome.declarativeNetRequest.getDynamicRules());
  }

  async ruleById(id) {
    return (await this.getRules()).find((rule) => rule.id === id) ?? null;
  }

  /** Domains currently enforced: redirected to the goals page or blocked by the fallback rule. */
  async enforcedDomains() {
    const rules = await this.getRules();
    return rules.flatMap((rule) => rule.condition?.requestDomains ?? []);
  }

  /** Domains redirected to blocked.html (rule 1, sites with host permission). */
  async redirectDomains() {
    return (await this.ruleById(REDIRECT_RULE_ID))?.condition?.requestDomains ?? [];
  }

  alarms() {
    return this.swEval(() => chrome.alarms.getAll());
  }

  /** Same message as api.saveSettings(patch). */
  saveSettings(patch) {
    return this.message({ type: "saveSettings", patch });
  }

  /** The localized default sentence of the friction flow (used when unlock.phrase is empty). */
  defaultPhrase() {
    return this.inExtensionPage(() => chrome.i18n.getMessage("blocked_friction_phrase"));
  }

  /** Requests the fixture server received for `host` (port stripped). */
  requestsTo(host) {
    return this.server.requests(host);
  }

  /** Writes a manual session straight to storage (bypassing the popup) and reconciles. */
  async startSessionDirect(minutes) {
    const now = Date.now();
    const session = { startedAt: now, endsAt: now + minutes * MINUTE };
    await this.setLocal({ session });
    await this.reconcile();
    return session;
  }

  /**
   * Forgets the strict snapshot (chrome.storage.local "strict", SPEC 11.2) as if the block it
   * remembers had run out, then reconciles. Tests can't fast-forward the worker's clock, and
   * without this the snapshot keeps a block running after its session or slot is removed.
   */
  async clearStrict() {
    await this.reconcile(); // settle first so no reconcile in flight writes the snapshot back
    await this.setLocal({ strict: null });
    await this.reconcile();
  }

  /** Ends the manual session and its strict snapshot together, as if the session were over. */
  async endSessionDirect() {
    await this.reconcile();
    await this.setLocal({ session: null, strict: null });
    await this.reconcile();
  }

  async harnessPage() {
    if (!this._harness || this._harness.isClosed()) {
      this._harness = await this.context.newPage();
      await this._harness.goto(this.extUrl(HARNESS_PAGE));
    }
    return this._harness;
  }

  /** Evaluates `fn` in a blank extension page (chrome.* APIs available, like the real pages). */
  async inExtensionPage(fn, arg) {
    const page = await this.harnessPage();
    return page.evaluate(fn, arg);
  }

  /** Sends a runtime message to the background exactly like shared/api.js does. */
  message(msg) {
    return this.inExtensionPage((m) => chrome.runtime.sendMessage(m), msg);
  }

  async getState() {
    const state = await this.message({ type: "getState" });
    assert.ok(state && state.ok, `getState should answer { ok: true, ... }, got ${describeValue(state)}`);
    return state;
  }

  newPage() {
    return this.context.newPage();
  }

  async openExtensionPage(relPath) {
    const page = await this.context.newPage();
    await page.goto(this.extUrl(relPath));
    return page;
  }

  /** Opens the options page once its groups section shows the stored settings. */
  async openOptions() {
    const page = await this.openExtensionPage("options/options.html");
    await page.getByTestId("options-groups").waitFor({ state: "visible" });
    // The page may flag itself aria-busy until the first state is rendered (lock state included).
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    return page;
  }

  findPage(predicate) {
    return this.context.pages().find((page) => !page.isClosed() && predicate(page)) ?? null;
  }

  async _goto(page, url) {
    try {
      await page.goto(url);
    } catch (err) {
      // A redirect racing the load can abort the original navigation; the URL checks decide.
      if (!/ERR_ABORTED|interrupted by another navigation/i.test(err.message)) throw err;
    }
  }

  /** Waits until `page` shows the blocked page and checks the hash carries `originalUrl`. */
  async waitForBlocked(page, originalUrl, { timeout = 10_000 } = {}) {
    const prefix = `${this.blockedPageUrl}#`;
    await waitFor(() => !page.isClosed() && page.url().startsWith(prefix), {
      timeout,
      message: () => `${originalUrl} to be redirected to the blocked page (current URL: ${page.isClosed() ? "closed" : page.url()})`,
    });
    const hash = page.url().slice(prefix.length);
    let decoded = hash;
    try {
      decoded = decodeURIComponent(hash);
    } catch {
      // keep the raw hash
    }
    assert.ok(hash === originalUrl || decoded === originalUrl, `blocked page hash should be the original URL.\n  expected: ${originalUrl}\n  actual:   ${hash}`);
    await page.waitForLoadState("domcontentloaded");
  }

  /** Waits until `page` shows the fixture page for `url` (i.e. it was not redirected). */
  async expectSiteLoaded(page, url, { timeout = 10_000 } = {}) {
    await waitFor(() => page.url() === url, {
      timeout,
      message: () => `${url} to be loaded (current URL: ${page.url()})`,
    });
    await page.waitForLoadState("domcontentloaded");
    const host = (await page.getByTestId("fixture-host").textContent()).trim();
    assert.equal(host, new URL(url).hostname);
  }

  async gotoSite(page, url) {
    await this._goto(page, url);
    await this.expectSiteLoaded(page, url);
  }

  async gotoBlocked(page, url) {
    await this._goto(page, url);
    await this.waitForBlocked(page, url);
  }

  /**
   * Navigates to `url` and checks the fallback block rule stopped it: Chrome's own error page
   * (net::ERR_BLOCKED_BY_CLIENT), not the goals page, and the site never got the request.
   */
  async gotoFallbackBlocked(page, url) {
    const host = new URL(url).hostname;
    const requestsBefore = this.requestsTo(host).length;
    const error = await page.goto(url).then(
      () => null,
      (err) => err,
    );
    assert.ok(error, `${url} should fail to load (fallback block rule), but it loaded: ${page.url()}`);
    assert.match(error.message, /ERR_BLOCKED_BY_CLIENT/, `${url} should be blocked by the extension`);
    assert.ok(!page.url().startsWith(this.blockedPageUrl), `${url} must not land on the goals page without host access`);
    assert.equal(await page.getByTestId("fixture-host").count(), 0, `${url} must not show the site content`);
    assert.equal(this.requestsTo(host).length, requestsBefore, `${host} must never receive the request`);
  }

  /** console.error calls and uncaught exceptions coming from extension pages or the service worker. */
  extensionErrors() {
    return this.logs.filter((entry) => entry.source.startsWith(this.extOrigin));
  }

  assertNoExtensionErrors() {
    const errors = this.extensionErrors().map((entry) => `[${entry.kind}] ${entry.source}\n    ${entry.text}`);
    assert.equal(errors.length, 0, `extension logged ${errors.length} error(s):\n${errors.join("\n")}`);
  }

  async close() {
    await this.context.close().catch(() => {});
    await this.server.close();
    if (KEEP_TEMP) console.log(`[e2e] kept ${this.tmpDir}`);
    else removeDir(this.tmpDir);
  }
}

/**
 * Launches Chromium with a fresh profile and a temp copy of the extension.
 * Resolves once the service worker runs, exposes its test hook and finished a reconcile
 * (queued after the install handler). Install writes nothing to chrome.storage.sync
 * (SPEC 11.2): defaults are merged at read time.
 * `locale`: "en" (default) or "fr".
 * `hostPermissions`: manifest host_permissions granted at install (default ["<all_urls>"]).
 */
export async function launch({ locale = "en", hostPermissions = DEFAULT_HOST_PERMISSIONS, accountability = true } = {}) {
  if (!LOCALES.includes(locale)) throw new Error(`Unsupported locale "${locale}"`);
  if (!Array.isArray(hostPermissions) || hostPermissions.some((origin) => typeof origin !== "string")) {
    throw new Error(`hostPermissions must be an array of match patterns, got ${describeValue(hostPermissions)}`);
  }
  requireExtensionFiles("manifest.json");
  await ensureLocales();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-e2e-"));
  let server;
  let context;
  try {
    server = await startFixtureServer();
    const paymentApi = `http://pay.test:${server.port}`;
    const { dir: extDir, manifest } = prepareExtension(tmpDir, { locale, hostPermissions, paymentApi, accountability });
    const uiLanguage = locale === "fr" ? "fr" : "en-US";
    context = await chromium.launchPersistentContext(path.join(tmpDir, "profile"), {
      channel: "chromium",
      headless: !HEADED,
      locale: uiLanguage,
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        `--host-resolver-rules=${HOST_RESOLVER_RULES}`,
        `--lang=${uiLanguage}`,
      ],
    });
    context.setDefaultTimeout(10_000);
    const logs = collectLogs(context);
    const workerPath = manifest.background?.service_worker ?? "background/service-worker.js";
    const worker = await waitForServiceWorker(context, workerPath);
    const harness = new ExtensionHarness({ context, server, worker, tmpDir, extDir, manifest, locale, logs });

    await waitFor(() => harness.swEval(() => typeof globalThis.__focus?.reconcile === "function"), {
      timeout: 15_000,
      message: "the service worker test hook globalThis.__focus.reconcile (SPEC section 6)",
    });
    await harness.reconcile();
    return harness;
  } catch (err) {
    await context?.close().catch(() => {});
    await server?.close();
    removeDir(tmpDir);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Page helpers

/** True when the element (or the form control inside it) is disabled or aria-disabled. */
export function isDisabled(locator) {
  return locator.evaluate((el) => {
    const control = el.matches("input, button, select, textarea") ? el : el.querySelector("input, button, select, textarea") ?? el;
    return (
      control.disabled === true ||
      control.getAttribute("aria-disabled") === "true" ||
      el.getAttribute("aria-disabled") === "true" ||
      Boolean(control.closest("fieldset:disabled"))
    );
  });
}

/** Locator is attached and visible right now (no waiting). */
export async function isShown(locator) {
  return (await locator.count()) > 0 && (await locator.first().isVisible());
}

/**
 * Selected state of a toggle-like control, whatever carries it: aria-pressed / aria-checked /
 * aria-selected, or a checkbox or radio (the element itself or the one inside it).
 */
export function isSelected(locator) {
  return locator.evaluate((el) => {
    for (const attr of ["aria-pressed", "aria-checked", "aria-selected"]) {
      const value = el.getAttribute(attr);
      if (value !== null) return value === "true";
    }
    const input = el.matches("input") ? el : el.querySelector('input[type="checkbox"], input[type="radio"]');
    if (input) return input.checked;
    const inner = el.querySelector("[aria-pressed], [aria-checked], [aria-selected]");
    if (inner) return ["aria-pressed", "aria-checked", "aria-selected"].some((attr) => inner.getAttribute(attr) === "true");
    return el.classList.contains("is-selected") || el.classList.contains("is-active");
  });
}

/** Ids `x` of every element whose data-testid is `<prefix>x`, in document order. */
export function testIdSuffixes(page, prefix) {
  return page.evaluate(
    (p) => [...document.querySelectorAll(`[data-testid^="${p}"]`)].map((el) => el.dataset.testid.slice(p.length)),
    prefix,
  );
}

/** Opens the editor of group `id` in the options page (SPEC 12.5) unless it is already open. */
export async function expandGroup(page, id) {
  const name = page.getByTestId(`group-name-${id}`);
  if (!(await isShown(name))) await page.getByTestId(`group-expand-${id}`).click();
  await name.waitFor({ state: "visible" });
}

/** Everything a user can read on the page: title, visible text, placeholders, tooltips, aria-labels. */
export function pageCopy(page) {
  return page.evaluate(() => {
    const texts = [document.title, document.body ? document.body.innerText : ""];
    for (const el of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
      for (const attr of ["placeholder", "title", "aria-label"]) {
        const value = el.getAttribute(attr);
        if (value) texts.push(value);
      }
    }
    return texts;
  });
}

/** i18n keys leaking into the UI (t() returns the key itself when a message is missing). */
export async function findRawI18nKeys(page) {
  const pattern = /\b(?:bg|popup|options|onb|blocked|common|reason|category|badge)_[a-z0-9_]*[a-z0-9]\b/g;
  const found = new Set();
  for (const text of await pageCopy(page)) for (const match of text.matchAll(pattern)) found.add(match[0]);
  return [...found];
}
