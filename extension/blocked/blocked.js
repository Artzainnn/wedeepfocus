import { api, onStateChange } from "../shared/api.js";
import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { findBlockingDomain } from "../shared/domains.js";
import { isValidPrefix, isComplete, normalizeForCompare } from "../shared/friction.js";
import { formatCountdown, formatClock, formatDurationShort, formatWeekdayClock } from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { ACCOUNTABILITY_ENABLED, CUSTOM_AMOUNT_MAX, CUSTOM_AMOUNT_MIN, DEFAULT_AMOUNT, PAYMENT_AMOUNTS } from "../shared/constants.js";
import { createCheckout, formatAmount, isPresetAmount, isValidAmount, newPaymentToken, paymentCurrency, verifyPayment } from "../shared/payment.js";

// Steps of the ritual that ends a session early. "waiting" shares the pay step's dot.
const STEP_ORDER = { question: 0, pay: 1, waiting: 1, type: 2 };
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 30 * 60 * 1000;
// Always refused, whatever the payload.
const BLOCKED_INPUT_TYPES = new Set([
  "insertFromPaste",
  "insertFromDrop",
  "insertFromYank",
  "insertFromPasteAsQuotation",
]);
const LINE_BREAK_INPUT_TYPES = new Set(["insertLineBreak", "insertParagraph"]);
// Outside IME composition, one keystroke adds at most this many characters.
// Anything bigger arrived through a path that skipped beforeinput: treat it as a paste.
const MAX_KEYSTROKE_GROWTH = 2;
const ERROR_MIN_VISIBLE_MS = 1200;
const STATE_RETRIES = 3;
const END_REFRESH_THROTTLE_MS = 4000;
const LEAVE_STAT_TIMEOUT_MS = 1500;
// Invisible characters (soft hyphens, direction marks, controls) pasted into a custom sentence
// can't be seen, so they can't be typed: they are dropped. Joiners and emoji tag characters
// stay, they are part of how emoji (and some scripts) are written.
const INVISIBLE_CHARS = /(?![\u200c\u200d\u{e0020}-\u{e007f}])[\p{Cc}\p{Cf}]/gu;
// The accents hint only shows when the comparison really ignores them.
const ACCENTS_OPTIONAL = normalizeForCompare("\u00e9") === "e";
const COMBINING_ACCENT = /[\u0300-\u036f]/;

const locale = uiLocale();
const framed = isFramed();
// Opened from the popup ("End session early"): no blocked site, the ritual starts right away.
const endMode = new URLSearchParams(location.search).get("end") === "1";
const target = framed || endMode ? null : parseTarget(location.hash);
const graphemes = graphemeSegmenter();

const q = (selector) => document.querySelector(selector);
const byRole = (name) => q(`[data-role="${name}"]`);
const byTestId = (id) => q(`[data-testid="${id}"]`);

const el = {
  page: q("#page"),
  views: [...document.querySelectorAll("[data-view]")],
  hostText: byRole("host-text"),
  timer: byRole("timer"),
  countdown: byTestId("blocked-countdown"),
  until: byRole("until"),
  noEnd: byRole("no-end"),
  goal: byTestId("blocked-goals"),
  goalText: byRole("goal-text"),
  goalEmpty: byRole("goal-empty"),
  openOptions: byRole("open-options"),
  need: byTestId("blocked-need"),
  backButtons: [...document.querySelectorAll('[data-role="back"]')],
  steps: [...document.querySelectorAll("[data-step]")],
  dotsBox: byRole("dots"),
  stepLabel: byRole("step-label"),
  questionHint: byRole("question-hint"),
  next: byTestId("friction-next-1"),
  payForm: byRole("pay-form"),
  amounts: byRole("amounts"),
  amountOther: byTestId("friction-amount-other"),
  amountField: byRole("amount-field"),
  amountInput: byTestId("friction-amount-input"),
  affixBefore: byRole("affix-before"),
  affixAfter: byRole("affix-after"),
  amountError: byTestId("friction-amount-error"),
  payBtn: byTestId("friction-pay"),
  payLabel: byRole("pay-label"),
  paySlots: [...document.querySelectorAll('[data-role="pay-slot"]')],
  payExtras: byRole("pay-extras"),
  payError: byTestId("friction-pay-error"),
  payErrorText: byRole("pay-error-text"),
  payRetry: byTestId("friction-pay-retry"),
  skip: byTestId("friction-skip"),
  waitingTitle: byRole("waiting-title"),
  reopen: byTestId("friction-reopen"),
  waitingBack: byTestId("friction-confirm-back"),
  phrase: byTestId("friction-phrase"),
  phraseDone: byRole("phrase-done"),
  phraseRest: byRole("phrase-rest"),
  phraseHint: byRole("phrase-hint"),
  typingBox: byRole("typing-box"),
  input: byTestId("friction-input"),
  meter: byRole("meter"),
  meterFill: byRole("meter-fill"),
  counter: byRole("counter"),
  error: byTestId("friction-error"),
  unlock: byTestId("friction-unlock"),
  cancel: byTestId("friction-cancel"),
  freeView: q('[data-view="free"]'),
  freeTitle: byRole("free-title"),
  freeSub: byRole("free-sub"),
  continueBtn: byTestId("blocked-continue"),
  continueLabel: byRole("continue-label"),
  closeTab: byTestId("friction-close"),
};

const ui = {
  state: null,
  degraded: false,
  view: null,
  mode: "main", // "main" | "friction" while the block applies
  step: null, // "question" | "pay" | "waiting" | "type"
  ended: false,
  amount: DEFAULT_AMOUNT,
  customAmount: false,
  paying: false,
  payment: null, // { sessionId, token, url, amount, startedAt }
  pollTimer: 0,
  domain: null,
  until: null,
  tickTimer: 0,
  lastEndRefresh: 0,
  goalKey: null,
  statRecorded: false,
  leaving: false,
  unlocking: false,
  navigating: false,
  refreshSeq: 0,
};

const typing = {
  phrase: "",
  total: 0,
  lastValid: "",
  composing: false,
  errorShownAt: 0,
  errorTimer: 0,
};

init();

function init() {
  applyI18n();
  document.documentElement.lang = locale;
  mountIcons();
  setupTyping();
  bindEvents();
  document.title = hostLine();
  window.addEventListener("hashchange", () => location.reload());
  refresh();
  onStateChange(() => refresh());
}

/* ---------- Target URL ---------- */

function isFramed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function parseTarget(hash) {
  const raw = (hash || "").replace(/^#/, "").trim();
  if (!raw) return null;
  const url = tryParseUrl(raw) ?? tryParseUrl(safeDecode(raw));
  // Only web pages: anything else (javascript:, data:, chrome:) could run in or escape this extension page.
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host) return null;
  return { href: url.href, host };
}

function tryParseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function canUnlock() {
  return (Boolean(target) || endMode) && !framed && !ui.degraded;
}

function hostLine() {
  return target ? t("blocked_host", [target.host]) : t("blocked_host_generic");
}

/* ---------- State ---------- */

async function refresh(attempt = 0) {
  const seq = ++ui.refreshSeq;
  const state = await safeCall(() => api.getState());
  if (seq !== ui.refreshSeq) return;
  if (state && state.ok !== false) {
    render(state);
    return;
  }
  if (attempt < STATE_RETRIES) {
    setTimeout(() => {
      if (seq === ui.refreshSeq) refresh(attempt + 1);
    }, 400 * (attempt + 1));
    return;
  }
  if (!ui.state) render(null);
}

function render(state) {
  if (ui.navigating || ui.ended) return;
  ui.state = state;
  ui.degraded = !state;
  applyPhrase(unlockPhrase(state?.settings));
  const now = Date.now();
  // Without a background answer, assume the block applies (never let a failure open the site).
  const block = state?.block ?? { active: true, until: null };
  const active = Boolean(block.active);
  const listedDomain = target ? blockingDomain(target.host, state) : null;
  ui.domain = target ? listedDomain ?? target.host : null;
  ui.until = active && Number.isFinite(block.until) ? block.until : null;

  const passUntil = ui.domain ? Number(state?.passes?.[ui.domain]) || 0 : 0;
  const passActive = passUntil > now;
  // Unknown lists count as listed, so a malformed answer never opens the site.
  const listed = !target || listedDomain !== null || !hasDomainLists(state);

  if (!ui.degraded && (!active || passActive || !listed)) {
    stopPolling();
    renderFree({ active });
    return;
  }

  if (endMode) {
    renderMain(state);
    ui.mode = "friction";
    if (!ui.step) goToStep("question");
    refreshFrictionText();
    showView("friction");
    return;
  }

  if (!ui.statRecorded && !framed && !ui.degraded) {
    ui.statRecorded = true;
    safeCall(() => api.recordStat("blocked"));
  }
  renderMain(state);
  if (ui.mode === "friction" && canUnlock()) {
    refreshFrictionText();
    showView("friction");
  } else {
    ui.mode = "main";
    showView("main");
  }
}

// Being on the list is what counts, not host access: sites without permission are blocked too
// (Chrome's error page through the fallback rule). `enforced` is merged in case it ever holds
// domains `domains` lacks (strict snapshot).
function blockingDomain(host, state) {
  const lists = [state?.domains, state?.enforced].filter(Array.isArray);
  return findBlockingDomain(host, lists.flat());
}

function hasDomainLists(state) {
  return Array.isArray(state?.domains) || Array.isArray(state?.enforced);
}

function showView(name) {
  if (ui.view === name) return;
  ui.view = name;
  for (const section of el.views) section.hidden = section.dataset.view !== name;
  el.page.removeAttribute("aria-busy");
}

/* ---------- Main view ---------- */

function renderMain(state) {
  document.title = hostLine();
  el.hostText.textContent = hostLine();

  const hasEnd = ui.until !== null;
  el.timer.hidden = !hasEnd;
  el.noEnd.hidden = hasEnd || ui.degraded;
  if (hasEnd) el.until.textContent = t("blocked_until", [formatClock(ui.until, locale)]);
  startTicker();

  const goals = state?.settings?.goals;
  el.goal.hidden = ui.degraded;
  renderGoal(goals);

  el.need.hidden = !canUnlock();
  for (const button of el.backButtons) button.hidden = framed;
}

// The user's why (stored as the single goal). Settings saved before V3 may still hold several:
// the first non-empty one wins. Nothing saved yet (onboarding skipped): the default suggestion.
function renderGoal(goals) {
  const items = Array.isArray(goals?.items) ? goals.items : [];
  const goal = items.map((item) => (typeof item === "string" ? item.trim() : "")).find(Boolean) ?? t("goal_option_finish");
  if (goal === ui.goalKey) return;
  ui.goalKey = goal;
  el.goalText.textContent = goal;
  el.goalText.hidden = !goal;
  el.goalEmpty.hidden = Boolean(goal);
}

function startTicker() {
  clearTimeout(ui.tickTimer);
  if (ui.until === null) return;
  const step = () => {
    tick();
    // Re-align on the next second boundary so the display never skips a second.
    ui.tickTimer = setTimeout(step, 1000 - (Date.now() % 1000) + 20);
  };
  step();
}

function tick() {
  const left = ui.until - Date.now();
  el.countdown.textContent = formatCountdown(Math.max(0, left));
  // Schedule ends don't touch storage, so onStateChange won't fire: re-check ourselves.
  if (left <= 0 && Date.now() - ui.lastEndRefresh > END_REFRESH_THROTTLE_MS) {
    ui.lastEndRefresh = Date.now();
    refresh();
  }
}

/* ---------- Not blocked anymore ---------- */

function renderFree({ active }) {
  clearTimeout(ui.tickTimer);
  ui.mode = "main";
  document.title = t("appName");
  el.freeView.dataset.testid = "blocked-free";
  if (target) {
    el.freeTitle.textContent = t("blocked_free_title");
    el.freeSub.textContent = active ? t("blocked_free_open") : t("blocked_free_ended");
  } else if (endMode) {
    el.freeTitle.textContent = t("blocked_no_session_title");
    el.freeSub.textContent = t("blocked_no_session_sub");
  } else {
    el.freeTitle.textContent = t("blocked_free_title_generic");
    el.freeSub.textContent = t("blocked_free_generic_sub");
  }
  el.freeSub.hidden = false;
  setOutcomeButtons();
  showView("free");
}

// The session was ended early (paid or typed): this view stays, whatever storage says next.
function renderEnded(state) {
  stopPolling();
  clearTimeout(ui.tickTimer);
  ui.ended = true;
  ui.mode = "main";
  document.title = t("appName");
  el.freeView.dataset.testid = "friction-ended";
  el.freeTitle.textContent = t("blocked_ended_title");
  const nextStart = state?.block?.nextStart;
  el.freeSub.textContent = Number.isFinite(nextStart)
    ? t("blocked_ended_next", [formatWeekdayClock(nextStart, locale)])
    : t("blocked_ended_sub");
  el.freeSub.hidden = false;
  setOutcomeButtons();
  ui.view = null;
  showView("free");
  el.freeTitle.focus();
}

function setOutcomeButtons() {
  if (target) el.continueLabel.textContent = t("blocked_continue", [target.host]);
  el.continueBtn.hidden = !target;
  el.closeTab.hidden = Boolean(target) || framed;
}

function continueToSite() {
  if (!target) return;
  ui.navigating = true;
  location.replace(target.href);
}

/* ---------- Leaving ---------- */

async function backToWork() {
  if (ui.leaving || framed) return;
  ui.leaving = true;
  setBackButtonsDisabled(true);
  await withTimeout(safeCall(() => api.recordStat("resisted")), LEAVE_STAT_TIMEOUT_MS);
  await leaveTab();
}

async function leaveTab() {
  try {
    const current = await chrome.tabs.getCurrent();
    if (current && current.id !== undefined) {
      const siblings = await chrome.tabs.query({ windowId: current.windowId });
      if (siblings.length > 1) await chrome.tabs.remove(current.id);
      else await chrome.tabs.update(current.id, { url: "chrome://newtab/" });
      return;
    }
  } catch {
    // Fall back to closing the window below.
  }
  window.close();
  setTimeout(() => {
    ui.leaving = false;
    setBackButtonsDisabled(false);
  }, 600);
}

function setBackButtonsDisabled(disabled) {
  for (const button of el.backButtons) button.disabled = disabled;
  el.closeTab.disabled = disabled;
}

async function openOptions(event) {
  event.preventDefault();
  const res = await safeCall(() => api.openOptions());
  if (!res || res.ok === false) safeCall(() => chrome.runtime.openOptionsPage());
}

/* ---------- Friction flow ---------- */

function openFriction() {
  if (!canUnlock()) return;
  ui.mode = "friction";
  showView("friction");
  goToStep("question");
}

function closeFriction() {
  if (endMode) {
    leaveTab();
    return;
  }
  stopPolling();
  ui.mode = "main";
  ui.step = null;
  resetTyping();
  showView("main");
  el.need.focus();
}

function moneyMode() {
  return ACCOUNTABILITY_ENABLED && ui.state?.settings?.unlock?.mode === "money";
}

function stepCount() {
  return moneyMode() ? 3 : 2;
}

function goToStep(name) {
  if (ui.step !== "waiting" || name !== "waiting") stopPolling();
  ui.step = name;
  for (const step of el.steps) step.hidden = step.dataset.step !== name;
  // Payment errors and "Skip for free" sit under whichever payment step is shown.
  const slot = el.paySlots.find((node) => node.closest("[data-step]")?.dataset.step === name);
  if (slot && el.payExtras.parentElement !== slot) slot.append(el.payExtras);
  renderDots(name);

  if (name === "type") {
    refreshFrictionText();
    resetTyping();
    el.input.focus();
  } else if (name === "pay") {
    renderAmounts();
    el.steps.find((step) => step.dataset.step === name)?.querySelector(".question")?.focus();
  } else {
    if (name === "question") el.questionHint.textContent = questionHintText();
    el.steps.find((step) => step.dataset.step === name)?.querySelector(".question")?.focus();
  }
}

function renderDots(name) {
  const total = stepCount();
  const index = moneyMode() ? STEP_ORDER[name] : name === "question" ? 0 : 1;
  const dots = Array.from({ length: total }, (_, i) => {
    const dot = document.createElement("i");
    dot.classList.toggle("is-current", i === index);
    dot.classList.toggle("is-done", i < index);
    return dot;
  });
  el.dotsBox.replaceChildren(...dots);
  el.stepLabel.textContent = t("blocked_step", [String(index + 1), String(total)]);
}

function questionHintText() {
  const left = ui.until === null ? 0 : ui.until - Date.now();
  // Non-breaking spaces keep "42 min" or "1 h 05" on one line.
  if (left > 0) return t("blocked_friction_hint", [formatDurationShort(left, locale).replace(/ /g, " ")]);
  return t("blocked_friction_hint_generic");
}

function refreshFrictionText() {
  if (endMode) document.title = t("blocked_pay_title");
}

function afterQuestion() {
  if (moneyMode()) initAmount();
  goToStep(moneyMode() ? "pay" : "type");
}

// Free way: the typed sentence ends the whole session.
async function unlock() {
  if (ui.unlocking || !canUnlock() || typing.composing) return;
  if (!isComplete(typing.lastValid, typing.phrase)) return;
  ui.unlocking = true;
  el.unlock.disabled = true;
  el.unlock.setAttribute("aria-busy", "true");
  const res = await safeCall(() => api.endSession({ method: "sentence" }));
  ui.unlocking = false;
  el.unlock.removeAttribute("aria-busy");
  if (res && res.ok !== false) {
    renderEnded(res);
    return;
  }
  updateTypingUI();
  showError(reasonText(res?.reason));
  refresh();
}

/* ---------- Paying to end the session ---------- */

function storedAmount() {
  const amount = Number(ui.state?.settings?.unlock?.amount);
  return isValidAmount(amount) ? amount : DEFAULT_AMOUNT;
}

// Each time the pay step opens, it starts from the amount chosen in the settings.
function initAmount() {
  ui.amount = storedAmount();
  ui.customAmount = !isPresetAmount(ui.amount);
  el.amountInput.value = ui.customAmount ? String(ui.amount) : "";
}

function renderAmounts() {
  const chips = PAYMENT_AMOUNTS.map((amount) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "amount-chip";
    chip.dataset.testid = `friction-amount-${amount}`;
    chip.dataset.amount = String(amount);
    chip.textContent = formatAmount(amount, locale);
    chip.setAttribute("aria-pressed", String(!ui.customAmount && ui.amount === amount));
    chip.addEventListener("click", () => chooseAmount(amount));
    return chip;
  });
  el.amounts.replaceChildren(...chips, el.amountOther);
  el.amountOther.setAttribute("aria-pressed", String(ui.customAmount));
  el.amountOther.setAttribute("aria-expanded", String(ui.customAmount));
  el.amountField.hidden = !ui.customAmount;
  const [before, after] = currencyAffixes();
  el.affixBefore.textContent = before;
  el.affixAfter.textContent = after;
  el.amountInput.min = String(CUSTOM_AMOUNT_MIN);
  el.amountInput.max = String(CUSTOM_AMOUNT_MAX);
  if (ui.customAmount && document.activeElement !== el.amountInput) el.amountInput.value = String(ui.amount);
  setAmountError("");
  renderPayLabel();
}

function chooseAmount(amount) {
  ui.amount = amount;
  ui.customAmount = false;
  hidePayError();
  renderAmounts();
}

function chooseOther() {
  ui.customAmount = true;
  // A custom amount chosen in the settings is the natural starting value.
  if (isPresetAmount(ui.amount) && !isPresetAmount(storedAmount())) ui.amount = storedAmount();
  renderAmounts();
  el.amountInput.focus();
  el.amountInput.select();
}

function onAmountInput() {
  const value = Number(el.amountInput.value);
  if (isValidAmount(value)) {
    ui.amount = value;
    setAmountError("");
  }
  renderPayLabel();
}

function currentAmount() {
  if (!ui.customAmount) return ui.amount;
  const value = Number(el.amountInput.value);
  return isValidAmount(value) ? value : null;
}

// "€" before or after the number, as Intl places it for this language.
function currencyAffixes() {
  const sample = formatAmount(1, locale);
  const index = sample.indexOf("1");
  return index < 0 ? ["", ""] : [sample.slice(0, index).trim(), sample.slice(index + 1).trim()];
}

function renderPayLabel() {
  const amount = currentAmount();
  el.payLabel.textContent = t("blocked_pay_button", [formatAmount(amount ?? ui.amount, locale)]);
}

function setAmountError(message) {
  el.amountError.textContent = message;
  el.amountError.hidden = !message;
  el.amountInput.toggleAttribute("aria-invalid", Boolean(message));
}

async function startPayment(event) {
  event?.preventDefault();
  if (ui.paying) return;
  const amount = currentAmount();
  if (amount === null) {
    setAmountError(t("blocked_amount_error", [formatAmount(CUSTOM_AMOUNT_MIN, locale), formatAmount(CUSTOM_AMOUNT_MAX, locale)]));
    el.amountInput.focus();
    return;
  }
  ui.paying = true;
  hidePayError();
  el.payBtn.disabled = true;
  el.payBtn.setAttribute("aria-busy", "true");
  const token = newPaymentToken();
  const res = await createCheckout({ amount, token, locale });
  ui.paying = false;
  el.payBtn.disabled = false;
  el.payBtn.removeAttribute("aria-busy");
  if (!res.ok) {
    showPayError(t("blocked_pay_unavailable"), () => startPayment());
    return;
  }
  ui.payment = { sessionId: res.sessionId, token, url: res.url, amount, startedAt: Date.now() };
  openPaymentPage();
  el.waitingTitle.textContent = t("blocked_waiting_title", [formatAmount(amount, locale)]);
  goToStep("waiting");
  schedulePoll(POLL_INTERVAL_MS);
}

function openPaymentPage() {
  if (!ui.payment) return;
  const url = ui.payment.url;
  safeCall(() => chrome.tabs.create({ url, active: true })).then((tab) => {
    if (!tab) window.open(url, "_blank", "noopener");
  });
}

function schedulePoll(delay) {
  clearTimeout(ui.pollTimer);
  ui.pollTimer = setTimeout(pollPayment, delay);
}

function stopPolling() {
  clearTimeout(ui.pollTimer);
  ui.pollTimer = 0;
}

async function pollPayment() {
  const payment = ui.payment;
  if (!payment || ui.step !== "waiting") return;
  if (Date.now() - payment.startedAt > POLL_MAX_MS) {
    showPayError(t("blocked_pay_timeout"), () => goToStep("pay"));
    return;
  }
  const res = await verifyPayment({ sessionId: payment.sessionId, token: payment.token });
  if (ui.payment !== payment || ui.step !== "waiting") return;
  if (res.ok && res.paid) {
    await finishPaidEnd(payment);
    return;
  }
  schedulePoll(POLL_INTERVAL_MS);
}

async function finishPaidEnd(payment) {
  const res = await safeCall(() =>
    api.endSession({
      method: "paid",
      sessionId: payment.sessionId,
      token: payment.token,
      // For the local stats only (the payment itself is checked with the server).
      amount: payment.amount,
      currency: paymentCurrency(locale),
    }),
  );
  if (res && res.ok !== false) {
    ui.payment = null;
    renderEnded(res);
    return;
  }
  if (res?.reason === "payment_not_verified") {
    schedulePoll(POLL_INTERVAL_MS);
    return;
  }
  showPayError(reasonText(res?.reason), () => finishPaidEnd(payment));
}

function showPayError(message, retry) {
  el.payErrorText.textContent = message;
  el.payError.hidden = false;
  ui.retry = retry;
}

function hidePayError() {
  el.payError.hidden = true;
  el.payErrorText.textContent = "";
  ui.retry = null;
}

function retryPayment() {
  const retry = ui.retry;
  hidePayError();
  if (retry) retry();
}

function leaveWaiting() {
  stopPolling();
  ui.payment = null;
  hidePayError();
  goToStep("pay");
}

// Coming back from the Stripe tab: check right away instead of waiting for the next poll.
function onVisibilityChange() {
  if (document.visibilityState === "visible" && ui.step === "waiting" && ui.payment) schedulePoll(0);
}

function reasonText(reason) {
  if (reason) {
    const key = `reason_${reason}`;
    const message = t(key);
    if (message && message !== key) return message;
  }
  return t("blocked_friction_failed");
}

/* ---------- Typing step ---------- */

function setupTyping() {
  applyPhrase(defaultPhrase());
}

function defaultPhrase() {
  return t("blocked_friction_phrase");
}

// The user's own sentence from the options page when set, else the default one for this language.
function unlockPhrase(settings) {
  const custom = settings?.unlock?.phrase;
  if (typeof custom !== "string") return defaultPhrase();
  const cleaned = custom
    .normalize("NFC")
    .replace(/[\t\n\v\f\r\u0085]/g, " ")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeForCompare(cleaned).trim() ? cleaned : defaultPhrase();
}

// The same sentence is shown, counted and checked. It can change while the page is open
// (settings synced from another device): keep what was typed only if it still fits.
function applyPhrase(phrase) {
  if (phrase === typing.phrase) return;
  typing.phrase = phrase;
  typing.total = normalizeForCompare(phrase).trimEnd().length;
  el.meter.setAttribute("aria-valuemax", String(typing.total));
  const accentsHint = ACCENTS_OPTIONAL && COMBINING_ACCENT.test(phrase.normalize("NFD"));
  // Emptied when hidden: aria-describedby still reads hidden elements.
  el.phraseHint.textContent = accentsHint ? t("blocked_friction_accents_hint") : "";
  el.phraseHint.hidden = !accentsHint;
  if (typing.lastValid && !isValidPrefix(typing.lastValid, phrase)) resetTyping();
  else updateTypingUI();
}

function resetTyping() {
  el.input.value = "";
  typing.lastValid = "";
  typing.composing = false;
  clearError();
  updateTypingUI();
}

function onBeforeInput(event) {
  const type = event.inputType;
  if (BLOCKED_INPUT_TYPES.has(type)) return refuseInsertion(event);
  // A single character replacement (accent picker) is harmless; longer ones are autocorrect or text expansion.
  if (type === "insertReplacementText" && charCount(insertedText(event)) !== 1) return refuseInsertion(event);
  if (type === "insertText" && charCount(event.data) > 1) return refuseInsertion(event);
  if (LINE_BREAK_INPUT_TYPES.has(type)) event.preventDefault();
}

function refuseInsertion(event) {
  event.preventDefault();
  rejectPaste();
}

function onInput(event) {
  if (typing.composing || event.isComposing) return;
  validateTyping({ fromComposition: false });
}

function onCompositionEnd() {
  typing.composing = false;
  validateTyping({ fromComposition: true });
}

function onTypingKeydown(event) {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!event.shiftKey) unlock();
}

function validateTyping({ fromComposition }) {
  const value = el.input.value;
  if (value === typing.lastValid) {
    updateTypingUI();
    return;
  }
  const growth = charCount(value) - charCount(typing.lastValid);
  if (!fromComposition && growth > MAX_KEYSTROKE_GROWTH) {
    rollback();
    rejectPaste();
    return;
  }
  if (!isValidPrefix(value, typing.phrase)) {
    rollback();
    rejectTypo();
    return;
  }
  typing.lastValid = value;
  if (growth > 0) clearErrorSoon();
  updateTypingUI();
}

function rollback() {
  el.input.value = typing.lastValid;
  const end = el.input.value.length;
  el.input.setSelectionRange(end, end);
}

function updateTypingUI() {
  const done = Math.min(typing.total, normalizeForCompare(typing.lastValid).length);
  const complete = isComplete(typing.lastValid, typing.phrase);
  const split = phraseSplitIndex(done);
  el.phraseDone.textContent = typing.phrase.slice(0, split);
  el.phraseRest.textContent = typing.phrase.slice(split);
  el.phrase.classList.toggle("is-complete", complete);
  el.counter.textContent = t("blocked_friction_progress", [String(done), String(typing.total)]);
  el.counter.classList.toggle("is-complete", complete);
  el.meter.setAttribute("aria-valuenow", String(done));
  el.meterFill.style.width = `${typing.total ? (done / typing.total) * 100 : 0}%`;
  el.input.classList.toggle("is-complete", complete);
  el.unlock.disabled = !complete || ui.unlocking;
  if (complete && !ui.unlocking) clearError();
  autosize(el.input);
}

// Grows the field with its content (large fonts, narrow windows) instead of scrolling inside it.
function autosize(field) {
  field.style.height = "";
  if (!field.offsetParent) return;
  const borders = field.offsetHeight - field.clientHeight;
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight + borders}px`;
}

// Index in the displayed phrase where the typed part ends: the shortest prefix whose normalized
// form covers `done` characters. Normalized prefix lengths never decrease, so a binary search
// works (no per-phrase table, whatever the length of a custom sentence).
function phraseSplitIndex(done) {
  const phrase = typing.phrase;
  let low = 0;
  let high = phrase.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (normalizeForCompare(phrase.slice(0, mid)).length >= done) high = mid;
    else low = mid + 1;
  }
  return graphemeEnd(phrase, low);
}

// Never cut an emoji or a letter from its accents between the typed and the remaining part.
function graphemeEnd(text, index) {
  if (!graphemes || index <= 0 || index >= text.length) return index;
  const segment = graphemes.segment(text).containing(index);
  return segment && segment.index < index ? segment.index + segment.segment.length : index;
}

function rejectTypo() {
  showError(t("blocked_friction_typo"));
  shake();
}

function rejectPaste() {
  showError(t("blocked_friction_paste"));
  shake();
}

function showError(message) {
  clearTimeout(typing.errorTimer);
  typing.errorTimer = 0;
  typing.errorShownAt = Date.now();
  el.error.textContent = message;
  el.error.hidden = false;
  el.input.classList.add("is-error");
}

// Keeps a message readable for a moment once typing resumes correctly.
// Checked on every keystroke too, since timers can lag behind a burst of input.
function clearErrorSoon() {
  if (el.error.hidden) return;
  const wait = ERROR_MIN_VISIBLE_MS - (Date.now() - typing.errorShownAt);
  if (wait <= 0) clearError();
  else if (!typing.errorTimer) typing.errorTimer = setTimeout(clearError, wait);
}

function clearError() {
  clearTimeout(typing.errorTimer);
  typing.errorTimer = 0;
  el.error.hidden = true;
  el.error.textContent = "";
  el.input.classList.remove("is-error");
}

function shake() {
  const box = el.typingBox;
  box.classList.remove("shake");
  void box.offsetWidth; // restart the animation
  box.classList.add("shake");
}

/* ---------- Wiring ---------- */

function bindEvents() {
  for (const button of el.backButtons) button.addEventListener("click", backToWork);
  el.need.addEventListener("click", openFriction);
  el.next.addEventListener("click", afterQuestion);
  el.payForm.addEventListener("submit", startPayment);
  el.amountOther.addEventListener("click", chooseOther);
  el.amountInput.addEventListener("input", onAmountInput);
  el.skip.addEventListener("click", () => {
    hidePayError();
    goToStep("type");
  });
  el.payRetry.addEventListener("click", retryPayment);
  el.reopen.addEventListener("click", openPaymentPage);
  el.waitingBack.addEventListener("click", leaveWaiting);
  document.addEventListener("visibilitychange", onVisibilityChange);
  el.cancel.addEventListener("click", closeFriction);
  el.unlock.addEventListener("click", unlock);
  el.continueBtn.addEventListener("click", continueToSite);
  el.closeTab.addEventListener("click", () => leaveTab());
  el.openOptions.addEventListener("click", openOptions);

  el.input.addEventListener("beforeinput", onBeforeInput);
  el.input.addEventListener("input", onInput);
  el.input.addEventListener("compositionstart", () => {
    typing.composing = true;
  });
  el.input.addEventListener("compositionend", onCompositionEnd);
  el.input.addEventListener("keydown", onTypingKeydown);
  el.input.addEventListener("paste", refuseInsertion);
  el.input.addEventListener("drop", refuseInsertion);
  el.input.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  el.typingBox.addEventListener("animationend", () => el.typingBox.classList.remove("shake"));
  el.phrase.addEventListener("copy", (event) => event.preventDefault());
  el.phrase.addEventListener("dragstart", (event) => event.preventDefault());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing && ui.view === "friction" && ui.step !== "waiting") closeFriction();
  });
}

function mountIcons() {
  for (const slot of document.querySelectorAll("[data-icon]")) {
    const svg = makeIcon(slot.dataset.icon);
    if (svg) slot.replaceChildren(svg);
  }
}

function makeIcon(name) {
  try {
    const node = icon(name, "icon");
    return node instanceof Node ? node : null;
  } catch {
    return null;
  }
}

/* ---------- Helpers ---------- */

function insertedText(event) {
  return event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
}

// Characters as the user sees them: an emoji sequence or a letter with its accents counts as one,
// so a custom sentence with emoji stays typable while multi-character insertions are refused.
function charCount(text) {
  if (!text) return 0;
  const composed = String(text).normalize("NFC");
  return graphemes ? [...graphemes.segment(composed)].length : Array.from(composed).length;
}

function graphemeSegmenter() {
  try {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } catch {
    return null;
  }
}

async function safeCall(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}
