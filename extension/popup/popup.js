import { api, onStateChange } from "../shared/api.js";
import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { icon } from "../shared/icons.js";
import { formatCountdown, formatClock, formatWeekdayClock, localDayKey } from "../shared/format.js";
import { normalizeDomain, originPatterns, findBlockingDomain } from "../shared/domains.js";
import { SESSION_PRESETS, SESSION_MIN, SESSION_MAX, EXTEND_MINUTES } from "../shared/constants.js";
import { coffeeUrl } from "../shared/payment.js";
import { feedbackUrl } from "../shared/feedback.js";
import { streaks } from "../shared/stats.js";
import { reviewUrl, shouldAskRating, rateLater } from "../shared/rating.js";

const byId = (id) => document.getElementById(id);
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const LONG_HOST_CHARS = 28;
// The answer to "Rate it", a display preference in the extension's own localStorage (like Home's pin tip).
const RATE_PREFS = "wedeepfocus.rate";
const HOST_DISPLAY_MAX = 80;

const els = {
  skeleton: byId("skeleton"),
  loadError: byId("load-error"),
  retry: byId("retry"),
  main: byId("main"),
  finishSetup: byTestId("popup-finish-setup"),
  missingBanner: byId("missing-banner"),
  missingText: byId("missing-text"),
  grantMissing: byTestId("popup-grant-missing"),
  notice: byId("notice"),
  noticeText: byId("notice-text"),
  noticeClose: byId("notice-close"),
  status: byId("status"),
  statusTitle: byId("status-title"),
  statusSub: byId("status-sub"),
  statusBody: byId("status-body"),
  countdown: byId("countdown"),
  progress: byId("progress"),
  progressFill: byId("progress-fill"),
  extend: byTestId("popup-extend"),
  extendLabel: byId("extend-label"),
  endSession: byTestId("popup-end-session"),
  quick: byId("quick"),
  quickGrid: byId("quick-grid"),
  startOther: byTestId("popup-start-other"),
  customForm: byId("custom-form"),
  customInput: byTestId("popup-custom-minutes"),
  customStart: byTestId("popup-custom-start"),
  customError: byTestId("popup-custom-error"),
  site: byId("site"),
  siteHost: byId("site-host"),
  siteNote: byId("site-note"),
  blockSite: byTestId("popup-block-site"),
  alreadyBlocked: byTestId("popup-already-blocked"),
  allowSite: byTestId("popup-allow-site"),
  siteUnsupported: byId("site-unsupported"),
  feedback: byTestId("popup-feedback"),
  stats: byTestId("popup-stats"),
  footerSettings: byTestId("popup-footer-settings"),
  streak: byTestId("popup-streak"),
  coffee: byTestId("popup-coffee"),
  rate: byId("rate"),
  rateOpen: byTestId("popup-rate-open"),
  rateLater: byTestId("popup-rate-later"),
};

let state = null;
let currentTab = null;
let tabPromise = Promise.resolve(null);
let refreshToken = 0;
let lastBoundaryRefresh = 0;
let tickTimer = null;
let alignTimer = null;
let actionPending = false;

/* ---------- helpers ---------- */

function isOk(res) {
  return Boolean(res) && res.ok !== false;
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch {
    return { ok: false, reason: null, failed: true };
  }
}

function reasonText(reason) {
  if (reason) {
    const key = `reason_${reason}`;
    const message = t(key);
    if (message && message !== key) return message;
  }
  return t("popup_error_generic");
}

function locale() {
  return state?.locale || uiLocale();
}

function isToday(ms) {
  return localDayKey(ms) === localDayKey(Date.now());
}

// Skips identical writes so aria-live regions do not re-announce on every re-render.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mountIcons(root) {
  for (const placeholder of root.querySelectorAll("[data-icon]")) {
    try {
      const svg = icon(placeholder.dataset.icon, placeholder.getAttribute("class") || "icon");
      if (!svg) continue;
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      placeholder.replaceWith(svg);
    } catch {
      // A missing icon must never break the popup; the empty placeholder stays.
    }
  }
}

function setBusy(button, busy) {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true");
  else button.removeAttribute("aria-busy");
}

function requestOrigins(origins) {
  try {
    return Promise.resolve(chrome.permissions.request({ origins })).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/* ---------- notice ---------- */

function showNotice(text, tone = "error") {
  els.noticeText.textContent = text;
  els.notice.classList.toggle("is-error", tone === "error");
  els.notice.classList.toggle("is-warning", tone === "warning");
  els.notice.hidden = false;
}

function clearNotice() {
  els.notice.hidden = true;
  els.noticeText.textContent = "";
}

/* ---------- current tab ---------- */

function isStoreUrl(url) {
  return url.hostname === "chromewebstore.google.com"
    || (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"));
}

function describeTab(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  return {
    host,
    display: host.replace(/^www\./, ""),
    domain: isStoreUrl(url) ? null : normalizeDomain(rawUrl),
  };
}

// When popup.html is opened as a regular tab (tests, screenshots), the active tab is the popup itself:
// fall back to the most recently used other tab of the window. A real popup is never a tab.
async function readActiveTab() {
  try {
    const self = await chrome.tabs.getCurrent();
    if (!self) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      return describeTab(active?.url);
    }
    const others = (await chrome.tabs.query({ windowId: self.windowId }))
      .filter((tab) => tab.id !== self.id && typeof tab.lastAccessed === "number")
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
    return describeTab(others[0]?.url);
  } catch {
    return null;
  }
}

/* ---------- state loading ---------- */

async function fetchState() {
  return safeCall(() => api.getState());
}

async function refresh(attempt = 0) {
  const token = ++refreshToken;
  const [res, tab] = await Promise.all([fetchState(), tabPromise]);
  if (token !== refreshToken) return;
  currentTab = tab;
  // One quiet retry covers a service worker that is still waking up on the very first load.
  if (!state && !isOk(res) && attempt === 0) {
    setTimeout(() => refresh(1), 400);
    return;
  }
  applyState(res);
}

function applyState(res) {
  if (!isOk(res) || !res.block) {
    if (!state) showLoadError();
    return;
  }
  state = res;
  render();
}

function applyActionResult(res) {
  if (res?.block) {
    refreshToken++;
    applyState(res);
  } else {
    refresh();
  }
}

function showLoadError() {
  stopTicker();
  document.body.classList.remove("is-loading");
  els.skeleton.hidden = true;
  els.main.hidden = true;
  els.loadError.hidden = false;
}

/* ---------- rendering ---------- */

function render() {
  document.body.classList.remove("is-loading");
  els.skeleton.hidden = true;
  els.loadError.hidden = true;
  els.main.hidden = false;

  const settings = state.settings || {};
  const active = Boolean(state.block.active);

  els.finishSetup.hidden = Boolean(settings.prefs?.onboarded);
  renderMissing(state.missing || []);
  renderStatus();
  renderQuickStart(active);
  renderCurrentSite();
  renderRate(active);
  startTicker();
}

// Sites without host access are still blocked (Chrome's error page); access upgrades them to the goal page.
function renderMissing(missing) {
  const count = missing.length;
  els.missingBanner.hidden = count === 0;
  if (count === 0) return;
  setText(els.missingText, count === 1
    ? t("popup_missing_one", [missing[0]])
    : t("popup_missing_many", [String(count)]));
}

function renderStatus() {
  const { block } = state;
  const active = Boolean(block.active);
  els.status.dataset.state = active ? "active" : "idle";
  els.statusBody.hidden = !active;

  if (!active) {
    setText(els.statusTitle, t("popup_idle_title"));
    setSubline(idleSubline(block.nextStart));
    return;
  }

  setText(els.statusTitle, t(block.source === "schedule" ? "popup_title_schedule" : "popup_title_session"));
  setSubline(activeSubline(block.until, blockedCount()));
  const hasEnd = typeof block.until === "number";
  els.countdown.hidden = !hasEnd;
  els.progress.hidden = !hasEnd || typeof block.startedAt !== "number";
  updateCountdown();
}

// Every listed site is blocked, with or without host access (goal page or Chrome's error page), except live passes.
function blockedCount() {
  if (Array.isArray(state.enforced)) return state.enforced.length;
  const now = Date.now();
  const passes = state.passes || {};
  return (state.domains || []).filter((domain) => !(passes[domain] > now)).length;
}

function setSubline(text) {
  setText(els.statusSub, text);
  els.statusSub.hidden = !text;
}

// Sessions are the default: without an upcoming scheduled block, the quick start says it all.
function idleSubline(nextStart) {
  if (typeof nextStart !== "number") return "";
  return isToday(nextStart)
    ? t("popup_next_block_today", [formatClock(nextStart, locale())])
    : t("popup_next_block", [formatWeekdayClock(nextStart, locale())]);
}

function activeSubline(until, siteCount) {
  const ends = typeof until === "number" ? t("popup_until", [dayClock(until)]) : t("popup_no_end");

  let sites;
  if (siteCount === 0) sites = t("popup_sites_zero");
  else if (siteCount === 1) sites = t("popup_sites_one");
  else sites = t("popup_sites_many", [String(siteCount)]);

  return t("popup_meta_join", [ends, sites]);
}

function dayClock(ms) {
  return isToday(ms) ? formatClock(ms, locale()) : formatWeekdayClock(ms, locale());
}

function renderQuickStart(active) {
  if (active && els.quick.contains(document.activeElement)) els.status.focus();
  els.quick.hidden = active;
  if (active) closeCustom();
}

function renderCurrentSite() {
  const tab = currentTab;
  els.site.hidden = !tab;
  if (!tab) return;

  renderHost(tab.display);
  els.siteHost.title = tab.host;

  const domains = state.domains || [];
  const missing = state.missing || [];
  const blocking = tab.domain ? findBlockingDomain(tab.host, domains) : null;
  const needsPermission = Boolean(blocking) && missing.includes(blocking);

  els.siteUnsupported.hidden = Boolean(tab.domain);
  els.blockSite.hidden = !tab.domain || Boolean(blocking);
  els.alreadyBlocked.hidden = !blocking || needsPermission;
  els.allowSite.hidden = !needsPermission;
  els.allowSite.dataset.domain = needsPermission ? blocking : "";
  els.siteNote.hidden = !needsPermission;
}

// Long hostnames shrink a little and wrap between labels, keeping the last two together
// ("vercel.app"); a single label wider than the row may still break inside (CSS). Absurdly
// long ones keep their start and their meaningful end.
function renderHost(host) {
  const text = host.length > HOST_DISPLAY_MAX
    ? `${host.slice(0, 30)}\u2026${host.slice(-(HOST_DISPLAY_MAX - 31))}`
    : host;
  if (els.siteHost.textContent === text) return;
  const labels = text.split(".");
  els.siteHost.replaceChildren(...labels.flatMap((label, index) => {
    if (index === labels.length - 1) return [label];
    return index < labels.length - 2 ? [`${label}.`, document.createElement("wbr")] : [`${label}.`];
  }));
  els.siteHost.classList.toggle("is-long", text.length > LONG_HOST_CHARS);
}

/* ---------- countdown ticker ---------- */

function updateCountdown() {
  const { block } = state;
  if (!block.active || typeof block.until !== "number") return;
  const now = Date.now();
  const remaining = block.until - now;
  setText(els.countdown, formatCountdown(Math.max(0, remaining)));

  if (typeof block.startedAt === "number") {
    const total = block.until - block.startedAt;
    const ratio = total > 0 ? clamp((now - block.startedAt) / total, 0, 1) : 1;
    els.progressFill.style.width = `${(ratio * 100).toFixed(2)}%`;
    els.progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
}

function tick() {
  if (!state) return;
  const { block } = state;
  const now = Date.now();
  if (block.active) {
    updateCountdown();
    if (typeof block.until === "number" && now >= block.until) refreshAtBoundary(now);
  } else if (typeof block.nextStart === "number" && now >= block.nextStart) {
    refreshAtBoundary(now);
  }
}

// Throttled so a background that is a little late to transition never causes a refresh loop.
function refreshAtBoundary(now) {
  if (now - lastBoundaryRefresh < 2000) return;
  lastBoundaryRefresh = now;
  refresh();
}

function stopTicker() {
  clearTimeout(alignTimer);
  clearInterval(tickTimer);
  alignTimer = null;
  tickTimer = null;
}

// Ticks every second, aligned to the moment the displayed (ceiled) second changes.
function startTicker() {
  stopTicker();
  tick();
  const { block } = state;
  const offset = block.active && typeof block.until === "number"
    ? ((block.until - Date.now()) % 1000 + 1000) % 1000
    : 0;
  alignTimer = setTimeout(() => {
    tick();
    tickTimer = setInterval(tick, 1000);
  }, offset + 20);
}

/* ---------- actions ---------- */

function sessionButtons() {
  return [...els.quickGrid.querySelectorAll("[data-minutes]"), els.customStart];
}

async function startSession(minutes) {
  if (actionPending) return;
  actionPending = true;
  clearNotice();
  const buttons = sessionButtons();
  buttons.forEach((button) => setBusy(button, true));

  const res = await safeCall(() => api.startSession(minutes));

  actionPending = false;
  buttons.forEach((button) => setBusy(button, false));
  if (!isOk(res)) {
    showNotice(reasonText(res?.reason));
    return;
  }
  els.customInput.value = "";
  applyActionResult(res);
}

// The ritual (question, then pay or type) runs in its own tab: the popup closes on blur.
async function openEndSession() {
  const url = chrome.runtime.getURL("blocked/blocked.html?end=1");
  await safeCall(() => chrome.tabs.create({ url }));
  window.close();
}

async function extendSession() {
  if (actionPending) return;
  actionPending = true;
  clearNotice();
  setBusy(els.extend, true);

  const res = await safeCall(() => api.extendSession(EXTEND_MINUTES));

  actionPending = false;
  setBusy(els.extend, false);
  if (!isOk(res)) {
    showNotice(reasonText(res?.reason));
    return;
  }
  applyActionResult(res);
}

function parseMinutes(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return minutes >= SESSION_MIN && minutes <= SESSION_MAX ? minutes : null;
}

function showCustomError() {
  els.customError.textContent = t("popup_custom_error", [String(SESSION_MIN), String(SESSION_MAX)]);
  els.customError.hidden = false;
  els.customInput.setAttribute("aria-invalid", "true");
  els.customInput.classList.remove("shake");
  void els.customInput.offsetWidth;
  els.customInput.classList.add("shake");
}

function hideCustomError() {
  els.customError.hidden = true;
  els.customError.textContent = "";
  els.customInput.removeAttribute("aria-invalid");
}

function openCustom() {
  els.customForm.hidden = false;
  els.startOther.setAttribute("aria-expanded", "true");
  els.customInput.focus();
}

function closeCustom() {
  els.customForm.hidden = true;
  els.startOther.setAttribute("aria-expanded", "false");
  hideCustomError();
}

function onCustomSubmit(event) {
  event.preventDefault();
  const minutes = parseMinutes(els.customInput.value);
  if (minutes === null) {
    showCustomError();
    els.customInput.focus();
    return;
  }
  hideCustomError();
  startSession(minutes);
}

// Must stay synchronous up to chrome.permissions.request: Chrome only shows the prompt inside the user gesture.
function onBlockSite() {
  const domain = currentTab?.domain;
  if (!domain || !state || actionPending) return;
  const stored = state.settings?.sites?.custom;
  const custom = Array.isArray(stored) ? stored : [];
  const nextCustom = custom.includes(domain) ? custom : [...custom, domain];

  const saved = safeCall(() => api.saveSettings({ sites: { custom: nextCustom } }));
  const granted = requestOrigins(originPatterns([domain]));

  actionPending = true;
  clearNotice();
  setBusy(els.blockSite, true);
  Promise.all([saved, granted]).then(([saveRes]) => {
    actionPending = false;
    setBusy(els.blockSite, false);
    // A declined prompt needs no notice: the site row and the banner switch to "Allow".
    if (!isOk(saveRes)) showNotice(reasonText(saveRes?.reason));
    refresh();
  });
}

// Permission changes do not touch storage, so onStateChange will not fire: refresh by hand.
function grantOrigins(domains, button) {
  if (!domains.length) return;
  const granted = requestOrigins(originPatterns(domains));
  setBusy(button, true);
  granted.then(() => {
    setBusy(button, false);
    refresh();
  });
}

async function openOptions(event) {
  event?.preventDefault();
  const res = await safeCall(() => api.openOptions());
  if (res?.failed) {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      // Nothing else to try; the popup stays open.
    }
  }
}

async function openOnboarding() {
  const res = await safeCall(() => api.openOnboarding());
  if (res?.failed) {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    } catch {
      showNotice(t("popup_error_generic"));
    }
  }
}

function openCoffee(event) {
  event.preventDefault();
  chrome.tabs.create({ url: coffeeUrl(locale()) }).catch(() => showNotice(t("popup_error_generic")));
}

/* ---------- setup ---------- */

function buildPresetButtons() {
  for (const minutes of SESSION_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn quick-btn";
    button.dataset.testid = `popup-start-${minutes}`;
    button.dataset.minutes = String(minutes);
    // Whole hours read better as "1 h" than "60 min".
    button.textContent = minutes % 60 === 0 ? t("common_hours_short", [String(minutes / 60)]) : t("common_minutes_short", [String(minutes)]);
    els.quickGrid.insertBefore(button, els.startOther);
  }
}

function setStaticTexts() {
  els.extendLabel.textContent = t("popup_extend", [String(EXTEND_MINUTES)]);
  els.customInput.min = String(SESSION_MIN);
  els.customInput.max = String(SESSION_MAX);
  els.customInput.placeholder = t("popup_custom_placeholder", [String(SESSION_MIN), String(SESSION_MAX)]);
  const coffee = coffeeUrl(locale());
  els.coffee.href = coffee;
  els.coffee.hidden = !coffee;
  els.feedback.hidden = !feedbackUrl(locale(), "popup");
  const brandIcon = document.querySelector(".brand-icon");
  const hideBrokenIcon = () => { brandIcon.hidden = true; };
  brandIcon.addEventListener("error", hideBrokenIcon);
  if (brandIcon.complete && brandIcon.naturalWidth === 0) hideBrokenIcon();
}

function bindEvents() {
  els.rateOpen.addEventListener("click", openReview);
  els.rateLater.addEventListener("click", postponeRating);
  els.quickGrid.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-minutes]");
    if (preset) startSession(Number(preset.dataset.minutes));
  });
  els.startOther.addEventListener("click", () => {
    if (els.customForm.hidden) openCustom();
    else closeCustom();
  });
  els.customForm.addEventListener("submit", onCustomSubmit);
  els.customInput.addEventListener("input", () => {
    if (!els.customError.hidden) hideCustomError();
  });
  els.customInput.addEventListener("animationend", () => els.customInput.classList.remove("shake"));
  els.extend.addEventListener("click", extendSession);
  els.endSession.addEventListener("click", openEndSession);
  els.blockSite.addEventListener("click", onBlockSite);
  els.allowSite.addEventListener("click", () => {
    const domain = els.allowSite.dataset.domain;
    if (domain) grantOrigins([domain], els.allowSite);
  });
  els.grantMissing.addEventListener("click", () => grantOrigins(state?.missing || [], els.grantMissing));
  els.finishSetup.addEventListener("click", openOnboarding);
  els.feedback.addEventListener("click", openFeedback);
  els.footerSettings.addEventListener("click", openOptions);
  els.stats.addEventListener("click", openStats);
  els.streak.addEventListener("click", openStats);
  els.coffee.addEventListener("click", openCoffee);
  els.noticeClose.addEventListener("click", clearNotice);
  els.retry.addEventListener("click", () => {
    els.loadError.hidden = true;
    els.skeleton.hidden = false;
    refresh(1);
  });
}

function init() {
  try {
    applyI18n();
    mountIcons(document);
    buildPresetButtons();
    setStaticTexts();
    bindEvents();
  } finally {
    document.body.classList.remove("is-booting");
  }

  tabPromise = readActiveTab();
  onStateChange(() => {
    refresh();
    renderStreak();
  });
  refresh();
  renderStreak();
}

function readRatePrefs() {
  try {
    return JSON.parse(localStorage.getItem(RATE_PREFS));
  } catch {
    return null;
  }
}

function saveRatePrefs(prefs) {
  try {
    localStorage.setItem(RATE_PREFS, JSON.stringify(prefs));
  } catch {
    // Storage unavailable: the question may come back, nothing breaks.
  }
}

async function renderRate(active) {
  if (active || !reviewUrl()) {
    els.rate.hidden = true;
    return;
  }
  const stored = await safeCall(() => chrome.storage.local.get({ history: null }));
  // A block may have started while storage answered.
  const ask = !state?.block?.active && shouldAskRating({ history: stored?.history, active: false, prefs: readRatePrefs(), now: Date.now() });
  els.rate.hidden = !ask;
}

async function openReview() {
  saveRatePrefs({ rated: true });
  els.rate.hidden = true;
  await safeCall(() => chrome.tabs.create({ url: reviewUrl() }));
  window.close();
}

function postponeRating() {
  saveRatePrefs(rateLater(readRatePrefs(), Date.now()));
  els.rate.hidden = true;
}

// "12 days 🔥" in the header, from the local history (days with protected focus in a row).
async function renderStreak() {
  const stored = await safeCall(() => chrome.storage.local.get({ history: null }));
  const { current } = streaks(stored?.history, localDayKey(Date.now()));
  els.streak.hidden = current === 0;
  els.streak.textContent = current === 1 ? t("popup_streak_one") : t("popup_streak_many", [String(current)]);
}

async function openFeedback() {
  const url = feedbackUrl(locale(), "popup", chrome.runtime.getManifest().version);
  if (!url) return;
  await safeCall(() => chrome.tabs.create({ url }));
  window.close();
}

async function openStats() {
  await safeCall(() => chrome.tabs.create({ url: chrome.runtime.getURL("stats/stats.html") }));
  window.close();
}

init();
