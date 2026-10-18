// Builds the static landing site into landing/public (no dependencies, Node 22).
//   node landing/build.mjs        HTML pages + assets
//   node landing/build.mjs --og   also renders public/assets/og.png with Playwright
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPY } from "./src/copy.mjs";
import { conceptsPage } from "./src/concepts.mjs";
import BASE_CONFIG from "./site.config.mjs";
import { ACCOUNTABILITY_ENABLED, COFFEE_URLS } from "../extension/shared/constants.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
// FOCUS_OUT and FOCUS_ACCOUNTABILITY=1 build a preview of the paid variant elsewhere.
const OUT = path.join(HERE, process.env.FOCUS_OUT || "public");
const PAID = process.env.FOCUS_ACCOUNTABILITY ? process.env.FOCUS_ACCOUNTABILITY === "1" : ACCOUNTABILITY_ENABLED;

// Deployment settings: site.config.mjs, overridden by the optional landing/site.local.mjs (not committed).
let LOCAL_CONFIG = {};
try {
  LOCAL_CONFIG = (await import("./site.local.mjs")).default ?? {};
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
const CONFIG = { ...BASE_CONFIG, ...LOCAL_CONFIG };
const CWS_URL = CONFIG.storeUrl;
const CONTACT_EMAIL = CONFIG.contactEmail;
const SITE_URL = CONFIG.siteUrl;
const GITHUB_URL = CONFIG.githubUrl;
const DATAFAST_ID = CONFIG.datafastId;
const WEB3FORMS_KEY = CONFIG.web3formsKey;

// Star count of the GitHub repository at build time, refreshed in the page by /api/stars.
async function fetchStars() {
  const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?$/.exec(GITHUB_URL ?? "")?.[1];
  if (!repo) return 0;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: { accept: "application/vnd.github+json", "user-agent": "wedeepfocus-build" }, signal: AbortSignal.timeout(5000) });
    return res.ok ? Number((await res.json()).stargazers_count) || 0 : 0;
  } catch {
    return 0;
  }
}
const STARS = await fetchStars();

const commonI18n = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", "common.json"), "utf8"));
const APP_NAME = commonI18n.appName.en;

// Free only (first release) swaps in the *Free copy variants and drops paid-only entries.
const variant = (obj, key) => (!PAID && obj[`${key}Free`] !== undefined ? obj[`${key}Free`] : obj[key]);
const shown = (item) => (PAID ? !item.free : !item.paid) && (GITHUB_URL || !item.openSource);

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICONS = {
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  playCircle: '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6v6.8l5.4-3.4z" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  add: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3"/>',
  pointer: '<path d="M9 4.5l10 5.2-4.4 1.4 3.1 5.4-2.3 1.3-3.1-5.4L9 16z"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  github: '<path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.6-.2.6-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6 0-.6 0-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1.1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5z" fill="currentColor" stroke="none"/>',
  puzzle: '<path d="M10 4.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H17a2 2 0 0 0 0 4h1.5V18a1 1 0 0 1-1 1H14v-1.5a2 2 0 0 0-4 0V19H6.5a1 1 0 0 1-1-1v-3.5H7a2 2 0 0 0 0-4H5.5V7a1 1 0 0 1 1-1H10z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sliders: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9.5h8M8 14.5h8"/><circle cx="10" cy="9.5" r="1.6" fill="currentColor"/><circle cx="14" cy="14.5" r="1.6" fill="currentColor"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v5"/>',
  dots: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="none"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="currentColor" stroke="none"/><path d="M10 9.2v5.6l4.8-2.8z" fill="var(--surface)" stroke="none"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
};

function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${ICONS[name]}</svg>`;
}


function paths(lang) {
  const prefix = lang === "fr" ? "/fr" : "";
  return { home: `${prefix}/`, privacy: `${prefix}/privacy/`, feedback: `${prefix}/feedback/` };
}

function head(t, { title, description, pathname, alternates }) {
  const canonical = SITE_URL ? `<link rel="canonical" href="${SITE_URL}${pathname}">\n  <meta property="og:url" content="${SITE_URL}${pathname}">` : "";
  const ogImage = SITE_URL ? `${SITE_URL}/assets/og.png` : "/assets/og.png";
  return `<!doctype html>
<html lang="${t.lang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="theme-color" content="#faf7f2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#16151a" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/assets/icon-32.png" type="image/png">
  <link rel="apple-touch-icon" href="/assets/icon-128.png">
  ${alternates.map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${SITE_URL}${a.href}">`).join("\n  ")}
  ${canonical}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="preload" href="/assets/fonts/nunito-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="/assets/site.js" defer></script>
  ${DATAFAST_ID && SITE_URL ? `<script defer data-website-id="${esc(DATAFAST_ID)}" data-domain="${esc(new URL(SITE_URL).hostname)}" src="/js/script.js"></script>` : ""}
</head>`;
}

function nav(t, lang, { onHome }) {
  const p = paths(lang);
  const anchor = (id) => (onHome ? `#${id}` : `${p.home}#${id}`);
  return `<header class="nav">
  <div class="container nav-inner">
    <a class="brand" href="${p.home}"><img src="/assets/icon-128.png" alt="" width="30" height="30">${esc(APP_NAME)}</a>
    <nav class="nav-links" aria-label="Main">
      <a href="${anchor("how")}">${esc(t.nav.how)}</a>
      <a href="${anchor("privacy")}">${esc(t.nav.privacy)}</a>
      <a href="${anchor("faq")}">${esc(t.nav.faq)}</a>
      ${GITHUB_URL ? `<a class="nav-github" href="${esc(GITHUB_URL)}" rel="noopener">${icon("github", ' width="18" height="18"')}<span class="nav-github-label">${esc(t.nav.github)}</span><span class="stars">${icon("star")}<span data-stars-count>${STARS || esc(t.nav.star)}</span><span class="sr-only"> ${esc(t.nav.stars)}</span></span></a>` : ""}
      <a class="btn btn-primary btn-sm nav-cta" href="${CWS_URL}">${esc(t.nav.cta)}</a>
    </nav>
  </div>
</header>`;
}

const local = (value, lang) => (typeof value === "string" ? value : value[lang] ?? value.en);
const withSource = (url) => `${url}${url.includes("?") ? "&" : "?"}utm_source=wedeepfocus&utm_medium=website&utm_campaign=cross_promo`;

// "Made by" section: who built it, then their other apps and content (site.config.mjs maker).
function maker(lang) {
  const m = CONFIG.maker;
  if (!m) return "";
  const t = COPY[lang].maker;
  const cards = m.links.map((link) => {
    const logo = link.logo ? `<img src="/assets/brands/${esc(link.logo)}" alt="" width="44" height="44" loading="lazy">` : `<span class="maker-icon">${icon(link.icon ?? "globe")}</span>`;
    return `<a class="maker-card" href="${esc(withSource(link.url))}" target="_blank" rel="noopener">
          ${logo}
          <span class="maker-card-text"><span class="maker-card-name">${esc(link.name)}<span class="maker-tag">${esc(local(link.tag, lang))}</span></span><span class="maker-card-desc">${esc(local(link.text, lang))}</span></span>
        </a>`;
  });
  return `<section class="maker" aria-labelledby="maker-title">
  <div class="container">
    <div class="maker-head reveal">
      <h2 id="maker-title" class="maker-by">${esc(t.by)} <a href="${esc(withSource(m.url))}" target="_blank" rel="noopener">${esc(m.name)}<svg class="bimw" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="22" fill="#0a0a0b"/><text x="26" y="75" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="78" fill="#f7f6f3">B</text><circle cx="80" cy="69" r="9" fill="#ff5c35"/></svg></a></h2>
      <a class="maker-follow" href="${esc(withSource(m.url))}" target="_blank" rel="noopener">${esc(t.follow)} ${icon("arrowRight", ' width="16" height="16"')}</a>
    </div>
    <p class="maker-more reveal">${esc(t.more)}</p>
    <div class="maker-grid reveal">
        ${cards.join("\n        ")}
    </div>
  </div>
</section>`;
}

function footer(t, lang) {
  const p = paths(lang);
  const contact = CONTACT_EMAIL ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(t.footer.contact)}</a>` : "";
  const coffee = lang === "fr" ? COFFEE_URLS.fr : COFFEE_URLS.other;
  return `<footer class="footer">
  <div class="container footer-inner">
    <a class="brand" href="${p.home}"><img src="/assets/icon-128.png" alt="" width="30" height="30">${esc(APP_NAME)}</a>
    <nav class="footer-links" aria-label="Footer">
      <a href="${p.privacy}">${esc(t.footer.privacy)}</a>
      <a href="${p.feedback}">${esc(t.footer.feedback)}</a>
      ${GITHUB_URL ? `<a href="${esc(GITHUB_URL)}" rel="noopener">${esc(t.nav.github)}</a>` : ""}
      ${contact}
      <a href="${t.nav.switchHref}" lang="${lang === "fr" ? "en" : "fr"}">${esc(t.nav.switchLabel)}</a>
    </nav>
    ${coffee ? `<a class="btn btn-coffee btn-sm" href="${esc(coffee)}" target="_blank" rel="noopener noreferrer">${icon("coffee", ' width="18" height="18"')}${esc(t.footer.coffee)}</a>` : ""}
    <p class="footer-legal">© 2026 ${esc(APP_NAME)}. ${esc(t.footer.trademark)}</p>
  </div>
</footer>`;
}

/* ---------- Hero: a browser where visitors switch the session on and try the blocked page ---------- */

// A plain browser window: address bar with the site, the extension icon on the right.
function browser(t, { body, attrs = "" }) {
  return `<div class="browser"${attrs}>
          <div class="browser-bar">
            <span class="browser-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="browser-url">${icon("lock")}<b data-site>${esc(t.mock.sites[0])}</b></span>
            <span class="browser-ext"><img src="/assets/icon-32.png" alt="" width="18" height="18"></span>
          </div>
          <div class="browser-body">${body}</div>
        </div>`;
}

// Any social feed, drawn with soft shapes, scrolling on its own.
function feedMock() {
  const post = (i) => `<div class="post"><div class="post-head"><i class="avatar a${i % 3}"></i><span class="line"></span></div><div class="post-media m${i % 3}"></div><span class="line short"></span></div>`;
  const posts = [0, 1, 2, 3].map(post).join("");
  return `<div class="feed" aria-hidden="true"><div class="feed-track">${posts}${posts}</div></div>`;
}

// What a blocked site shows during a session, with the same steps as the extension: "I really
// need it" asks one question, then the sentence has to be typed by hand (wired up in site.js).
function blockedPage(t) {
  const m = t.mock;
  const sentence = t.ritual.sentence;
  const chip = esc(m.blockedTemplate).replace("{site}", `<b data-site>${esc(m.sites[0])}</b>`);
  return `<div class="blocked-page" data-blocked data-timer-scope>
            <div class="blocked-view" data-view="main">
              <span class="demo-chip">${icon("shield")}<span>${chip}</span></span>
              <div class="focus-timer" data-countdown>${esc(m.timer)}</div>
              <p class="step-hint">${esc(m.left)}</p>
              <p class="why-line">${esc(m.goal)}</p>
              <div class="hero-buttons">
                <button type="button" class="hero-back" data-go="done">${esc(m.back)}</button>
              </div>
              <button type="button" class="link-btn" data-go="question">${esc(m.need)}</button>
            </div>
            <div class="blocked-view" data-view="done" hidden>
              <span class="blocked-icon">${icon("check")}</span>
              <p class="blocked-title" tabindex="-1">${esc(m.done)}</p>
              <p class="step-hint">${esc(m.doneSub)}</p>
              <button type="button" class="pill" data-go="type">${esc(m.seeEnding)}</button>
            </div>
            <div class="blocked-view" data-view="question" hidden>
              <p class="blocked-title" tabindex="-1">${esc(m.question)}</p>
              <p class="step-hint">${esc(m.questionHint)}</p>
              <div class="hero-buttons">
                <button type="button" class="hero-back" data-go="done">${esc(m.no)}</button>
                <button type="button" class="pill" data-go="type">${esc(m.yes)}</button>
              </div>
            </div>
            <div class="blocked-view blocked-type" data-view="type" hidden>
              <p class="blocked-title is-small" tabindex="-1">${esc(t.ritual.typeTitle)}</p>
              <p class="phrase" data-phrase="${esc(sentence)}"><span class="phrase-done"></span><span class="phrase-rest">${esc(sentence)}</span></p>
              <textarea class="type-input" rows="2" data-type-input aria-label="${esc(m.inputLabel)}" placeholder="${esc(m.inputLabel)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-typo="${esc(m.typo)}" data-paste="${esc(m.paste)}"></textarea>
              <div class="typing-meta"><div class="bar"><i data-type-bar></i></div><span data-type-count>0 / ${sentence.length}</span></div>
              <p class="type-error" data-type-error aria-live="polite"></p>
              <div class="hero-buttons">
                <button type="button" class="hero-back" data-type-end disabled>${esc(m.end)}</button>
                <button type="button" class="link-btn" data-go="main">${esc(m.cancel)}</button>
              </div>
            </div>
          </div>`;
}

function hero(t) {
  const h = t.hero;
  const title = esc(h.title).replace("{site}", `<span class="rotator" data-rotator>${esc(t.brands[0][0])}</span>`);
  // Second action: the launch film, full screen (see filmDialog), or "See how it works" without it.
  const secondary = VIDEO
    ? `<button type="button" class="btn btn-ghost" data-film-open>${icon("playCircle", ' width="20" height="20"')}${esc(t.video.cta)}</button>`
    : `<a class="btn btn-ghost" href="#how">${esc(h.secondary)} ${icon("arrowRight", ' width="18" height="18"')}</a>`;
  return `<section class="hero">
    <div class="container">
      <div class="hero-copy">
        <span class="badge">${GITHUB_URL ? `${icon("github")}${esc(h.eyebrow)}` : `${icon("sparkles")}${esc(h.eyebrowClosed)}`}</span>
        <h1>${title}</h1>
        <p class="sub">${esc(GITHUB_URL ? h.sub : h.subClosed)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${CWS_URL}">${esc(h.cta)}${icon("arrowRight", ' class="btn-arrow"')}</a>
          ${secondary}
        </div>
        <p class="hero-note">${icon("shield")}${esc(h.note)}</p>
      </div>
      <div class="hero-visual">
        <div class="session-toggle"><span id="session-label">${esc(h.toggle)}</span><button type="button" class="switch" role="switch" aria-checked="false" aria-labelledby="session-label" data-toggle><i></i></button></div>
        ${browser(t, { attrs: ` data-swap data-sites="${esc(t.brands.map(([, domain]) => domain).join(" "))}" data-names="${esc(t.brands.map(([name]) => name).join("|"))}"`, body: feedMock() + blockedPage(t) })}
        <p class="hero-try">${icon("pointer")}${esc(h.try)}</p>
      </div>
    </div>
  </section>`;
}

// Each "how it works" step shows one small thing to tap (wired up in site.js).
function stepVisual(t, index) {
  const h = t.how;
  if (index === 0) {
    return `<div class="pills" role="group" aria-label="${esc(h.steps[0].title)}" data-demo-groups>${h.sites
      .map((site) => `<button type="button" class="pill" aria-pressed="${site.on}">${icon("check")}${esc(site.name)}</button>`)
      .join("")}</div>`;
  }
  if (index === 1) {
    const presets = h.presets
      .map((p) => `<button type="button" class="pill" role="radio" aria-checked="${p.minutes === 30}" data-minutes="${p.minutes}">${esc(p.label)}</button>`)
      .join("");
    const days = h.days
      .map((d, i) => `<button type="button" class="day" aria-pressed="${i < 5}" aria-label="${esc(h.dayNames[i])}">${esc(d)}</button>`)
      .join("");
    return `<div class="switch-demo" data-switch>
            <div class="segmented" role="tablist">
              <button type="button" role="tab" aria-selected="true" data-tab="now">${esc(h.now)}</button>
              <button type="button" role="tab" aria-selected="false" data-tab="schedule">${esc(h.schedule)}</button>
            </div>
            <div class="switch-panel" data-panel="now">
              <div class="pills" role="radiogroup" aria-label="${esc(h.now)}" data-demo-time data-until="${esc(h.until)}">${presets}</div>
              <p class="step-hint" data-until-text aria-live="polite"></p>
            </div>
            <div class="switch-panel" data-panel="schedule" hidden>
              <div class="days" role="group" aria-label="${esc(h.schedule)}">${days}</div>
              <p class="step-hint">${esc(h.hours)}</p>
            </div>
          </div>`;
  }
  // Step 3: the real blocked page (screenshots from scripts/screenshots.mjs, light and dark).
  const shot = (scheme) => `/assets/shots/blocked-${t.lang}-${scheme}.png`;
  return `<picture class="shot">
            <source srcset="${shot("dark")}" media="(prefers-color-scheme: dark)">
            <img src="${shot("light")}" width="600" height="450" alt="${esc(t.mock.shot)}" loading="lazy">
          </picture>`;
}

// A believable focus history for the stats mock: quieter at first, a 12 day streak at the end.
function dayLevels(weeks, todayIndex) {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const last = (weeks - 1) * 7 + todayIndex;
  return Array.from({ length: weeks * 7 }, (_, i) => {
    if (i > last) return -1;
    const fromEnd = last - i;
    if (fromEnd < 12) return 1 + Math.floor(rand() * 4);
    if (fromEnd === 12) return 0;
    const weekend = i % 7 >= 5;
    const busy = 0.35 + (i / (weeks * 7)) * 0.5;
    return rand() < (weekend ? 0.55 : 1 - busy) ? 0 : Math.min(4, 1 + Math.floor(rand() * 4 * busy));
  });
}

function statsVisual(t) {
  const s = t.stats;
  const cells = dayLevels(20, 2)
    .map((lv) => (lv < 0 ? '<i class="empty"></i>' : `<i class="lv${lv}"></i>`))
    .join("");
  return `<div class="streak-demo" aria-hidden="true">
          <div class="stats-streak"><span class="flame">🔥</span><div><b>${esc(s.streak)}</b><span>${esc(s.best)}</span></div></div>
          <div class="daymap">${cells}</div>
          <div class="legend"><span>${esc(s.less)}</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>${esc(s.more)}</span></div>
        </div>`;
}

function typingVisual(t) {
  const r = t.ritual;
  return `<div class="typing-demo" aria-hidden="true">
          <p class="typing-title">${esc(r.typeTitle)}</p>
          <div class="sentence" data-sentence="${esc(r.sentence)}"><span class="done"></span><span class="caret"></span><span class="rest">${esc(r.sentence)}</span></div>
          <div class="typing-meta"><div class="bar"><i data-typing-bar></i></div><span data-typing-count>0 / ${r.sentence.length}</span></div>
        </div>`;
}

// Paid variant (ACCOUNTABILITY_ENABLED): one small switch, the sentence stays the default.
function endingVisual(t) {
  if (!PAID) return typingVisual(t);
  const r = t.ritual;
  return `<div class="switch-demo" data-switch>
          <div class="segmented" role="tablist">
            <button type="button" role="tab" aria-selected="true" data-tab="type">${esc(r.optType)}</button>
            <button type="button" role="tab" aria-selected="false" data-tab="pay">${esc(r.optPay)}</button>
          </div>
          <div class="switch-panel" data-panel="type">${typingVisual(t)}</div>
          <div class="switch-panel" data-panel="pay" hidden>
            <span class="hero-back">${esc(r.payButton)}</span>
            <p class="step-hint">${esc(r.skip)}</p>
          </div>
        </div>`;
}

function ticksVisual(t) {
  const ticks = GITHUB_URL ? [...t.privacy.ticks, t.privacy.tickOpen] : t.privacy.ticks;
  return `<ul class="ticks">${ticks.map((tick) => `<li><span class="tickbox">${icon("check")}</span>${esc(tick)}</li>`).join("")}</ul>`;
}

// Every feature gets the same row: label, title, one line on one side, one small card on the other.
function row({ id = "", label, title, text = "", extra = "", visual }) {
  return `<section class="row reveal"${id ? ` id="${id}"` : ""}>
        <div class="row-copy">
          <span class="eyebrow">${esc(label)}</span>
          <h2>${esc(title)}</h2>
          ${text ? `<p>${esc(text)}</p>` : ""}${extra}
        </div>
        <div class="demo-card row-visual">
          ${visual}
        </div>
      </section>`;
}

// The launch film (landing/src/video, kept out of git: build it from the focus-lock-video project).
// It opens full screen from the hero; nothing loads until then.
const VIDEO = fs.existsSync(path.join(HERE, "src", "video", "wedeepfocus.mp4"));
function filmDialog(t) {
  if (!VIDEO) return "";
  return `<dialog class="film" data-film aria-label="${esc(t.video.title)}">
  <video src="/assets/video/wedeepfocus.mp4" poster="/assets/video/poster.jpg" preload="none" playsinline controls></video>
  <button type="button" class="film-close" data-film-close aria-label="${esc(t.video.close)}">${icon("x")}</button>
</dialog>`;
}

function landing(lang) {
  const t = COPY[lang];
  const p = paths(lang);
  const title = t.title.replace("{name}", APP_NAME);
  return `${head(t, { title, description: t.description, pathname: p.home, alternates: [{ lang: "en", href: "/" }, { lang: "fr", href: "/fr/" }, { lang: "x-default", href: "/" }] })}
<body>
${nav(t, lang, { onHome: true })}
<main id="main">
  ${hero(t)}

  <section class="section" id="how">
    <div class="container">
      <div class="section-head reveal">
        <span class="eyebrow">${esc(t.how.eyebrow)}</span>
        <h2>${esc(t.how.title)}</h2>
      </div>
      <div class="rows">
      ${[
        ...t.how.steps.map((step, i) => row({ label: step.label, title: step.title, text: step.text, visual: stepVisual(t, i) })),
        row({ label: t.ritual.eyebrow, title: variant(t.ritual, "title"), text: variant(t.ritual, "text"), visual: endingVisual(t) }),
        row({ id: "stats", label: t.stats.eyebrow, title: t.stats.title, text: t.stats.text, visual: statsVisual(t) }),
        row({
          id: "privacy",
          label: t.privacy.eyebrow,
          title: t.privacy.title,
          extra: `<a class="privacy-link" href="${p.privacy}">${esc(t.privacy.link)} ${icon("arrowRight", ' width="18" height="18"')}</a>${GITHUB_URL ? `<br><a class="privacy-link" href="${esc(GITHUB_URL)}" rel="noopener">${icon("github", ' width="18" height="18"')} ${esc(t.privacy.code)} ${icon("arrowRight", ' width="18" height="18"')}</a>` : ""}`,
          visual: ticksVisual(t),
        }),
      ].join("\n      ")}
      </div>
    </div>
  </section>

  <section class="section" id="faq">
    <div class="container">
      <div class="section-head reveal">
        <span class="eyebrow">${esc(t.faq.eyebrow)}</span>
        <h2>${esc(t.faq.title)}</h2>
      </div>
      <div class="faq">
        ${t.faq.items
          .filter(shown)
          .map((item) => `<details class="reveal"><summary>${esc(item.q)}${icon("plus")}</summary><p>${esc(variant(item, "a"))}</p></details>`)
          .join("\n        ")}
      </div>
    </div>
  </section>

  <section class="final">
    <div class="container">
      <div class="final-card reveal">
        <img src="/assets/icon-128.png" alt="" width="56" height="56">
        <h2>${esc(t.final.title)}</h2>
        <p>${esc(t.final.sub)}</p>
        <a class="btn btn-primary" href="${CWS_URL}">${esc(t.final.cta)}${icon("arrowRight", ' class="btn-arrow"')}</a>
      </div>
    </div>
  </section>
</main>
${maker(lang)}
${footer(t, lang)}
${filmDialog(t)}
</body>
</html>
`;
}

// Minimal Markdown for PRIVACY.md: headings, paragraphs, lists, tables, rules, **bold**, `code`, links.
function inline(text) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s)<]+[^\s)<.,;:])/g, '$1<a href="$2" rel="noopener noreferrer">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

function markdown(source) {
  const lines = source.split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (/^---+\s*$/.test(line)) { html.push("<hr>"); i += 1; continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i += 1; continue; }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i += 1; }
      const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      const [headRow, , ...bodyRows] = rows;
      html.push(`<div class="table-wrap"><table><thead><tr>${cells(headRow).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${bodyRows
        .map((row) => `<tr>${cells(row).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2)); i += 1; }
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |---)/.test(lines[i])) { para.push(lines[i].trim()); i += 1; }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return html.join("\n");
}

function privacySource(lang) {
  const source = fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8");
  const split = source.search(/^# .*politique de confidentialité/im);
  const part = (lang === "fr" ? source.slice(split) : source.slice(0, split))
    // Passages about paying to end a session early only apply while payments are on.
    .replace(PAID ? /<!--free-->[\s\S]*?<!--\/free-->/g : /<!--paid-->[\s\S]*?<!--\/paid-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  // Questions go to the contact address when there is one, else to the project's GitHub issues.
  const issues = GITHUB_URL ? `${GITHUB_URL.replace(/\/+$/, "")}/issues` : "";
  const contact = CONTACT_EMAIL ? `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})` : issues ? `[${lang === "fr" ? "ouvre une issue sur GitHub" : "open an issue on GitHub"}](${issues})` : "";
  return part
    .replace(/^Version française plus bas\.\s*$/m, "")
    .replace(/^English version above\.\s*$/m, "")
    .replace(/^---\s*$/gm, "")
    // No contact address and no GitHub: drop the "Questions" line rather than leave it empty.
    .replace(contact ? /\[contact\]/g : /^.*\[contact\].*$/gm, contact);
}

function privacyPage(lang) {
  const t = COPY[lang];
  const p = paths(lang);
  const title = `${t.privacyPage.title} | ${APP_NAME}`;
  return `${head(t, { title, description: t.description, pathname: p.privacy, alternates: [{ lang: "en", href: "/privacy/" }, { lang: "fr", href: "/fr/privacy/" }] })}
<body>
${nav({ ...t, nav: { ...t.nav, switchHref: lang === "fr" ? "/privacy/" : "/fr/privacy/" } }, lang, { onHome: false })}
<main id="main" class="container">
  <article class="doc">
    <a class="doc-back" href="${p.home}">${icon("arrowLeft", ' width="18" height="18"')}${esc(t.privacyPage.back)}</a>
    ${markdown(privacySource(lang))}
  </article>
</main>
${footer({ ...t, nav: { ...t.nav, switchHref: lang === "fr" ? "/privacy/" : "/fr/privacy/" } }, lang)}
</body>
</html>
`;
}

// Feedback form. The extension links here from its menu, and Chrome opens it on uninstall
// (?from=uninstall: a short "why are you leaving" with a few reasons). The form posts to Web3Forms
// from the browser (see site.js); without a key the page offers GitHub issues instead.
function feedbackPage(lang) {
  const t = COPY[lang];
  const f = t.feedback;
  const p = paths(lang);
  const issues = GITHUB_URL ? `${GITHUB_URL.replace(/\/+$/, "")}/issues` : "";
  const html = head(t, { title: `${f.pageTitle} | ${APP_NAME}`, description: t.description, pathname: p.feedback, alternates: [] })
    .replace("</head>", '  <meta name="robots" content="noindex">\n</head>');
  const navT = { ...t, nav: { ...t.nav, switchHref: lang === "fr" ? "/feedback/" : "/fr/feedback/" } };
  const form = WEB3FORMS_KEY
    ? `<form class="feedback-form" data-feedback-form novalidate>
      <div class="pills feedback-reasons" data-reasons hidden>
        ${f.reasons.map((reason) => `<button type="button" class="pill" aria-pressed="false" data-reason="${esc(reason)}">${icon("check")}${esc(reason)}</button>`).join("")}
      </div>
      <label class="field">
        <span>${esc(f.message)}</span>
        <textarea name="message" rows="6" maxlength="3000" placeholder="${esc(f.placeholder)}" data-message></textarea>
      </label>
      <label class="field">
        <span>${esc(f.email)}</span>
        <input type="email" name="email" maxlength="200" autocomplete="email" data-email>
      </label>
      <p class="feedback-error" data-error role="alert" hidden></p>
      <button class="btn btn-primary" type="submit" data-send>${esc(f.send)}</button>
    </form>`
    : "";
  return `${html}
<body>
${nav(navT, lang, { onHome: false })}
<main id="main" class="container">
  <section class="feedback" data-feedback data-key="${esc(WEB3FORMS_KEY ?? "")}" data-app="${esc(APP_NAME)}"
    data-empty="${esc(f.empty)}" data-failed="${esc(f.error)}" data-sending="${esc(f.sending)}">
    <h1 data-leave="${esc(f.leaveTitle)}">${esc(f.title)}</h1>
    <p class="feedback-sub" data-leave="${esc(f.leaveSub)}">${esc(f.sub)}</p>
    ${form}
    <div class="feedback-done" data-done hidden>
      <span class="feedback-done-icon">${icon("check")}</span>
      <p class="feedback-done-title">${esc(f.thanks)}</p>
      <p>${esc(f.thanksSub)}</p>
      <a class="btn btn-ghost" href="${p.home}">${esc(f.back)}</a>
    </div>
    ${issues ? `<a class="feedback-github" href="${esc(issues)}" rel="noopener">${icon("github", ' width="16" height="16"')}${esc(f.github)}</a>` : ""}
  </section>
</main>
${footer(navT, lang)}
</body>
</html>
`;
}

// Stripe sends the buyer here after paying (or canceling). The extension tab notices the payment
// on its own; this page only says so. ?canceled=1 switches the text (see site.js).
function paidPage(lang) {
  const t = COPY[lang];
  const p = paths(lang);
  const pathname = `${lang === "fr" ? "/fr" : ""}/paid/`;
  const html = head(t, { title: `${t.paid.title} | ${APP_NAME}`, description: t.description, pathname, alternates: [] })
    .replace("</head>", '  <meta name="robots" content="noindex">\n</head>');
  return `${html}
<body>
<main id="main" class="container">
  <section class="paid" data-paid>
    <span class="paid-icon" data-paid-icon>${icon("check")}</span>
    <h1 data-paid-title data-canceled="${esc(t.paid.canceledTitle)}">${esc(t.paid.title)}</h1>
    <p data-paid-sub data-canceled="${esc(t.paid.canceledSub)}">${esc(t.paid.sub)}</p>
    <a class="btn btn-ghost" href="${p.home}">${esc(APP_NAME)}</a>
  </section>
</main>
</body>
</html>
`;
}

function write(relPath, content) {
  const file = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copy(from, relPath) {
  const file = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(from, file);
}

function checkNoDashes() {
  const forbidden = [String.fromCodePoint(0x2014), String.fromCodePoint(0x2013)];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(OUT).filter((f) => /\.(html|css|js|txt|xml)$/.test(f))) {
    const text = fs.readFileSync(file, "utf8");
    if (forbidden.some((c) => text.includes(c))) throw new Error(`Forbidden dash in ${path.relative(OUT, file)}`);
  }
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  write("index.html", landing("en"));
  write("fr/index.html", landing("fr"));
  write("privacy/index.html", privacyPage("en"));
  write("paid/index.html", paidPage("en"));
  write("fr/paid/index.html", paidPage("fr"));
  write("fr/privacy/index.html", privacyPage("fr"));
  write("feedback/index.html", feedbackPage("en"));
  write("fr/feedback/index.html", feedbackPage("fr"));
  copy(path.join(HERE, "src", "styles.css"), "assets/styles.css");
  copy(path.join(HERE, "src", "site.js"), "assets/site.js");
  for (const font of ["nunito-latin-wght-normal.woff2", "nunito-latin-ext-wght-normal.woff2", "OFL.txt"]) {
    copy(path.join(ROOT, "extension", "fonts", font), `assets/fonts/${font}`);
  }
  copy(path.join(ROOT, "extension", "assets", "icon-128.png"), "assets/icon-128.png");
  copy(path.join(ROOT, "extension", "assets", "icon-32.png"), "assets/icon-32.png");
  for (const file of fs.readdirSync(path.join(HERE, "src", "shots"))) copy(path.join(HERE, "src", "shots", file), `assets/shots/${file}`);
  if (VIDEO) for (const file of ["wedeepfocus.mp4", "poster.jpg"]) copy(path.join(HERE, "src", "video", file), `assets/video/${file}`);
  for (const link of CONFIG.maker?.links ?? []) {
    if (link.logo) copy(path.join(HERE, "src", "brands", link.logo), `assets/brands/${link.logo}`);
  }
  const og = path.join(HERE, "src", "og.png");
  if (fs.existsSync(og)) copy(og, "assets/og.png");
  write("robots.txt", `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ""}`);
  if (SITE_URL) {
    const urls = ["/", "/fr/", "/privacy/", "/fr/privacy/"].map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join("\n");
    write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  }
  checkNoDashes();
  console.log(`landing: built ${path.relative(ROOT, OUT)} (${APP_NAME})`);
}

// Renders the social preview (1200x630) from the built home page's hero.
async function renderOg() {
  const { chromium } = await import("playwright");
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(OUT, url);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".woff2": "font/woff2" };
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: ".nav{display:none}.hero{padding:56px 0 0}.hero-actions,.hero-note{display:none}" });
  // Switch the session on so the preview shows the blocked page rather than a feed.
  await page.click("[data-toggle]");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(HERE, "src", "og.png") });
  await browser.close();
  server.close();
  copy(path.join(HERE, "src", "og.png"), "assets/og.png");
  console.log("landing: rendered src/og.png");
}

// Review page for ideas not in the extension yet: /concepts/, not indexed, not linked.
function buildConcepts() {
  const t = COPY.en;
  const page = head(t, { title: `Concepts | ${APP_NAME}`, description: t.description, pathname: "/concepts/", alternates: [] })
    .replace("</head>", '  <meta name="robots" content="noindex">\n  <link rel="stylesheet" href="/assets/concepts.css">\n  <script src="/assets/concepts.js" defer></script>\n</head>');
  write("concepts/index.html", `${page}\n<body>\n${conceptsPage({ icon, esc, appName: APP_NAME })}\n</body>\n</html>\n`);
  copy(path.join(HERE, "src", "concepts.css"), "assets/concepts.css");
  copy(path.join(HERE, "src", "concepts.js"), "assets/concepts.js");
  checkNoDashes();
  console.log("landing: concepts page in public/concepts/");
}

build();
if (process.argv.includes("--concepts")) buildConcepts();
if (process.argv.includes("--og")) await renderOg();
