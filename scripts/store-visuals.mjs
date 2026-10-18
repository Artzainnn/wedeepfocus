#!/usr/bin/env node
// Marketing visuals for the Chrome Web Store and Product Hunt, built from real captures of the
// extension (loaded in Chromium, like the end-to-end tests) laid out with a headline.
//
//   node scripts/store-visuals.mjs            captures + every visual, English and French
//   node scripts/store-visuals.mjs --compose  reuse the last captures, only lay out again
//   --scheme=light                             light visuals (dark by default)
//
// Writes into store/upload/ (not committed):
//   en/, fr/          five 1280x800 Chrome Web Store screenshots
//   promo-small-440x280.png, marquee-1400x560.png
//   producthunt/      six 1270x760 gallery images and a 240x240 thumbnail (English)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { launch, socialOnlySettings } from "../tests/e2e/helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD = path.join(ROOT, "store", "upload");
const RAW = path.join(UPLOAD, "raw");
const LANGS = ["en", "fr"];
const SCHEME = process.argv.includes("--scheme=light") ? "light" : "dark";

const COPY = {
  en: {
    why: "I'm building something that matters to me.",
    brand: "Free Chrome extension",
    slides: [
      { name: "blocked", title: "<em>Instagram</em> can wait.", sub: "Blocked sites show the time left and why you're doing this. Not the feed." },
      { name: "popup", title: "Focus in two clicks.", sub: "Click the icon, pick 15 min, 30 min or 1 h. Need more time? Add 15 minutes." },
      { name: "groups", title: "Pick what distracts you.", sub: "Social media, video, news, shopping, or your own sites. Turn a group on, done." },
      { name: "why", title: "Remember <em>why</em>.", sub: "One sentence, picked or written by you. It's what you see instead of the feed." },
      { name: "friction", title: "Ending early takes effort.", sub: "One honest question, then a sentence typed by hand. No copy-paste allowed." },
    ],
    open: { title: "Free. Open source. <em>No account.</em>", sub: "No tracking, no ads. Your settings never leave your browser.", ticks: ["MIT license, code on GitHub", "Works in Chrome, Arc, Brave and Edge", "English and French"] },
    tag: "Block distracting sites. Remember why.",
  },
  fr: {
    why: "Je construis quelque chose qui me tient à cœur.",
    brand: "Extension Chrome gratuite",
    slides: [
      { name: "blocked", title: "<em>Instagram</em> peut attendre.", sub: "Les sites bloqués affichent le temps restant et pourquoi tu fais ça. Pas le fil d'actu." },
      { name: "popup", title: "Concentre-toi en deux clics.", sub: "Clique sur l'icône, choisis 15 min, 30 min ou 1 h. Besoin de plus ? Ajoute 15 minutes." },
      { name: "groups", title: "Choisis ce qui te distrait.", sub: "Réseaux sociaux, vidéo, actus, shopping, ou tes propres sites. Active un groupe, c'est tout." },
      { name: "why", title: "Rappelle-toi <em>pourquoi</em>.", sub: "Une phrase, choisie ou écrite par toi. C'est ce que tu vois à la place du fil d'actu." },
      { name: "friction", title: "Arrêter avant la fin, ça se mérite.", sub: "Une question honnête, puis une phrase tapée à la main. Copier-coller interdit." },
    ],
    tag: "Bloque les sites qui te distraient. Rappelle-toi pourquoi.",
  },
};

/* ---------- 1. Captures ---------- */

async function capture(lang) {
  const out = path.join(RAW, lang);
  fs.mkdirSync(out, { recursive: true });
  const ctx = await launch({ locale: lang, accountability: false });
  const shot = async (locator, name) => locator.screenshot({ path: path.join(out, `${name}.png`) });
  // A page section with some room around it, so its heading does not touch the card's edge.
  const roomy = async (locator, name, room = 36) => {
    const box = await locator.boundingBox();
    const page = locator.page();
    // Less room below: the wizard's Continue button sits right under each step.
    await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: Math.max(0, box.x - room), y: Math.max(0, box.y - room), width: box.width + room * 2, height: box.height + room + 6 } });
  };
  try {
    // Fresh install: the onboarding's groups and why steps.
    const onb = await ctx.openExtensionPage("onboarding/onboarding.html");
    await onb.emulateMedia({ colorScheme: SCHEME });
    await onb.setViewportSize({ width: 1280, height: 1000 });
    await onb.getByTestId("onb-step-1").waitFor({ state: "visible" });
    await onb.waitForTimeout(500);
    await roomy(onb.locator("#step-1"), "groups");
    await onb.getByTestId("onb-next").click();
    await onb.getByTestId("onb-step-2").waitFor({ state: "visible" });
    await onb.getByTestId("onb-next").click();
    await onb.getByTestId("onb-step-3").waitFor({ state: "visible" });
    await onb.getByTestId("onb-goal-option-proud").click();
    await onb.waitForTimeout(500);
    await roomy(onb.locator("#step-3"), "why");
    await onb.close();

    // Demo settings: social media on, the why from the copy.
    await ctx.setSync({ ...socialOnlySettings(), goals: { items: [COPY[lang].why], showQuote: true }, prefs: { onboarded: true } });

    // Popup before a session, zoomed so it reads in the store.
    const zoomed = async (page) => page.evaluate(() => { document.body.style.zoom = "1.6"; });
    const idle = await ctx.openExtensionPage("popup/popup.html");
    await idle.emulateMedia({ colorScheme: SCHEME });
    await idle.setViewportSize({ width: 700, height: 1000 });
    await idle.getByTestId("popup-feedback").waitFor({ state: "visible" });
    await zoomed(idle);
    await idle.waitForTimeout(600);
    await shot(idle.locator(".popup"), "popup-idle");
    await idle.close();

    // A session: the blocked page, its "end early" steps and the popup counting down.
    await ctx.startSessionDirect(43);
    const blocked = await ctx.newPage();
    await blocked.emulateMedia({ colorScheme: SCHEME });
    await blocked.setViewportSize({ width: 1280, height: 800 });
    await ctx.gotoBlocked(blocked, ctx.site("instagram.com", "/"));
    await blocked.getByTestId("blocked-main").waitFor({ state: "visible" });
    await blocked.waitForTimeout(800);
    await blocked.screenshot({ path: path.join(out, "blocked.png"), clip: { x: 290, y: 150, width: 700, height: 500 } });
    await blocked.getByTestId("blocked-need").click();
    await blocked.getByTestId("friction-next-1").click();
    const input = blocked.getByTestId("friction-input");
    await input.waitFor({ state: "visible" });
    const phrase = (await blocked.getByTestId("friction-phrase").textContent()).trim();
    await input.click();
    await blocked.keyboard.type(phrase.slice(0, 46), { delay: 15 });
    await blocked.waitForTimeout(400);
    await shot(blocked.locator(".friction-card"), "friction");
    await blocked.close();

    const active = await ctx.openExtensionPage("popup/popup.html");
    await active.emulateMedia({ colorScheme: SCHEME });
    await active.setViewportSize({ width: 700, height: 1000 });
    await active.getByTestId("popup-extend").waitFor({ state: "visible" });
    await zoomed(active);
    await active.waitForTimeout(600);
    await shot(active.locator(".popup"), "popup-active");
    await active.close();
  } finally {
    await ctx.close();
  }
  console.log(`store-visuals: captured ${lang}`);
}

/* ---------- 2. Layouts ---------- */

const ICON = pathToFileURL(path.join(ROOT, "store", "wedeepfocus-logo-1024.png")).href;
const FONT = pathToFileURL(path.join(ROOT, "extension", "fonts", "nunito-latin-wght-normal.woff2")).href;
const FONT_EXT = pathToFileURL(path.join(ROOT, "extension", "fonts", "nunito-latin-ext-wght-normal.woff2")).href;
const raw = (lang, name) => pathToFileURL(path.join(RAW, lang, `${name}.png`)).href;

// Colors of the website's tokens, dark (default) or light.
const THEME = SCHEME === "dark"
  ? { bg: "#16151a", text: "#f3f1ee", text2: "#b3afba", accent: "#86a8ff", chipBg: "#1f2a47", chipText: "#a9c1ff", g1: "#1d2744", g2: "#3a2614",
      surface: "#201f26", bar: "#2a2931", line: "rgba(255, 255, 255, 0.1)", dot: "rgba(255, 255, 255, 0.22)", shadow: "0 2px 6px rgba(0, 0, 0, 0.35), 0 30px 80px rgba(0, 0, 0, 0.55)", tickBg: "#f3f1ee", tickText: "#16151a", logoRing: "0 0 0 1px rgba(255, 255, 255, 0.14)" }
  : { bg: "#faf7f2", text: "#232129", text2: "#66626e", accent: "#4f7df0", chipBg: "#e8efff", chipText: "#2f56b8", g1: "#dfe8ff", g2: "#ffe3c4",
      surface: "#ffffff", bar: "#f3eee7", line: "rgba(35, 33, 41, 0.1)", dot: "rgba(35, 33, 41, 0.18)", shadow: "0 2px 6px rgba(35, 33, 41, 0.05), 0 30px 70px rgba(35, 33, 41, 0.14)", tickBg: "#232129", tickText: "#ffffff", logoRing: "none" };

const CSS = `
@font-face { font-family: Nunito; src: url("${FONT}") format("woff2"); font-weight: 200 1000; }
@font-face { font-family: Nunito; src: url("${FONT_EXT}") format("woff2"); font-weight: 200 1000; unicode-range: U+0100-024F; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { position: relative; font-family: Nunito, sans-serif; color: ${THEME.text}; background: ${THEME.bg}; -webkit-font-smoothing: antialiased; }
.glow { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.55; }
.g1 { width: 46vw; height: 46vw; right: -10vw; top: -14vw; background: ${THEME.g1}; }
.slide { position: absolute; inset: 0; display: grid; grid-template-columns: 0.82fr 1fr; align-items: center; gap: 3.6vw; padding: 0 5.6vw; }
.brand { display: inline-flex; align-items: center; gap: 0.8vw; font-size: 1.5vw; font-weight: 800; }
.brand img { width: 2.6vw; height: 2.6vw; border-radius: 0.7vw; box-shadow: ${THEME.logoRing}; }
.chip { display: inline-block; margin-top: 2.2vw; padding: 0.45vw 1vw; border-radius: 999px; background: ${THEME.chipBg}; color: ${THEME.chipText}; font-size: 1.15vw; font-weight: 800; }
h1 { margin-top: 1.4vw; font-size: 4.5vw; line-height: 1.04; letter-spacing: -0.03em; font-weight: 850; text-wrap: balance; }
h1 em { font-style: normal; color: ${THEME.accent}; }
.sub { margin-top: 1.6vw; font-size: 1.75vw; line-height: 1.45; color: ${THEME.text2}; text-wrap: pretty; }
.visual { display: flex; align-items: center; justify-content: center; min-width: 0; }
.frame { width: 100%; border-radius: 1.4vw; background: ${THEME.surface}; border: 1px solid ${THEME.line}; box-shadow: ${THEME.shadow}; overflow: hidden; }
.bar { display: flex; align-items: center; gap: 0.9vw; height: 3.4vw; padding: 0 1.2vw; background: ${THEME.bar}; border-bottom: 1px solid ${THEME.line}; }
.bar i { width: 0.8vw; height: 0.8vw; border-radius: 50%; background: ${THEME.dot}; }
.url { flex: 1; height: 2.1vw; margin-left: 0.6vw; display: flex; align-items: center; gap: 0.6vw; padding: 0 1vw; border-radius: 0.7vw; background: ${THEME.surface}; font-size: 1.05vw; font-weight: 700; color: ${THEME.text2}; }
.url img { width: 1.3vw; height: 1.3vw; border-radius: 0.3vw; }
.frame > img { display: block; width: 100%; }
.card { max-width: 100%; max-height: 82vh; border-radius: 1.6vw; border: 1px solid ${THEME.line}; box-shadow: ${THEME.shadow}; }
.duo { position: relative; width: 100%; height: 78vh; }
.duo img { position: absolute; width: 58%; border-radius: 1.6vw; border: 1px solid ${THEME.line}; box-shadow: ${THEME.shadow}; }
.duo .back { left: 0; top: 0; opacity: 0.9; }
.duo .front { right: 0; bottom: 0; }
.ticks { list-style: none; padding: 0; margin-top: 2.4vw; display: grid; gap: 1.1vw; font-size: 1.7vw; font-weight: 750; }
.ticks li { display: flex; align-items: center; gap: 1vw; }
.ticks b { width: 2.2vw; height: 2.2vw; flex: none; display: grid; place-items: center; border-radius: 0.6vw; background: ${THEME.tickBg}; color: ${THEME.tickText}; font-size: 1.3vw; }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 8vw; }
.center .logo { width: 11vw; height: 11vw; border-radius: 2.6vw; box-shadow: ${THEME.logoRing}, ${THEME.shadow}; }
.center h1 { font-size: 6vw; margin-top: 2.6vw; }
.center .sub { max-width: 60vw; }
.ticks-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2vw 2.4vw; font-size: 1.5vw; }
.center h1 { text-wrap: balance; }
`;

// One soft blue glow in the top right corner.
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="glow g1"></div>${body}</body></html>`;

function visualFor(lang, name) {
  if (name === "blocked") {
    return `<div class="frame"><div class="bar"><i></i><i></i><i></i><span class="url">instagram.com</span></div><img src="${raw(lang, "blocked")}"></div>`;
  }
  if (name === "popup") {
    return `<div class="duo"><img class="back" src="${raw(lang, "popup-idle")}"><img class="front" src="${raw(lang, "popup-active")}"></div>`;
  }
  return `<img class="card" src="${raw(lang, name)}">`;
}

function slide(lang, s) {
  const c = COPY[lang];
  return page(`<div class="slide"><div>
      <span class="brand"><img src="${ICON}">WeDeepFocus</span><br>
      <span class="chip">${c.brand}</span>
      <h1>${s.title}</h1>
      <p class="sub">${s.sub}</p>
    </div><div class="visual">${visualFor(lang, s.name)}</div></div>`);
}

function openSlide() {
  const o = COPY.en.open;
  return page(`<div class="center"><img class="logo" src="${ICON}"><h1>${o.title}</h1><p class="sub">${o.sub}</p>
      <ul class="ticks ticks-row">${o.ticks.map((t) => `<li><b>✓</b>${t}</li>`).join("")}</ul></div>`);
}

function heroSlide(lang) {
  const c = COPY[lang];
  return page(`<div class="center"><img class="logo" src="${ICON}"><h1>${c.slides[0].title}</h1><p class="sub">${c.tag}</p></div>`);
}

const MARQUEE_CSS = `<style>.slide { grid-template-columns: 0.9fr 1fr; } h1 { font-size: 5vw; } .sub { font-size: 1.7vw; } .frame { width: 92%; }</style>`;
const PROMO = (lang) => page(`<style>body { display: flex; flex-direction: column; justify-content: center; padding: 0 9vw; } h1 { font-size: 9.6vw; margin-top: 4vw; } .brand { font-size: 5.4vw; gap: 2.6vw; } .brand img { width: 10vw; height: 10vw; border-radius: 2.6vw; }</style>
  <span class="brand"><img src="${ICON}">WeDeepFocus</span><h1>${COPY[lang].slides[0].title}</h1>`);

/* ---------- 3. Render ---------- */

async function render() {
  const browser = await chromium.launch({ channel: "chromium" });
  const tmp = path.join(RAW, "html");
  fs.mkdirSync(tmp, { recursive: true });
  const out = async (html, file, width, height) => {
    const htmlFile = path.join(tmp, `${path.basename(file, ".png")}.html`);
    fs.writeFileSync(htmlFile, html);
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await p.goto(pathToFileURL(htmlFile).href);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file });
    await p.close();
  };
  for (const lang of LANGS) {
    for (const [i, s] of COPY[lang].slides.entries()) {
      await out(slide(lang, s), path.join(UPLOAD, lang, `${lang}-${i + 1}-${s.name}.png`), 1280, 800);
    }
  }
  await out(PROMO("en"), path.join(UPLOAD, "promo-small-440x280.png"), 440, 280);
  await out(slide("en", COPY.en.slides[0]).replace("</head>", `${MARQUEE_CSS}</head>`), path.join(UPLOAD, "marquee-1400x560.png"), 1400, 560);
  const ph = path.join(UPLOAD, "producthunt");
  await out(heroSlide("en"), path.join(ph, "1-hero.png"), 1270, 760);
  for (const [i, s] of COPY.en.slides.entries()) await out(slide("en", s), path.join(ph, `${i + 2}-${s.name}.png`), 1270, 760);
  await out(openSlide(), path.join(ph, "7-open-source.png"), 1270, 760);
  await out(page(`<img src="${ICON}" style="position:absolute;inset:0;width:100%;height:100%">`), path.join(ph, "thumbnail-240.png"), 240, 240);
  await browser.close();
  console.log(`store-visuals: wrote ${path.relative(ROOT, UPLOAD)}`);
}

// Old file names from the plain screenshots, replaced by the visuals above.
for (const lang of LANGS) {
  const dir = path.join(UPLOAD, lang);
  if (fs.existsSync(dir)) for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file));
}
if (!process.argv.includes("--compose")) for (const lang of LANGS) await capture(lang);
await render();
