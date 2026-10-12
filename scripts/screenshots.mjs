#!/usr/bin/env node
// Captures the Chrome Web Store screenshots (1280x800 PNG) into store/screenshots/.
//
// Shots per language (<lang>-<n>-<name>.png): 1 blocked page, 2 popup (centered on a
// neutral background), 3 options page with its groups (one group expanded), 4 onboarding
// step 1, 5 options page scrolled to the "Unlock sentence" section. Demo groups (the presets
// plus one group made by the user), one goal and a custom unlock sentence are seeded.
//
// Usage: node scripts/screenshots.mjs [--lang=en|fr|all] [--shots=name,name] [--scheme=light|dark] [--headed] [--out=dir]
// Default: --lang=all --scheme=light, every shot, into store/screenshots/.
// Shot names: blocked, popup, options, onboarding, phrase.
//
// Notes:
// - The extension is copied to a temp dir with "host_permissions": ["<all_urls>"]
//   because permission prompts cannot be automated.
// - Distracting hosts are mapped to a local HTTP server with --host-resolver-rules.
// - On macOS Chromium ignores --lang, so French runs through a tiny wrapper that
//   passes the AppleLanguages user default instead.

import { chromium } from "playwright";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile, rm, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_SRC = path.join(ROOT, "extension");
const VIEWPORT = { width: 1280, height: 800 };
// The popup keeps its real 320 px layout; zoom only enlarges it so it reads well in the store.
const POPUP_ZOOM = 1.5;
// Smallest zoom used to fit a tall card in the 800 px shot (text stays readable).
const MIN_FIT_ZOOM = 0.8;
const MAPPED_HOSTS = ["linkedin.com", "*.linkedin.com", "9gag.com", "news.ycombinator.com", "example.org"];

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const LANGS = argv.lang && argv.lang !== "all" ? [argv.lang] : ["en", "fr"];
const SCHEME = argv.scheme === "dark" ? "dark" : "light";
const HEADED = Boolean(argv.headed);
const OUT_DIR = typeof argv.out === "string" ? path.resolve(argv.out) : path.join(ROOT, "store", "screenshots");

// Capture order matters: onboarding shows the fresh install, the options shots need no
// block running (locked controls), the blocked page and the popup need one.
// setup: "fresh" = untouched profile, "seeded" = demo settings, "session" = demo settings + session.
const PLAN = [
  { name: "onboarding", n: 4, setup: "fresh" },
  { name: "options", n: 3, setup: "seeded" },
  { name: "phrase", n: 5, setup: "seeded" },
  { name: "blocked", n: 1, setup: "session" },
  { name: "popup", n: 2, setup: "session" },
];
const SHOT_FILTER = typeof argv.shots === "string" ? new Set(argv.shots.split(",").map((s) => s.trim()).filter(Boolean)) : null;

const DEMO = {
  en: {
    goal: "Ship the new onboarding by Friday",
    phrase: "I said I would ship the onboarding this week. Opening this site means choosing not to, for now.",
    group: "Work chat",
  },
  fr: {
    goal: "Livrer le nouvel onboarding vendredi",
    phrase: "J'ai dit que je livrerais l'onboarding cette semaine. Ouvrir ce site, c'est choisir de ne pas le faire.",
    group: "Messagerie pro",
  },
};
// Group made by the user in the demo (SPEC 12.2), shown after the presets. The options shot
// opens its editor: custom name, chosen icon and its own sites.
const DEMO_GROUP = { id: "g_demo01", icon: "chat", domains: ["slack.com", "discord.com", "teams.microsoft.com"], enabled: true };
// Used only if extension/shared/presets.js can't be loaded.
const FALLBACK_GROUPS = [
  { id: "social", icon: "users", domains: ["facebook.com", "instagram.com", "x.com", "tiktok.com", "linkedin.com", "reddit.com"] },
  { id: "video", icon: "play", domains: ["youtube.com", "netflix.com", "twitch.tv", "primevideo.com", "disneyplus.com"] },
  { id: "messaging", icon: "mail", domains: ["mail.google.com", "outlook.live.com", "web.whatsapp.com", "messenger.com"] },
  { id: "news", icon: "news", domains: { en: ["cnn.com", "bbc.com", "nytimes.com"], fr: ["lemonde.fr", "lefigaro.fr", "bfmtv.com"] } },
  { id: "shopping", icon: "cart", domains: ["amazon.com", "aliexpress.com", "temu.com", "ebay.com"] },
];

/** The preset groups for `lang` (presets.defaultGroups, SPEC 12.2) with social and video on. */
async function presetGroups(lang) {
  let groups;
  try {
    const presets = await import(pathToFileURL(path.join(EXT_SRC, "shared", "presets.js")).href);
    groups = presets.defaultGroups(lang);
  } catch (e) {
    log(`presets.defaultGroups unavailable (${e.message}), using a built-in list`);
    groups = FALLBACK_GROUPS.map(({ id, icon, domains }) => ({
      id, preset: id, name: "", icon, domains: Array.isArray(domains) ? domains : domains[lang], enabled: false,
    }));
  }
  return groups.map((group) => ({ ...group, enabled: group.id === "social" || group.id === "video" }));
}

// Candidate schedules; the first set that does not cover "now" is used so the options
// page renders unlocked (the block is then started as a manual session).
const SCHEDULE_SETS = [
  [
    { id: "s_demo1", days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", enabled: true },
    { id: "s_demo2", days: [1, 2, 3, 4], start: "14:00", end: "17:30", enabled: true },
  ],
  [
    { id: "s_demo1", days: [1, 2, 3, 4, 5], start: "07:00", end: "09:00", enabled: true },
    { id: "s_demo2", days: [1, 2, 3, 4, 5], start: "19:30", end: "21:30", enabled: true },
  ],
  [
    { id: "s_demo1", days: [1, 2, 3, 4, 5], start: "12:30", end: "14:00", enabled: true },
    { id: "s_demo2", days: [0, 6], start: "22:00", end: "23:30", enabled: true },
  ],
];

const log = (...a) => console.log("screenshots:", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function minutesOf(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function coversNow(slot, now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return slot.enabled && slot.days.includes(now.getDay()) && minutes >= minutesOf(slot.start) - 5 && minutes < minutesOf(slot.end) + 5;
}

function pickSchedules() {
  return SCHEDULE_SETS.find((set) => !set.some((slot) => coversNow(slot))) ?? [];
}

function displayPath(file) {
  const rel = path.relative(ROOT, file);
  return rel.startsWith("..") ? file : rel;
}

function localDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startServer() {
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>Local page</title></head>
<body style="font-family:system-ui;margin:48px;color:#333"><h1>Local test page</h1><p>Served by scripts/screenshots.mjs.</p></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function prepareExtension(tmp) {
  const dir = path.join(tmp, "extension");
  await cp(EXT_SRC, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

// Headless Chrome accepts a single positional argument; Playwright passes about:blank.
// The wrapper drops it and adds the macOS language override (seen by Chrome as the start URL).
async function macLanguageWrapper(tmp, lang) {
  const real = chromium.executablePath();
  const wrapper = path.join(tmp, `chromium-${lang}.sh`);
  const script = [
    "#!/bin/sh",
    'n=$#; i=0',
    'for arg in "$@"; do',
    '  i=$((i+1))',
    '  [ "$i" -eq "$n" ] && [ "$arg" = "about:blank" ] || set -- "$@" "$arg"',
    "done",
    'shift "$n"',
    `exec "${real}" "$@" -AppleLanguages "(${lang})"`,
    "",
  ].join("\n");
  await writeFile(wrapper, script);
  await chmod(wrapper, 0o755);
  return wrapper;
}

async function launch(tmp, extDir, lang) {
  const rules = MAPPED_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(", ");
  const options = {
    headless: !HEADED,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: lang === "fr" ? "fr-FR" : "en-US",
    colorScheme: SCHEME,
    reducedMotion: "reduce",
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      `--host-resolver-rules=${rules}`,
      `--lang=${lang}`,
    ],
  };
  if (process.platform === "darwin") {
    options.executablePath = await macLanguageWrapper(tmp, lang);
  } else {
    options.channel = "chromium";
    options.env = { ...process.env, LANGUAGE: lang };
  }
  const context = await chromium.launchPersistentContext(path.join(tmp, "profile"), options);
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  return { context, sw, extId, extUrl: (p) => `chrome-extension://${extId}/${p}` };
}

function isClosedError(e) {
  return /closed|detached|destroyed/i.test(String(e?.message));
}

// MV3 service workers stop when idle: wake it up through an extension page and re-acquire it.
async function swEval(env, fn, arg) {
  try {
    return await env.sw.evaluate(fn, arg);
  } catch (e) {
    if (!isClosedError(e)) throw e;
    const stale = env.sw;
    const matches = (worker) => worker !== stale && worker.url() === stale.url();
    const pending = env.context.waitForEvent("serviceworker", { predicate: matches, timeout: 15000 });
    const page = await env.context.newPage();
    await page.goto(env.extUrl("popup/popup.html")).catch(() => {});
    env.sw = env.context.serviceWorkers().find(matches) ?? (await pending);
    pending.catch(() => {});
    await page.close().catch(() => {});
    return env.sw.evaluate(fn, arg);
  }
}

async function reconcile(env) {
  const ran = await swEval(env, async () => {
    if (globalThis.__focus?.reconcile) {
      await globalThis.__focus.reconcile();
      return true;
    }
    return false;
  });
  if (!ran) await sleep(800);
}

async function seed(env, lang) {
  const groups = [...(await presetGroups(lang)), { ...DEMO_GROUP, name: DEMO[lang].group }];
  await swEval(
    env,
    async ({ sync, local }) => {
      await chrome.storage.sync.set(sync);
      await chrome.storage.local.set(local);
    },
    {
      sync: {
        groups,
        sites: { custom: ["news.ycombinator.com", "imgur.com"] },
        schedules: pickSchedules(),
        goals: { items: [DEMO[lang].goal], showQuote: true },
        prefs: { onboarded: true },
        unlock: { phrase: DEMO[lang].phrase },
      },
      // strict: null drops the worker's strict snapshot, so re-seeding always ends any block.
      local: { session: null, passes: {}, strict: null, stats: { day: localDayKey(), blocked: 5, resisted: 3 } },
    },
  );
  await reconcile(env);
}

async function startSession(env) {
  const now = Date.now();
  await swEval(
    env,
    async (session) => chrome.storage.local.set({ session }),
    { startedAt: now - 18 * 60000, endsAt: now + (42 * 60 + 17) * 1000 },
  );
  await reconcile(env);
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(400);
}

// Zooms the page out (not below MIN_FIT_ZOOM) when the visible element matching `selector` (or
// the card holding it) ends below the viewport, so the shot shows all of it instead of slicing
// a line of text at the edge.
async function fitToViewport(page, selector) {
  await page.evaluate(
    ({ selector, height, minZoom }) => {
      const visible = [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length > 0);
      if (!visible.length) return;
      const bottoms = visible.map((el) => (el.closest(".card") ?? el).getBoundingClientRect().bottom + window.scrollY);
      const bottom = Math.max(...bottoms) + 24;
      if (bottom > height) document.documentElement.style.zoom = String(Math.max(minZoom, height / bottom));
    },
    { selector, height: VIEWPORT.height, minZoom: MIN_FIT_ZOOM },
  );
}

// Shows the whole card holding `selector`: zoomed out if needed (not below MIN_FIT_ZOOM), then
// scrolled so the card starts near the top of the shot.
async function showWholeCard(page, selector) {
  await page.evaluate(
    ({ selector, height, minZoom }) => {
      const target = document.querySelector(selector);
      if (!target) return;
      const card = target.closest(".card") ?? target;
      const needed = card.getBoundingClientRect().height + 48;
      if (needed > height) document.documentElement.style.zoom = String(Math.max(minZoom, height / needed));
      card.scrollIntoView({ block: "start", behavior: "instant" });
      window.scrollBy({ top: -24, behavior: "instant" });
    },
    { selector, height: VIEWPORT.height, minZoom: MIN_FIT_ZOOM },
  );
}

// The options page may flag itself aria-busy until the stored settings are rendered.
async function waitForOptionsRender(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5000 }).catch(() => {});
}

async function closeExtraPages(context, keep) {
  for (const p of context.pages()) if (p !== keep) await p.close().catch(() => {});
}

const shots = {
  async onboarding({ context, extUrl }, file) {
    const page = await context.newPage();
    await page.goto(extUrl("onboarding/onboarding.html"));
    await page.locator('[data-testid="onb-step-1"]').waitFor({ state: "visible", timeout: 10000 });
    const video = page.locator('[data-testid="onb-category-video"]');
    if (await video.count()) {
      const pressed = await video.evaluate((el) => {
        const input = el.matches("input") ? el : el.querySelector("input");
        return el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true" || Boolean(input?.checked);
      });
      if (!pressed) await video.click();
    }
    await fitToViewport(page, '[data-testid="onb-step-1"], [data-testid="onb-next"]');
    await page.mouse.move(0, 0);
    await settle(page);
    await page.screenshot({ path: file });
    await page.close();
  },

  async options({ context, extUrl }, file) {
    const page = await context.newPage();
    await page.goto(extUrl("options/options.html"));
    await page.locator('[data-testid="options-groups"]').waitFor({ state: "visible", timeout: 10000 });
    await waitForOptionsRender(page);
    await page.locator(`[data-testid="group-${DEMO_GROUP.id}"]`).waitFor({ state: "visible", timeout: 5000 });
    const editor = page.locator(`[data-testid="group-name-${DEMO_GROUP.id}"]`);
    if (!(await editor.isVisible())) await page.locator(`[data-testid="group-expand-${DEMO_GROUP.id}"]`).click();
    await editor.waitFor({ state: "visible", timeout: 5000 });
    await page.evaluate(() => document.activeElement?.blur());
    await showWholeCard(page, '[data-testid="options-groups"]');
    await page.mouse.move(0, 0);
    await settle(page);
    await page.screenshot({ path: file });
    await page.close();
  },

  async phrase({ context, extUrl }, file) {
    const page = await context.newPage();
    await page.goto(extUrl("options/options.html"));
    const section = page.locator('[data-testid="options-phrase"]');
    await section.waitFor({ state: "visible", timeout: 10000 });
    await waitForOptionsRender(page);
    const filled = await page
      .waitForFunction(() => document.querySelector('[data-testid="phrase-input"]')?.value.length > 0, null, { timeout: 5000 })
      .then(() => true, () => false);
    if (!filled) log("phrase: the sentence field is still empty, capturing it anyway");
    // Center the section in the viewport, keeping its top visible when it is taller.
    await section.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const offset = Math.max(24, (window.innerHeight - rect.height) / 2);
      window.scrollTo({ top: window.scrollY + rect.top - offset, behavior: "instant" });
    });
    await page.mouse.move(0, 0);
    await settle(page);
    await page.screenshot({ path: file });
    await page.close();
  },

  async blocked({ context, port }, file) {
    const page = await context.newPage();
    await page.goto(`http://linkedin.com:${port}/feed/`).catch(() => {});
    await page.waitForURL(/blocked\/blocked\.html/, { timeout: 10000 }).catch(() => {
      throw new Error(`linkedin.com was not redirected to the blocked page (still on ${page.url()})`);
    });
    await page.locator('[data-testid="blocked-main"]').waitFor({ state: "visible", timeout: 10000 });
    await page.mouse.move(0, 0);
    await settle(page);
    await page.screenshot({ path: file });
    await page.close();
  },

  async popup({ context, extUrl, port }, file) {
    // Open a regular site first so the popup's "current site" row has something to show.
    const site = await context.newPage();
    await site.goto(`http://9gag.com:${port}/`).catch(() => {});
    const page = await context.newPage();
    await page.goto(extUrl("popup/popup.html"));
    await site.bringToFront();
    await page.reload();
    await page.locator('[data-testid="popup-status"]').waitFor({ state: "visible", timeout: 10000 });
    const neutral = SCHEME === "dark" ? "#0e0d11" : "#ebe5db"; // warm backdrop around the cream popup
    await page.addStyleTag({
      content: `
        html { min-height: 100vh !important; width: auto !important; display: grid !important; place-items: center !important; background: ${neutral} !important; }
        body { width: 320px !important; min-width: 320px !important; max-width: 320px !important; margin: 0 !important; border-radius: 20px; overflow: hidden;
               box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 16px 48px rgba(0,0,0,.18); zoom: ${POPUP_ZOOM}; }
      `,
    });
    await page.mouse.move(0, 0);
    await settle(page);
    await page.screenshot({ path: file });
    await page.close();
    await site.close();
  },
};

async function runLanguage(lang, port) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "focus-shots-"));
  const failures = [];
  let context;
  try {
    const extDir = await prepareExtension(tmp);
    const env = await launch(tmp, extDir, lang);
    context = env.context;
    const uiLang = await swEval(env, () => chrome.i18n.getUILanguage());
    if (!uiLang.toLowerCase().startsWith(lang)) {
      log(`skipping ${lang}: browser UI language is "${uiLang}"`);
      return failures;
    }

    // The install opens the onboarding tab; start from a clean window.
    await sleep(1500);
    const blank = await context.newPage();
    await closeExtraPages(context, blank);

    const ctx = { ...env, port };
    const suffix = SCHEME === "dark" ? "-dark" : "";
    const file = (n, name) => path.join(OUT_DIR, `${lang}-${n}-${name}${suffix}.png`);

    let seeded = false;
    const setups = {
      fresh: async () => {},
      seeded: async () => {
        await seed(env, lang);
        seeded = true;
      },
      session: async () => {
        if (!seeded) await setups.seeded();
        await startSession(env);
      },
    };

    for (const { name, n, setup } of PLAN.filter((shot) => !SHOT_FILTER || SHOT_FILTER.has(shot.name))) {
      // One retry: a page can race the service worker right after a storage write.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          await setups[setup]();
          await shots[name](ctx, file(n, name));
          log(`wrote ${displayPath(file(n, name))}`);
          break;
        } catch (e) {
          await closeExtraPages(context, blank);
          if (attempt === 2) failures.push(`${lang} ${name}: ${e.message.split("\n")[0]}`);
          else log(`${lang} ${name} failed (${e.message.split("\n")[0]}), retrying once`);
        }
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return failures;
}

async function main() {
  if (!existsSync(path.join(EXT_SRC, "manifest.json"))) throw new Error("extension/manifest.json not found");
  const badLang = LANGS.find((lang) => !(lang in DEMO));
  if (badLang) throw new Error(`unknown language "${badLang}" (use en, fr or all)`);
  const unknown = SHOT_FILTER ? [...SHOT_FILTER].filter((name) => !PLAN.some((shot) => shot.name === name)) : [];
  if (unknown.length) throw new Error(`unknown shot name(s): ${unknown.join(", ")} (known: ${PLAN.map((shot) => shot.name).join(", ")})`);
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-locales.mjs"), "--quiet"], { stdio: "inherit" });
  await mkdir(OUT_DIR, { recursive: true });

  const server = await startServer();
  const port = server.address().port;
  const failures = [];
  try {
    for (const lang of LANGS) {
      failures.push(...(await runLanguage(lang, port)));
    }
  } finally {
    server.close();
  }

  if (failures.length) {
    console.error(`screenshots: ${failures.length} shot(s) failed`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`screenshots: ${e.stack || e.message}`);
  process.exit(1);
});
