// Home page: the current session at a glance, or one button to start one.
import { api, onStateChange } from "../shared/api.js";
import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { mountFeedbackLink } from "../ui/feedback-link.js";
import { icon } from "../shared/icons.js";
import { formatCountdown, formatClock } from "../shared/format.js";
import { SESSION_PRESETS } from "../shared/constants.js";

const START_MINUTES = SESSION_PRESETS[0];
let locale = uiLocale();
const $ = (selector) => document.querySelector(selector);
const idle = $('[data-testid="home-idle"]');
const active = $('[data-testid="home-active"]');
const start = $('[data-testid="home-start"]');
const error = $('[data-role="error"]');
const countdown = $('[data-role="countdown"]');
const until = $('[data-role="until"]');
const pinTip = $('[data-testid="home-pin-tip"]');
const PIN_TIP_HIDDEN = "wedeepfocus.pinTipHidden"; // this page's own localStorage, a display preference
let block = null;
let ticker = null;

init();

async function init() {
  applyI18n();
  document.title = t("home_page_title", [t("appName")]);
  mountFeedbackLink();
  for (const slot of document.querySelectorAll("[data-icon]")) {
    slot.replaceChildren(icon(slot.dataset.icon));
    slot.setAttribute("aria-hidden", "true");
  }
  start.textContent = t("home_start", [String(START_MINUTES)]);
  start.addEventListener("click", startSession);
  setUpPinTip();
  onStateChange(load);
  await load();
  $(".page").removeAttribute("aria-busy");
}

async function load() {
  const res = await api.getState();
  if (res?.ok === false || !res?.block) return;
  block = res.block;
  if (res.locale) locale = res.locale;
  render();
}

function render() {
  const isActive = Boolean(block?.active);
  idle.hidden = isActive;
  active.hidden = !isActive;
  clearInterval(ticker);
  if (!isActive) return;
  const hasEnd = typeof block.until === "number";
  countdown.hidden = !hasEnd;
  until.textContent = hasEnd ? t("popup_until", [formatClock(block.until, locale)]) : t("popup_no_end");
  if (hasEnd) {
    tick();
    ticker = setInterval(tick, 1000);
  }
}

function tick() {
  const left = block.until - Date.now();
  if (left <= 0) {
    clearInterval(ticker);
    load();
    return;
  }
  countdown.textContent = formatCountdown(left);
}

// A one-line reminder while the icon is not pinned. It goes away by itself once pinned, or for
// good with its close button.
function setUpPinTip() {
  $('[data-role="pin-tip-text"]').textContent = t("home_pin_tip", [t("appName")]);
  $('[data-testid="home-pin-hide"]').addEventListener("click", () => {
    try {
      localStorage.setItem(PIN_TIP_HIDDEN, "1");
    } catch {
      // Storage unavailable: hidden for this visit only.
    }
    pinTip.hidden = true;
  });
  chrome.action?.onUserSettingsChanged?.addListener(renderPinTip);
  window.addEventListener("focus", renderPinTip);
  renderPinTip();
}

async function renderPinTip() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(PIN_TIP_HIDDEN) === "1";
  } catch {
    // Storage unavailable: treat as not dismissed.
  }
  let pinned = true;
  try {
    pinned = (await chrome.action.getUserSettings())?.isOnToolbar !== false;
  } catch {
    // The browser cannot tell: no reminder.
  }
  pinTip.hidden = dismissed || pinned;
}

async function startSession() {
  start.disabled = true;
  error.hidden = true;
  const res = await api.startSession(START_MINUTES);
  start.disabled = false;
  if (res?.ok === false) {
    const key = `reason_${res.reason}`;
    const message = res.reason ? t(key) : key;
    error.textContent = message !== key ? message : t("popup_error_generic");
    error.hidden = false;
    return;
  }
  if (res?.block) {
    block = res.block;
    render();
  } else {
    load();
  }
}
