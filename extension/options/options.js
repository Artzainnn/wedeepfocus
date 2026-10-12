import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { api, onStateChange } from "../shared/api.js";
import { icon } from "../shared/icons.js";
import { cleanGroupName, groupDisplayName, newGroupId } from "../shared/presets.js";
import {
  normalizeDomain,
  hostMatches,
  effectiveDomains,
  originPatterns,
  domainsForOrigins,
} from "../shared/domains.js";
import { parseHM, isValidSlot, blockState } from "../shared/schedule.js";
import { formatClock, formatWeekdayClock, localDayKey } from "../shared/format.js";
import { coffeeUrl, formatAmount, isPresetAmount, isValidAmount } from "../shared/payment.js";
import {
  CUSTOM_AMOUNT_MAX,
  CUSTOM_AMOUNT_MIN,
  DEFAULT_AMOUNT,
  DEFAULT_GROUP_ICON,
  DEFAULT_SLOT,
  GOAL_MAX_LENGTH,
  GROUP_ICONS,
  GROUP_NAME_MAX,
  MAX_CUSTOM_DOMAINS,
  MAX_GROUP_DOMAINS,
  MAX_GROUPS,
  PAYMENT_AMOUNTS,
  PHRASE_MAX,
  PHRASE_MIN,
  RESET_DURING_BLOCK,
  ACCOUNTABILITY_ENABLED,
} from "../shared/constants.js";

// The settings this page edits (prefs belong to onboarding).
const EDITED_KEYS = ["groups", "sites", "schedules", "goals", "unlock"];
const UNLOCK_MODES = ["money", "free"];
const TEXT_DEBOUNCE_MS = 400;
const PHRASE_DEBOUNCE_MS = 600;
const AMOUNT_DEBOUNCE_MS = 600;
const TIME_DEBOUNCE_MS = 700;
const SAVING_DELAY_MS = 300;
const SAVED_VISIBLE_MS = 2200;
const ERROR_VISIBLE_MS = 5000;
const TOAST_MS = 6500;
const MAX_TIMER_MS = 60 * 60 * 1000;
const GOAL_COUNTER_FROM = GOAL_MAX_LENGTH - 20;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// The unlock sentence stays on one line: anything that would start a new one becomes a space.
const LINE_BREAKS = /[\n\r\v\f\u0085\u2028\u2029]/g;
// Invisible control characters (from a paste) are dropped: the background refuses them.
const CONTROL_CHARS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g;
const DEFAULT_PHRASE_KEY = "blocked_friction_phrase";
// chrome.storage.sync caps every key (name plus JSON value): checked before saving groups.
const SYNC_ITEM_QUOTA = chrome.storage?.sync?.QUOTA_BYTES_PER_ITEM ?? 8192;

const locale = uiLocale();
const ui = {};
const groupRefs = new Map();
const customRefs = new Map();
const slotRefs = new Map();
const expandedGroups = new Set();
// Debounced text edits (group names, goal) per settings key.
const textTimers = new Map();

// Schedule edits live here until they are valid (and confirmed when they would start a block now).
const slotDrafts = new Map();
const slotTimers = new Map();
const slotConfirm = new Map();
const slotErrorShown = new Set();
const slotPaused = new Set();
// While locked, a new slot is composed here and saved only on explicit confirmation.
let newSlot = null;
let newSlotShowError = false;
let newSlotRefs = null;

// Unlock sentence typed but not saved yet (null while the field shows the stored sentence).
let phraseDraft = null;
let phraseTimer = null;
let phraseErrorShown = false;
let phraseRefused = false;

// Amount chips of the money mode. "Other" stays open once picked, even if a preset value is typed.
const amountButtons = new Map();
let amountOtherOpen = false;
// Custom amount typed but not saved yet (null while the field shows the stored amount).
let amountDraft = null;
let amountTimer = null;
let amountErrorShown = false;

let state = null;
let model = null;
let grantedOrigins = null;
let weekdays = [];
let groupDomSeq = 0;
// Last deleted group, restored by the toast's Undo button.
let lastDeleted = null;

const pendingKeys = new Set();
const forcedKeys = new Set();
let savingKey = null;
let saveLoop = null;
let refreshSeq = 0;
// Set once "Reset everything" is confirmed: nothing typed before it may be saved after it.
let resetting = false;
let boundaryTimer = null;
let statusTimer = null;
let savingTimer = null;
let toastTimer = null;
let toastAction = null;

/* ---------- Setup ---------- */

async function init() {
  applyI18n();
  document.title = t("options_page_title", [t("appName")]);
  weekdays = buildWeekdays();
  collectRefs();
  insertStaticIcons();
  buildGoal();
  buildEnding();
  buildPhrase();
  buildAbout();
  bindEvents();
  onStateChange(() => refresh());
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flushPending);
  await loadInitialState();
}

function collectRefs() {
  ui.page = document.querySelector(".page");
  ui.saved = document.querySelector('[data-testid="options-saved"]');
  ui.loadError = document.querySelector(".load-error");
  ui.lockBanner = document.querySelector(".lock-banner");
  ui.lockText = document.querySelector(".lock-banner-text");
  ui.missingBanner = document.querySelector(".missing-banner");
  ui.missingText = document.querySelector(".missing-text");
  ui.missingAllow = document.querySelector(".missing-allow");
  ui.groups = document.querySelector(".groups");
  ui.groupNew = document.querySelector(".group-new");
  ui.customForm = document.querySelector(".custom-form");
  ui.customInput = document.querySelector("#custom-input");
  ui.customError = document.querySelector(".custom-error");
  ui.customList = document.querySelector(".custom-list");
  ui.slots = document.querySelector(".slots");
  ui.newSlotHost = document.querySelector(".new-slot-host");
  ui.scheduleAdd = document.querySelector(".schedule-add");
  ui.goalInput = document.querySelector(".goal-input");
  ui.goalCounter = document.querySelector(".goal-counter");
  ui.quoteToggle = document.querySelector("#quote-toggle");
  ui.modeCards = new Map([...document.querySelectorAll(".mode")].map((card) => [card.querySelector(".mode-input").value, card]));
  ui.modeInputs = [...document.querySelectorAll(".mode-input")];
  // Free only (first release): the sentence is the only way to end early, so no mode to pick.
  document.querySelector("#ending .modes").hidden = !ACCOUNTABILITY_ENABLED;
  ui.amountBox = document.querySelector(".amount-box");
  ui.amountChips = document.querySelector(".amount-chips");
  ui.amountCustom = document.querySelector(".amount-custom");
  ui.amountPrefix = document.querySelector(".amount-prefix");
  ui.amountSuffix = document.querySelector(".amount-suffix");
  ui.amountInput = document.querySelector("#ending-amount-input");
  ui.amountError = document.querySelector(".amount-error");
  ui.phraseInput = document.querySelector("#phrase-input");
  ui.phraseCounter = document.querySelector(".phrase-counter");
  ui.phraseError = document.querySelector(".phrase-error");
  ui.phraseLockNote = document.querySelector(".phrase-lock-note");
  ui.phraseReset = document.querySelector(".phrase-reset");
  ui.phraseFoot = document.querySelector(".phrase-foot");
  ui.incognitoRow = document.querySelector(".incognito-row");
  ui.incognitoIcon = document.querySelector(".incognito-icon");
  ui.incognitoText = document.querySelector(".incognito-text");
  ui.incognitoButton = document.querySelector(".incognito-button");
  ui.version = document.querySelector(".version-text");
  ui.coffee = document.querySelector(".coffee-link");
  ui.toast = document.querySelector(".toast");
  ui.toastIcon = document.querySelector(".toast-icon");
  ui.toastText = document.querySelector(".toast-text");
  ui.toastAction = document.querySelector(".toast-action");
  ui.toastClose = document.querySelector(".toast-close");
  ui.resetAll = document.querySelector(".reset-all");
  ui.resetFoot = document.querySelector(".reset-foot");
  ui.resetLockNote = document.querySelector(".reset-lock-note");
  ui.resetConfirm = document.querySelector(".reset-confirm");
  ui.resetConfirmText = document.querySelector(".reset-confirm-text");
  ui.resetYes = document.querySelector(".reset-yes");
  ui.resetNo = document.querySelector(".reset-no");
}

function insertStaticIcons() {
  for (const holder of document.querySelectorAll("[data-icon]")) {
    holder.replaceChildren(icon(holder.dataset.icon));
    holder.setAttribute("aria-hidden", "true");
  }
}

function bindEvents() {
  ui.groupNew.addEventListener("click", onGroupNew);
  ui.customForm.addEventListener("submit", onCustomSubmit);
  ui.customInput.addEventListener("input", () => clearFieldError(ui.customInput, ui.customError));
  ui.missingAllow.addEventListener("click", onGrantMissing);
  ui.scheduleAdd.addEventListener("click", onAddSlot);
  ui.goalInput.addEventListener("input", onGoalInput);
  ui.goalInput.addEventListener("blur", () => flushTextSave("goals"));
  ui.quoteToggle.addEventListener("change", onQuoteToggle);
  for (const input of ui.modeInputs) input.addEventListener("change", () => onModeChange(input.value));
  ui.amountInput.addEventListener("input", onAmountInput);
  ui.amountInput.addEventListener("keydown", onAmountKeydown);
  ui.amountInput.addEventListener("blur", onAmountBlur);
  ui.phraseInput.addEventListener("beforeinput", onPhraseBeforeInput);
  ui.phraseInput.addEventListener("input", onPhraseInput);
  ui.phraseInput.addEventListener("compositionend", () => onPhraseInput());
  ui.phraseInput.addEventListener("keydown", onPhraseKeydown);
  ui.phraseInput.addEventListener("blur", onPhraseBlur);
  ui.phraseReset.addEventListener("click", onPhraseReset);
  ui.incognitoButton.addEventListener("click", openExtensionDetails);
  ui.toastAction.addEventListener("click", onToastAction);
  ui.toastClose.addEventListener("click", hideToast);
  ui.resetAll.addEventListener("click", onResetAsk);
  ui.resetNo.addEventListener("click", hideResetConfirm);
  ui.resetYes.addEventListener("click", onResetConfirm);
  document.querySelector(".load-error-reload").addEventListener("click", () => location.reload());
}

async function loadInitialState() {
  for (let attempt = 0; attempt < 3 && !state; attempt += 1) {
    await refresh();
    if (!state) await delay(400 * (attempt + 1));
  }
  if (!state) {
    ui.loadError.hidden = false;
    ui.page.setAttribute("aria-busy", "false");
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") {
    flushPending();
  } else {
    refresh();
    renderIncognito();
  }
}

/* ---------- State sync ---------- */

async function refresh() {
  const seq = ++refreshSeq;
  let response = null;
  let origins = null;
  try {
    [response, origins] = await Promise.all([api.getState(), readGrantedOrigins()]);
  } catch {
    response = null;
  }
  if (seq !== refreshSeq || !response?.ok || !response.settings) return;
  grantedOrigins = origins;
  applyState(response);
}

async function readGrantedOrigins() {
  try {
    const all = await chrome.permissions.getAll();
    return Array.isArray(all?.origins) ? all.origins : [];
  } catch {
    return null;
  }
}

function applyState(next) {
  state = next;
  const force = new Set(forcedKeys);
  forcedKeys.clear();
  model ??= {};
  for (const key of EDITED_KEYS) {
    if (!(key in model) || force.has(key) || !isDirty(key)) {
      model[key] = normalizeKey(key, next.settings[key]);
    }
  }
  pruneSlotState();
  renderAll(force);
  scheduleBoundaryRefresh();
  if (ui.page.getAttribute("aria-busy") !== "false") {
    ui.page.setAttribute("aria-busy", "false");
    ui.loadError.hidden = true;
  }
}

function isDirty(key) {
  return pendingKeys.has(key) || savingKey === key || textTimers.has(key);
}

function normalizeKey(key, value) {
  if (key === "groups") return normalizeGroups(value);
  if (key === "sites") return { custom: stringList(value?.custom) };
  if (key === "schedules") {
    return Array.isArray(value)
      ? value.filter(isObject).map((slot) => ({ ...slot, days: Array.isArray(slot.days) ? [...slot.days] : [] }))
      : [];
  }
  if (key === "goals") {
    const items = Array.isArray(value?.items) ? value.items : [];
    return { items: [typeof items[0] === "string" ? items[0] : ""], showQuote: value?.showQuote !== false };
  }
  return normalizeUnlock(value);
}

// Always the full object: every unlock save sends the phrase, the mode and the amount together.
function normalizeUnlock(value) {
  return {
    phrase: typeof value?.phrase === "string" ? value.phrase : "",
    mode: UNLOCK_MODES.includes(value?.mode) ? value.mode : "free",
    amount: isValidAmount(value?.amount) ? value.amount : DEFAULT_AMOUNT,
  };
}

function normalizeGroups(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const groups = [];
  for (const raw of value) {
    if (!isObject(raw) || typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const group = {
      id: raw.id,
      name: typeof raw.name === "string" ? raw.name : "",
      icon: GROUP_ICONS.includes(raw.icon) ? raw.icon : DEFAULT_GROUP_ICON,
      domains: stringList(raw.domains),
      enabled: raw.enabled === true,
    };
    if (typeof raw.preset === "string" && raw.preset) group.preset = raw.preset;
    groups.push(group);
  }
  return groups;
}

// The block can start or end without any storage change (schedules), so re-check at the boundary.
function scheduleBoundaryRefresh() {
  clearTimeout(boundaryTimer);
  const block = state?.block;
  const target = block?.active ? block.until : block?.nextStart;
  if (!target) return;
  const wait = Math.min(Math.max(target - Date.now() + 1000, 1000), MAX_TIMER_MS);
  boundaryTimer = setTimeout(refresh, wait);
}

function isLocked() {
  return Boolean(state?.block?.active);
}

/* ---------- Saving ---------- */

// The value already holds any text typed so far, so a pending text save is folded into this one.
function commit(key, value) {
  cancelTextSave(key);
  model[key] = value;
  renderAll();
  queueSave(key);
}

function queueSave(key) {
  pendingKeys.add(key);
  runSaves();
}

function scheduleTextSave(key) {
  clearTimeout(textTimers.get(key));
  textTimers.set(
    key,
    setTimeout(() => {
      textTimers.delete(key);
      queueSave(key);
    }, TEXT_DEBOUNCE_MS),
  );
}

function flushTextSave(key) {
  if (!textTimers.has(key)) return;
  cancelTextSave(key);
  queueSave(key);
}

function cancelTextSave(key) {
  clearTimeout(textTimers.get(key));
  textTimers.delete(key);
}

function runSaves() {
  if (saveLoop) return;
  saveLoop = drainSaves()
    .catch(() => {})
    .finally(() => {
      saveLoop = null;
      if (pendingKeys.size) runSaves();
    });
}

// One key per message so a refused groups or schedules change never takes the goal down with it.
async function drainSaves() {
  let failed = false;
  clearTimeout(savingTimer);
  savingTimer = setTimeout(() => setSaveStatus("saving"), SAVING_DELAY_MS);
  try {
    while (pendingKeys.size) {
      const [key] = pendingKeys;
      pendingKeys.delete(key);
      savingKey = key;
      const payload = savePayload(key);
      const response = await sendSave({ [key]: payload });
      savingKey = null;
      if (!response?.ok) {
        failed = true;
        pendingKeys.delete(key);
        await revert(key, response?.reason, payload);
      }
    }
  } finally {
    savingKey = null;
    clearTimeout(savingTimer);
  }
  setSaveStatus(failed ? "error" : "saved");
  refresh();
}

function savePayload(key) {
  return key === "groups" ? groupsForSave(model.groups) : structuredClone(model[key]);
}

async function sendSave(patch) {
  try {
    return await api.saveSettings(patch);
  } catch {
    return { ok: false };
  }
}

// Back to the stored settings, with the short reason the background gave.
async function revert(key, reason, payload) {
  if (key === "unlock" && isPhraseRefusal(reason, payload)) {
    keepRefusedPhrase();
    await refresh();
    return;
  }
  forcedKeys.add(key);
  cancelTextSave(key);
  if (key === "schedules") clearAllSlotDrafts();
  if (key === "unlock") {
    resetPhraseDraft();
    resetAmountDraft();
  }
  showToast(reasonText(reason), "danger");
  await refresh();
}

// The sentence itself was refused (not the mode or the amount): it stays in the field to be fixed.
function isPhraseRefusal(reason, payload) {
  if (reason === "invalid_phrase") return true;
  return reason === "invalid_unlock" && payload?.phrase !== (state?.settings?.unlock?.phrase ?? "");
}

function reasonText(reason) {
  const key = typeof reason === "string" && /^[a-z0-9_]+$/.test(reason) ? `reason_${reason}` : "";
  const message = key ? t(key) : "";
  return message && message !== key ? message : t("reason_unknown");
}

function flushPending() {
  if (resetting) return;
  for (const key of [...textTimers.keys()]) flushTextSave(key);
  if (phraseTimer !== null) commitPhrase();
  if (amountTimer !== null) commitAmount();
  for (const id of [...slotTimers.keys()]) commitSlot(id);
}

function setSaveStatus(kind) {
  clearTimeout(statusTimer);
  const content = {
    saving: [null, t("options_status_saving")],
    saved: ["check", t("common_saved")],
    error: ["alert", t("options_status_error")],
  }[kind];
  const [iconName, text] = content;
  ui.saved.dataset.state = kind;
  ui.saved.replaceChildren(...(iconName ? [icon(iconName, "icon icon-sm")] : []), document.createTextNode(text));
  ui.saved.classList.add("is-visible");
  if (kind !== "saving") {
    statusTimer = setTimeout(
      () => ui.saved.classList.remove("is-visible"),
      kind === "saved" ? SAVED_VISIBLE_MS : ERROR_VISIBLE_MS,
    );
  }
}

/* ---------- Permissions ---------- */

function uncoveredDomains(domains) {
  const unique = [...new Set(domains)];
  if (!grantedOrigins) return unique;
  const covered = new Set(domainsForOrigins(grantedOrigins, unique));
  return unique.filter((domain) => !covered.has(domain));
}

// Must be called synchronously from the click/change/submit handler: Chrome requires a user gesture.
function requestAccess(domains) {
  const needed = uncoveredDomains(domains);
  if (!needed.length || !chrome.permissions?.request) return;
  let request;
  try {
    request = chrome.permissions.request({ origins: originPatterns(needed) });
  } catch {
    showToast(t("options_permission_denied"), "warning");
    return;
  }
  Promise.resolve(request).then(
    (granted) => {
      if (!granted) showToast(t("options_permission_denied"), "warning");
      refresh();
    },
    () => showToast(t("options_permission_denied"), "warning"),
  );
}

function computeMissing() {
  if (!grantedOrigins) return Array.isArray(state?.missing) ? state.missing : [];
  const effective = effectiveDomains({ groups: model.groups, sites: model.sites });
  const granted = new Set(domainsForOrigins(grantedOrigins, effective));
  return effective.filter((domain) => !granted.has(domain));
}

function isMissing(domain, missing) {
  return missing.some((blocked) => hostMatches(domain, blocked));
}

function onGrantMissing() {
  if (!model) return;
  requestAccess(computeMissing());
}

/* ---------- Rendering ---------- */

function renderAll(force = new Set()) {
  if (!model || !state) return;
  const missing = computeMissing();
  renderLock();
  renderMissing(missing);
  renderGroups(missing, force.has("groups"));
  renderCustom(missing);
  renderSchedules(force.has("schedules"));
  renderGoal(force.has("goals"));
  renderEnding(force.has("unlock"));
  renderPhrase(force.has("unlock"));
  renderReset();
}

function renderLock() {
  const locked = isLocked();
  ui.lockBanner.hidden = !locked;
  document.body.classList.toggle("is-locked", locked);
  if (!locked) return;
  const until = state.block.until;
  ui.lockText.textContent = until ? t("options_lock_banner", [formatMoment(until)]) : t("options_lock_banner_plain");
}

function renderMissing(missing) {
  ui.missingBanner.hidden = missing.length === 0;
  ui.missingText.textContent =
    missing.length === 1 ? t("options_missing_one") : t("options_missing_other", [String(missing.length)]);
}

function lockedTitle() {
  return t("options_locked_tooltip");
}

function formatMoment(ms) {
  return localDayKey(ms) === localDayKey(Date.now()) ? formatClock(ms, locale) : formatWeekdayClock(ms, locale);
}

function setInputValue(input, value, force) {
  if ((force || document.activeElement !== input) && input.value !== value) input.value = value;
}

function setTitle(node, text) {
  if (text) node.title = text;
  else node.removeAttribute("title");
}

function placeAfter(container, node, previous) {
  const expected = previous ? previous.nextSibling : container.firstChild;
  if (node !== expected) container.insertBefore(node, expected);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function toggleInput(testid) {
  const label = el("label", "toggle");
  const input = el("input");
  input.type = "checkbox";
  input.dataset.testid = testid;
  label.append(input, el("span"));
  return { label, input };
}

function siteInput(testid) {
  const input = el("input", "site-input");
  input.type = "text";
  input.inputMode = "url";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "done";
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.placeholder = t("options_site_placeholder");
  input.setAttribute("aria-label", t("options_site_input_label"));
  input.dataset.testid = testid;
  return input;
}

function showFieldError(input, error, message) {
  error.textContent = message;
  error.hidden = false;
  input.setAttribute("aria-invalid", "true");
  input.classList.remove("shake");
  void input.offsetWidth;
  input.classList.add("shake");
  input.focus();
}

function clearFieldError(input, error) {
  if (error.hidden) return;
  error.hidden = true;
  error.textContent = "";
  input.removeAttribute("aria-invalid");
}

/* ---------- Site chips (groups and "Your sites") ---------- */

function createChip(domain, testid, removeTestid, onRemove) {
  const root = el("span", "chip site-chip");
  root.dataset.testid = testid;
  root.setAttribute("role", "listitem");
  const name = el("span", "chip-name");
  name.textContent = domain;
  const remove = el("button", "chip-remove");
  remove.type = "button";
  remove.dataset.testid = removeTestid;
  remove.setAttribute("aria-label", t("options_site_remove_aria", [domain]));
  remove.append(icon("x", "icon icon-sm"));
  remove.addEventListener("click", onRemove);
  root.append(icon("alert", "icon icon-sm chip-warn"), name, remove);
  return { root, name, remove };
}

function updateChip(chip, domain, { warning, locked }) {
  chip.root.classList.toggle("is-warning", warning);
  setTitle(chip.name, warning ? t("options_chip_missing") : "");
  chip.remove.disabled = locked;
  chip.remove.title = locked ? lockedTitle() : t("options_site_remove_aria", [domain]);
}

/* ---------- Groups ---------- */

function groupById(id) {
  return model?.groups.find((group) => group.id === id) ?? null;
}

function displayName(group) {
  return groupDisplayName(group, t) || t("options_group_default_name");
}

function namePlaceholder(group) {
  return group.preset ? groupDisplayName({ ...group, name: "" }, t) : t("options_group_default_name");
}

function countText(count) {
  if (count === 0) return t("options_group_count_zero");
  if (count === 1) return t("options_group_count_one");
  return t("options_group_count", [String(count)]);
}

// Same cleanup as the background: control characters become spaces, trimmed, GROUP_NAME_MAX code points.
function storedName(name) {
  return Array.from(cleanGroupName(name)).slice(0, GROUP_NAME_MAX).join("").trim();
}

// Stored form: trimmed names, and a user group never goes out nameless.
function groupsForSave(groups) {
  return groups.map((group) => {
    const saved = { id: group.id };
    if (group.preset) saved.preset = group.preset;
    saved.name = storedName(group.name) || (group.preset ? "" : storedName(t("options_group_default_name")));
    saved.icon = group.icon;
    saved.domains = [...group.domains];
    saved.enabled = group.enabled;
    return saved;
  });
}

function fitsSyncQuota(key, value) {
  return new TextEncoder().encode(key + JSON.stringify(value)).length <= SYNC_ITEM_QUOTA;
}

function editGroup(id, changes) {
  commit("groups", model.groups.map((group) => (group.id === id ? { ...group, ...changes } : group)));
}

function renderGroups(missing, force) {
  const locked = isLocked();
  const ids = new Set(model.groups.map((group) => group.id));
  for (const [id, refs] of groupRefs) {
    if (!ids.has(id)) {
      refs.root.remove();
      groupRefs.delete(id);
      expandedGroups.delete(id);
    }
  }
  let previous = null;
  for (const group of model.groups) {
    let refs = groupRefs.get(group.id);
    if (!refs) {
      refs = createGroup(group.id);
      groupRefs.set(group.id, refs);
    }
    updateGroup(refs, group, { locked, missing, force });
    placeAfter(ui.groups, refs.root, previous);
    previous = refs.root;
  }
  const full = model.groups.length >= MAX_GROUPS;
  ui.groupNew.disabled = full;
  setTitle(ui.groupNew, full ? t("options_group_limit", [String(MAX_GROUPS)]) : "");
}

function createGroup(id) {
  const seq = ++groupDomSeq;
  const root = el("div", "group");
  root.dataset.testid = `group-${id}`;
  root.setAttribute("role", "listitem");

  const head = el("div", "group-head");
  const expand = el("button", "group-expand");
  expand.type = "button";
  expand.dataset.testid = `group-expand-${id}`;
  expand.setAttribute("aria-expanded", "false");
  expand.setAttribute("aria-controls", `group-body-${seq}`);
  const bubble = el("span", "group-bubble");
  const text = el("span", "group-text");
  const name = el("span", "group-name");
  const count = el("span", "group-count num");
  text.append(name, count);
  const warn = el("span", "group-warn");
  const warnLabel = el("span", "sr-only");
  warn.append(icon("alert", "icon icon-sm"), warnLabel);
  expand.append(bubble, text, warn, icon("chevron-down", "icon icon-sm group-chevron"));
  const toggle = toggleInput(`group-toggle-${id}`);
  head.append(expand, toggle.label);

  const body = el("div", "group-body");
  body.id = `group-body-${seq}`;
  body.hidden = true;

  const nameInput = el("input", "group-name-input");
  nameInput.type = "text";
  nameInput.maxLength = GROUP_NAME_MAX;
  nameInput.autocomplete = "off";
  nameInput.enterKeyHint = "done";
  nameInput.dataset.testid = `group-name-${id}`;
  nameInput.setAttribute("aria-label", t("options_group_name_label"));

  const picker = el("div", "icon-picker");
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", t("options_group_icon_label"));
  const iconButtons = new Map();
  for (const iconName of GROUP_ICONS) {
    const button = el("button", "icon-choice");
    button.type = "button";
    button.dataset.testid = `group-icon-${id}-${iconName}`;
    const label = t(`options_icon_${iconName}`);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(icon(iconName));
    button.addEventListener("click", () => onGroupIcon(id, iconName));
    picker.append(button);
    iconButtons.set(iconName, button);
  }

  const chips = el("div", "chips group-chips");
  chips.setAttribute("role", "list");

  const form = el("form", "add-form");
  form.noValidate = true;
  const addInput = siteInput(`group-add-input-${id}`);
  const addButton = el("button", "btn");
  addButton.type = "submit";
  addButton.dataset.testid = `group-add-${id}`;
  addButton.textContent = t("common_add");
  form.append(addInput, addButton);

  const error = el("p", "error-text field-error");
  error.id = `group-error-${seq}`;
  error.dataset.testid = `group-error-${id}`;
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  addInput.setAttribute("aria-describedby", error.id);

  const foot = el("div", "group-foot");
  const remove = el("button", "btn btn-ghost btn-sm group-delete");
  remove.type = "button";
  remove.dataset.testid = `group-delete-${id}`;
  const removeText = el("span");
  removeText.textContent = t("options_group_delete");
  remove.append(icon("trash", "icon icon-sm"), removeText);
  foot.append(remove);

  body.append(nameInput, picker, chips, form, error, foot);
  root.append(head, body);

  expand.addEventListener("click", () => setGroupExpanded(id, !expandedGroups.has(id)));
  toggle.input.addEventListener("change", () => onGroupToggle(id, toggle.input));
  nameInput.addEventListener("input", () => onGroupNameInput(id, nameInput));
  nameInput.addEventListener("blur", () => flushTextSave("groups"));
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) flushTextSave("groups");
  });
  form.addEventListener("submit", (event) => onGroupAdd(event, id));
  addInput.addEventListener("input", () => clearFieldError(addInput, error));
  remove.addEventListener("click", () => onGroupDelete(id));

  return {
    root, expand, bubble, bubbleIcon: null, name, count, warn, warnLabel, body, nameInput, iconButtons,
    chips, chipRefs: new Map(), addInput, error, remove, toggle: toggle.input, toggleLabel: toggle.label,
  };
}

function updateGroup(refs, group, { locked, missing, force }) {
  const name = displayName(group);
  const expanded = expandedGroups.has(group.id);
  const warning = group.enabled && group.domains.some((domain) => isMissing(domain, missing));
  // During a block an enabled group can only grow: no switching off, no removing, no deleting.
  const frozen = locked && group.enabled;

  refs.root.classList.toggle("is-enabled", group.enabled);
  refs.root.classList.toggle("is-expanded", expanded);
  refs.expand.setAttribute("aria-expanded", String(expanded));
  refs.body.hidden = !expanded;

  if (refs.bubbleIcon !== group.icon) {
    refs.bubble.replaceChildren(icon(group.icon));
    refs.bubbleIcon = group.icon;
  }
  refs.name.textContent = name;
  refs.count.textContent = countText(group.domains.length);
  refs.warn.hidden = !warning;
  refs.warn.title = t("options_group_missing");
  refs.warnLabel.textContent = t("options_group_missing");

  refs.toggle.checked = group.enabled;
  refs.toggle.disabled = frozen;
  refs.toggle.setAttribute("aria-label", t("options_group_toggle_aria", [name]));
  setTitle(refs.toggle, frozen ? lockedTitle() : "");
  setTitle(refs.toggleLabel, frozen ? lockedTitle() : "");

  setInputValue(refs.nameInput, group.name, force);
  refs.nameInput.placeholder = namePlaceholder(group);
  for (const [iconName, button] of refs.iconButtons) {
    button.setAttribute("aria-pressed", String(iconName === group.icon));
  }

  refs.chips.setAttribute("aria-label", t("options_group_sites_aria", [name]));
  refs.chips.hidden = group.domains.length === 0;
  renderGroupChips(refs, group, { frozen, missing });

  refs.remove.disabled = frozen;
  setTitle(refs.remove, frozen ? lockedTitle() : "");
}

function renderGroupChips(refs, group, { frozen, missing }) {
  const wanted = new Set(group.domains);
  for (const [domain, chip] of refs.chipRefs) {
    if (!wanted.has(domain)) {
      chip.root.remove();
      refs.chipRefs.delete(domain);
    }
  }
  let previous = null;
  for (const domain of group.domains) {
    let chip = refs.chipRefs.get(domain);
    if (!chip) {
      chip = createChip(domain, `group-site-${group.id}-${domain}`, `group-site-remove-${group.id}-${domain}`, () =>
        onGroupSiteRemove(group.id, domain),
      );
      refs.chipRefs.set(domain, chip);
    }
    updateChip(chip, domain, { warning: group.enabled && isMissing(domain, missing), locked: frozen });
    placeAfter(refs.chips, chip.root, previous);
    previous = chip.root;
  }
}

function setGroupExpanded(id, open) {
  if (open) expandedGroups.add(id);
  else expandedGroups.delete(id);
  const refs = groupRefs.get(id);
  if (!refs) return;
  refs.root.classList.toggle("is-expanded", open);
  refs.expand.setAttribute("aria-expanded", String(open));
  refs.body.hidden = !open;
}

function onGroupToggle(id, input) {
  const group = groupById(id);
  if (!group) return;
  const enabled = input.checked;
  if (!enabled && isLocked()) {
    input.checked = true;
    showToast(reasonText("lock_group"), "danger");
    return;
  }
  if (enabled) requestAccess(group.domains);
  editGroup(id, { enabled });
}

function onGroupNameInput(id, input) {
  if (!groupById(id)) return;
  model.groups = model.groups.map((group) => (group.id === id ? { ...group, name: input.value } : group));
  scheduleTextSave("groups");
  renderAll();
}

function onGroupIcon(id, iconName) {
  const group = groupById(id);
  if (!group || group.icon === iconName) return;
  editGroup(id, { icon: iconName });
}

function onGroupAdd(event, id) {
  event.preventDefault();
  const group = groupById(id);
  const refs = groupRefs.get(id);
  if (!group || !refs) return;
  const fail = (message) => showFieldError(refs.addInput, refs.error, message);
  const raw = refs.addInput.value.trim();
  if (!raw) {
    refs.addInput.focus();
    return;
  }
  const domain = normalizeDomain(raw);
  if (!domain) return fail(t("reason_invalid_domain"));
  if (group.domains.includes(domain)) return fail(t("options_site_in_group"));
  const parent = group.domains.find((item) => hostMatches(domain, item));
  if (parent) return fail(t("options_site_covered", [parent]));
  if (group.domains.length >= MAX_GROUP_DOMAINS) return fail(t("options_group_full", [String(MAX_GROUP_DOMAINS)]));

  const groups = model.groups.map((item) => (item.id === id ? { ...item, domains: [...item.domains, domain] } : item));
  if (!fitsSyncQuota("groups", groupsForSave(groups))) return fail(t("options_group_no_room"));
  if (group.enabled) requestAccess([domain]);
  refs.addInput.value = "";
  clearFieldError(refs.addInput, refs.error);
  commit("groups", groups);
  refs.addInput.focus();
}

function onGroupSiteRemove(id, domain) {
  const group = groupById(id);
  if (!group || (isLocked() && group.enabled)) return;
  const index = group.domains.indexOf(domain);
  const domains = group.domains.filter((item) => item !== domain);
  editGroup(id, { domains });
  const refs = groupRefs.get(id);
  const neighbour = domains[Math.min(index, domains.length - 1)];
  (neighbour ? refs?.chipRefs.get(neighbour)?.remove : refs?.addInput)?.focus();
}

function onGroupDelete(id) {
  const index = model ? model.groups.findIndex((group) => group.id === id) : -1;
  if (index === -1) return;
  const group = model.groups[index];
  if (isLocked() && group.enabled) return;
  const groups = model.groups.filter((item) => item.id !== id);
  lastDeleted = { group: structuredClone(group), index };
  commit("groups", groups);
  const next = groups[Math.min(index, groups.length - 1)];
  (next ? groupRefs.get(next.id)?.expand : ui.groupNew)?.focus();
  showToast(t("options_group_deleted"), "info", { label: t("options_undo"), run: undoDelete });
}

function undoDelete() {
  const deleted = lastDeleted;
  lastDeleted = null;
  if (!deleted || !model || groupById(deleted.group.id) || model.groups.length >= MAX_GROUPS) return;
  const groups = [...model.groups];
  groups.splice(Math.min(deleted.index, groups.length), 0, deleted.group);
  if (deleted.group.enabled) requestAccess(deleted.group.domains);
  commit("groups", groups);
  groupRefs.get(deleted.group.id)?.expand.focus();
}

function onGroupNew() {
  if (!model || model.groups.length >= MAX_GROUPS) return;
  // During a block an enabled group could no longer be turned off or deleted: it starts off, so
  // it stays fully editable until the user turns it on.
  const group = { id: uniqueGroupId(), name: "", icon: DEFAULT_GROUP_ICON, domains: [], enabled: !isLocked() };
  expandedGroups.add(group.id);
  commit("groups", [...model.groups, group]);
  const refs = groupRefs.get(group.id);
  if (!refs) return;
  refs.root.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  refs.nameInput.focus({ preventScroll: true });
}

function uniqueGroupId() {
  const taken = new Set(model.groups.map((group) => group.id));
  let id = newGroupId();
  while (taken.has(id)) id = newGroupId();
  return id;
}

/* ---------- Your sites ---------- */

function onCustomSubmit(event) {
  event.preventDefault();
  if (!model) return;
  const fail = (message) => showFieldError(ui.customInput, ui.customError, message);
  const raw = ui.customInput.value.trim();
  if (!raw) {
    ui.customInput.focus();
    return;
  }
  const domain = normalizeDomain(raw);
  if (!domain) return fail(t("reason_invalid_domain"));
  const custom = model.sites.custom;
  if (custom.includes(domain)) return fail(t("reason_duplicate_domain"));
  const parent = custom.find((item) => hostMatches(domain, item));
  if (parent) return fail(t("options_site_covered", [parent]));
  const owner = model.groups.find((group) => group.enabled && group.domains.some((item) => hostMatches(domain, item)));
  if (owner) return fail(t("options_custom_in_group", [displayName(owner)]));
  if (custom.length >= MAX_CUSTOM_DOMAINS) return fail(t("reason_too_many_domains"));

  requestAccess([domain]);
  ui.customInput.value = "";
  clearFieldError(ui.customInput, ui.customError);
  commit("sites", { ...model.sites, custom: [...custom, domain] });
  ui.customInput.focus();
}

function renderCustom(missing) {
  const locked = isLocked();
  const list = model.sites.custom;
  const wanted = new Set(list);
  for (const [domain, chip] of customRefs) {
    if (!wanted.has(domain)) {
      chip.root.remove();
      customRefs.delete(domain);
    }
  }
  let previous = null;
  for (const domain of list) {
    let chip = customRefs.get(domain);
    if (!chip) {
      chip = createChip(domain, `custom-chip-${domain}`, `custom-remove-${domain}`, () => onCustomRemove(domain));
      customRefs.set(domain, chip);
    }
    updateChip(chip, domain, { warning: isMissing(domain, missing), locked });
    placeAfter(ui.customList, chip.root, previous);
    previous = chip.root;
  }
  ui.customList.hidden = list.length === 0;
}

function onCustomRemove(domain) {
  if (!model || isLocked()) return;
  const list = model.sites.custom;
  const index = list.indexOf(domain);
  const custom = list.filter((item) => item !== domain);
  commit("sites", { ...model.sites, custom });
  const neighbour = custom[Math.min(index, custom.length - 1)];
  const target = neighbour ? customRefs.get(neighbour)?.remove : null;
  (target ?? ui.customInput).focus();
}

/* ---------- Schedules ---------- */

function buildWeekdays() {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long" });
  // 7 January 2024 is a Sunday, so day index d falls on the 7th + d.
  return DAY_ORDER.map((day) => {
    const date = new Date(2024, 0, 7 + day, 12);
    return { day, short: capitalize(short.format(date).replace(/\.$/, "")), long: capitalize(long.format(date)) };
  });
}

function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function slotView(id) {
  return slotDrafts.get(id) ?? model.schedules.find((slot) => slot.id === id);
}

function slotError(slot) {
  if (!slot.days?.length) return t("options_schedule_error_days");
  if (!TIME_PATTERN.test(slot.start) || !TIME_PATTERN.test(slot.end)) return t("options_schedule_error_time");
  if (slot.start === slot.end) return t("options_schedule_error_same");
  if (!isValidSlot(slot)) return t("options_schedule_error_time");
  return null;
}

// Same reading as the background: a slot is on unless explicitly switched off.
function isSlotOn(slot) {
  return slot.enabled !== false;
}

function cleanSlot(slot) {
  return {
    id: slot.id,
    days: [...new Set(slot.days)].sort((a, b) => a - b),
    start: slot.start,
    end: slot.end,
    enabled: isSlotOn(slot),
  };
}

function sameSlot(a, b) {
  return (
    a.start === b.start &&
    a.end === b.end &&
    isSlotOn(a) === isSlotOn(b) &&
    cleanSlot(a).days.join() === cleanSlot(b).days.join()
  );
}

function toggleDay(days, day) {
  return days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b);
}

// Returns when the block would end if these schedules started one right now, else null.
function activationUntil(schedules) {
  if (!state || isLocked()) return null;
  try {
    const now = Date.now();
    const session = state.session ?? null;
    const next = blockState(now, { schedules, session });
    if (!next.active) return null;
    return blockState(now, { schedules: model.schedules, session }).active ? null : next.until;
  } catch {
    return null;
  }
}

// During a block: the new end if these schedules would make the current block last longer, else null.
function extensionUntil(schedules) {
  const block = state?.block;
  if (!block?.active || !Number.isFinite(block.until)) return null;
  try {
    const next = blockState(Date.now(), { schedules, session: state.session ?? null });
    return next.active && Number.isFinite(next.until) && next.until > block.until ? next.until : null;
  } catch {
    return null;
  }
}

function newSlotId() {
  const taken = new Set(model.schedules.map((slot) => slot.id));
  let id;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    id = `s_${[...bytes].map((byte) => (byte % 36).toString(36)).join("")}`;
  } while (taken.has(id));
  return id;
}

function clearSlotState(id) {
  clearTimeout(slotTimers.get(id));
  slotTimers.delete(id);
  slotDrafts.delete(id);
  slotConfirm.delete(id);
  slotErrorShown.delete(id);
}

function clearAllSlotDrafts() {
  for (const id of [...slotDrafts.keys(), ...slotTimers.keys()]) clearSlotState(id);
}

function pruneSlotState() {
  const ids = new Set(model.schedules.map((slot) => slot.id));
  for (const id of [...slotDrafts.keys(), ...slotTimers.keys(), ...slotConfirm.keys(), ...slotPaused]) {
    if (!ids.has(id)) {
      clearSlotState(id);
      slotPaused.delete(id);
    }
  }
}

function editSlot(id, changes, immediate) {
  if (isLocked()) return;
  const base = slotView(id);
  if (!base) return;
  const patch = typeof changes === "function" ? changes(base) : changes;
  const draft = { ...base, ...patch, days: [...(patch.days ?? base.days)] };
  slotDrafts.set(id, draft);
  slotConfirm.delete(id);
  slotPaused.delete(id);
  if (!slotError(draft)) slotErrorShown.delete(id);
  clearTimeout(slotTimers.get(id));
  slotTimers.delete(id);
  if (immediate) {
    commitSlot(id);
  } else {
    slotTimers.set(id, setTimeout(() => commitSlot(id), TIME_DEBOUNCE_MS));
    renderSchedules();
  }
}

function commitSlot(id) {
  clearTimeout(slotTimers.get(id));
  slotTimers.delete(id);
  const draft = slotDrafts.get(id);
  const stored = model.schedules.find((slot) => slot.id === id);
  if (!draft || !stored) {
    clearSlotState(id);
    renderSchedules();
    return;
  }
  if (slotError(draft)) {
    slotErrorShown.add(id);
    renderSchedules();
    return;
  }
  if (sameSlot(stored, draft)) {
    clearSlotState(id);
    renderSchedules();
    return;
  }
  const schedules = model.schedules.map((slot) => (slot.id === id ? cleanSlot(draft) : slot));
  const until = activationUntil(schedules);
  if (until !== null) {
    slotConfirm.set(id, { until, kind: "start" });
    renderSchedules();
    return;
  }
  clearSlotState(id);
  commit("schedules", schedules);
}

function onSlotEnabled(id, checked) {
  if (!isLocked()) {
    editSlot(id, { enabled: checked }, true);
    return;
  }
  // During a block a switched off slot may be turned on (it can only block more), never off.
  const stored = model.schedules.find((slot) => slot.id === id);
  if (!stored) return;
  if (!checked || isSlotOn(stored)) {
    if (slotDrafts.has(id)) discardSlotDraft(id);
    else renderSchedules(true);
    return;
  }
  const draft = { ...stored, days: [...stored.days], enabled: true };
  const schedules = model.schedules.map((slot) => (slot.id === id ? cleanSlot(draft) : slot));
  const until = extensionUntil(schedules);
  if (until !== null) {
    slotDrafts.set(id, draft);
    slotConfirm.set(id, { until, kind: "extend" });
    renderSchedules();
    return;
  }
  clearSlotState(id);
  commit("schedules", schedules);
}

function confirmSlot(id) {
  const draft = slotDrafts.get(id);
  if (!draft || slotError(draft)) return;
  clearSlotState(id);
  commit("schedules", model.schedules.map((slot) => (slot.id === id ? cleanSlot(draft) : slot)));
}

function discardSlotDraft(id) {
  clearSlotState(id);
  renderSchedules(true);
}

function deleteSlot(id) {
  if (isLocked()) return;
  clearSlotState(id);
  slotPaused.delete(id);
  commit("schedules", model.schedules.filter((slot) => slot.id !== id));
  ui.scheduleAdd.focus();
}

function onAddSlot() {
  if (!model) return;
  if (isLocked()) {
    openNewSlot();
    return;
  }
  const slot = { id: newSlotId(), days: [...DEFAULT_SLOT.days], start: DEFAULT_SLOT.start, end: DEFAULT_SLOT.end, enabled: true };
  // Never lock the user out by accident: a default slot covering "now" is added switched off.
  if (activationUntil([...model.schedules, slot]) !== null) {
    slot.enabled = false;
    slotPaused.add(slot.id);
  }
  commit("schedules", [...model.schedules, slot]);
  const refs = slotRefs.get(slot.id);
  if (refs) {
    refs.root.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    refs.start.focus({ preventScroll: true });
  }
}

function openNewSlot() {
  if (!newSlot) {
    newSlot = { days: [...DEFAULT_SLOT.days], start: DEFAULT_SLOT.start, end: DEFAULT_SLOT.end, enabled: true };
    newSlotShowError = false;
    renderSchedules();
  }
  newSlotRefs?.start.focus();
}

function editNewSlot(changes) {
  newSlot = { ...newSlot, ...changes };
  if (!slotError(newSlot)) newSlotShowError = false;
  renderSchedules();
}

function saveNewSlot() {
  if (!newSlot) return;
  if (slotError(newSlot)) {
    newSlotShowError = true;
    renderSchedules();
    return;
  }
  const slot = cleanSlot({ ...newSlot, id: newSlotId(), enabled: true });
  newSlot = null;
  commit("schedules", [...model.schedules, slot]);
  ui.scheduleAdd.focus();
}

function cancelNewSlot() {
  newSlot = null;
  renderSchedules();
  ui.scheduleAdd.focus();
}

function renderSchedules(force = false) {
  const locked = isLocked();
  // A pending confirmation only makes sense in the lock state it was asked in.
  for (const [id, confirm] of [...slotConfirm]) {
    if ((confirm.kind === "extend") !== locked) clearSlotState(id);
  }
  const ids = new Set(model.schedules.map((slot) => slot.id));
  for (const [id, refs] of slotRefs) {
    if (!ids.has(id)) {
      refs.root.remove();
      slotRefs.delete(id);
    }
  }
  let previous = null;
  for (const slot of model.schedules) {
    let refs = slotRefs.get(slot.id);
    if (!refs) {
      refs = createSlotRow(false, existingSlotHandlers(slot.id));
      refs.root.dataset.testid = `schedule-${slot.id}`;
      slotRefs.set(slot.id, refs);
    }
    const view = slotView(slot.id);
    const draftError = slotDrafts.has(slot.id) && slotErrorShown.has(slot.id) ? slotError(view) : null;
    updateSlotRow(refs, view, {
      disabled: locked,
      enableLocked: locked && isSlotOn(slot),
      error: draftError,
      confirm: slotConfirm.get(slot.id) ?? null,
      paused: !locked && slotPaused.has(slot.id) && !isSlotOn(view),
      force: force || !slotDrafts.has(slot.id),
    });
    placeAfter(ui.slots, refs.root, previous);
    previous = refs.root;
  }
  renderNewSlot(locked);
  ui.slots.hidden = model.schedules.length === 0;
}

function renderNewSlot(locked) {
  if (!newSlot) {
    newSlotRefs?.root.remove();
    newSlotRefs = null;
    return;
  }
  if (!newSlotRefs) {
    newSlotRefs = createSlotRow(true, {
      day: (day) => editNewSlot({ days: toggleDay(newSlot.days, day) }),
      time: (field, value) => editNewSlot({ [field]: value }),
      blur: () => {},
      save: saveNewSlot,
      cancel: cancelNewSlot,
    });
    newSlotRefs.root.dataset.testid = "schedule-draft";
    ui.newSlotHost.append(newSlotRefs.root);
  }
  newSlotRefs.lockNote.hidden = !locked;
  updateSlotRow(newSlotRefs, newSlot, {
    disabled: false,
    enableLocked: false,
    error: newSlotShowError ? slotError(newSlot) : null,
    confirm: null,
    paused: false,
    force: false,
  });
}

function existingSlotHandlers(id) {
  return {
    day: (day) => editSlot(id, (slot) => ({ days: toggleDay(slot.days, day) }), true),
    time: (field, value) => editSlot(id, { [field]: value }, false),
    blur: () => {
      if (slotTimers.has(id)) commitSlot(id);
    },
    enabled: (checked) => onSlotEnabled(id, checked),
    remove: () => deleteSlot(id),
    confirm: () => confirmSlot(id),
    cancelConfirm: () => discardSlotDraft(id),
  };
}

function createSlotRow(isNew, handlers) {
  const root = el("div", isNew ? "slot is-new" : "slot");
  const top = el("div", "slot-top");

  const times = el("div", "slot-times");
  const start = timeField("schedule-start", t("options_schedule_start_aria"));
  const separator = el("span", "slot-sep");
  separator.textContent = t("options_schedule_to");
  const end = timeField("schedule-end", t("options_schedule_end_aria"));
  const nextDay = el("span", "slot-nextday small");
  nextDay.textContent = t("options_schedule_next_day");
  times.append(start, separator, end, nextDay);
  top.append(times);

  const refs = { root, start, end, nextDay, isNew, dayButtons: new Map() };

  if (!isNew) {
    const actions = el("div", "slot-actions");
    const toggle = toggleInput("schedule-enabled");
    toggle.input.setAttribute("aria-label", t("options_schedule_enabled_aria"));
    const remove = el("button", "btn btn-ghost btn-sm icon-btn slot-delete");
    remove.type = "button";
    remove.dataset.testid = "schedule-delete";
    remove.setAttribute("aria-label", t("options_schedule_delete_aria"));
    remove.append(icon("trash", "icon icon-sm"));
    actions.append(toggle.label, remove);
    top.append(actions);
    toggle.input.addEventListener("change", () => handlers.enabled(toggle.input.checked));
    remove.addEventListener("click", handlers.remove);
    Object.assign(refs, { enabled: toggle.input, enabledLabel: toggle.label, remove });
  }

  const days = el("div", "slot-days");
  days.setAttribute("role", "group");
  days.setAttribute("aria-label", t("options_schedule_days_aria"));
  for (const weekday of weekdays) {
    const button = el("button", "day");
    button.type = "button";
    button.dataset.testid = `schedule-day-${weekday.day}`;
    button.textContent = weekday.short;
    button.setAttribute("aria-label", weekday.long);
    button.addEventListener("click", () => handlers.day(weekday.day));
    days.append(button);
    refs.dayButtons.set(weekday.day, { button, long: weekday.long });
  }

  const error = el("p", "error-text slot-error");
  error.dataset.testid = "schedule-error";
  error.setAttribute("aria-live", "polite");
  error.hidden = true;

  const note = el("p", "slot-note small");
  note.dataset.testid = "schedule-note";
  note.textContent = t("options_schedule_paused");
  note.hidden = true;

  root.append(top, days, error, note);

  for (const input of [start, end]) {
    input.addEventListener("input", () => handlers.time(input === start ? "start" : "end", input.value));
    input.addEventListener("blur", handlers.blur);
  }

  if (isNew) {
    const lockNote = el("p", "slot-note small");
    lockNote.textContent = t("options_schedule_draft_note");
    const actions = el("div", "slot-new-actions");
    const save = el("button", "btn btn-primary btn-sm");
    save.type = "button";
    save.dataset.testid = "schedule-draft-save";
    save.textContent = t("options_schedule_draft_save");
    const cancel = el("button", "btn btn-ghost btn-sm");
    cancel.type = "button";
    cancel.dataset.testid = "schedule-draft-cancel";
    cancel.textContent = t("common_cancel");
    actions.append(save, cancel);
    root.append(lockNote, actions);
    save.addEventListener("click", handlers.save);
    cancel.addEventListener("click", handlers.cancel);
    refs.lockNote = lockNote;
  } else {
    const confirm = el("div", "banner banner-warning slot-confirm");
    confirm.dataset.testid = "schedule-confirm";
    confirm.setAttribute("role", "alert");
    confirm.hidden = true;
    const confirmText = el("p", "slot-confirm-text");
    const confirmActions = el("div", "slot-confirm-actions");
    const yes = el("button", "btn btn-sm btn-primary");
    yes.type = "button";
    yes.dataset.testid = "schedule-confirm-yes";
    yes.textContent = t("options_schedule_confirm_yes");
    const no = el("button", "btn btn-sm");
    no.type = "button";
    no.dataset.testid = "schedule-confirm-no";
    no.textContent = t("common_cancel");
    confirmActions.append(yes, no);
    confirm.append(icon("alert"), confirmText, confirmActions);
    root.append(confirm);
    yes.addEventListener("click", handlers.confirm);
    no.addEventListener("click", handlers.cancelConfirm);
    Object.assign(refs, { confirm, confirmText, confirmYes: yes });
  }

  refs.error = error;
  refs.note = note;
  return refs;
}

function timeField(testid, ariaLabel) {
  const input = el("input", "slot-time num");
  input.type = "time";
  input.step = "60";
  input.required = true;
  input.dataset.testid = testid;
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

function updateSlotRow(refs, view, { disabled, enableLocked, error, confirm, paused, force }) {
  const locked = disabled && !refs.isNew;
  refs.root.classList.toggle("is-off", !refs.isNew && !isSlotOn(view));
  refs.root.classList.toggle("is-locked", locked);
  setTitle(refs.root, locked ? lockedTitle() : "");

  for (const [day, { button, long }] of refs.dayButtons) {
    button.setAttribute("aria-pressed", String(view.days.includes(day)));
    button.disabled = locked;
    button.title = locked ? lockedTitle() : long;
  }
  for (const [input, value] of [[refs.start, view.start], [refs.end, view.end]]) {
    setInputValue(input, value, force);
    input.disabled = locked;
    setTitle(input, locked ? lockedTitle() : "");
    if (error) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  const startMinutes = parseHM(view.start);
  const endMinutes = parseHM(view.end);
  refs.nextDay.hidden = !(endMinutes < startMinutes);

  if (refs.enabled) {
    const enableTitle = enableLocked ? lockedTitle() : locked ? t("options_schedule_enable_allowed") : "";
    refs.enabled.checked = isSlotOn(view);
    refs.enabled.disabled = enableLocked;
    setTitle(refs.enabled, enableTitle);
    setTitle(refs.enabledLabel, enableTitle);
  }
  if (refs.remove) {
    refs.remove.disabled = locked;
    refs.remove.title = locked ? lockedTitle() : t("options_schedule_delete_aria");
  }

  refs.error.hidden = !error;
  refs.error.textContent = error ?? "";
  refs.note.hidden = !paused;

  if (refs.confirm) {
    const extend = confirm?.kind === "extend";
    refs.confirm.hidden = !confirm;
    refs.confirmText.textContent = confirm
      ? t(extend ? "options_schedule_confirm_extend" : "options_schedule_confirm", [formatMoment(confirm.until)])
      : "";
    refs.confirmYes.textContent = t(extend ? "options_schedule_confirm_on" : "options_schedule_confirm_yes");
  }
}

/* ---------- Goal ---------- */

function buildGoal() {
  ui.goalInput.maxLength = GOAL_MAX_LENGTH;
}

function renderGoal(force) {
  setInputValue(ui.goalInput, model.goals.items[0], force);
  updateGoalCounter();
  ui.quoteToggle.checked = model.goals.showQuote;
}

function updateGoalCounter() {
  const length = ui.goalInput.value.length;
  const visible = length >= GOAL_COUNTER_FROM;
  ui.goalCounter.textContent = visible ? `${length}/${GOAL_MAX_LENGTH}` : "";
  ui.goalCounter.classList.toggle("is-full", length >= GOAL_MAX_LENGTH);
  ui.goalInput.classList.toggle("has-counter", visible);
}

function onGoalInput() {
  if (!model) return;
  model.goals = { ...model.goals, items: [ui.goalInput.value] };
  updateGoalCounter();
  scheduleTextSave("goals");
}

function onQuoteToggle() {
  if (!model) return;
  commit("goals", { ...model.goals, showQuote: ui.quoteToggle.checked });
}

/* ---------- Ending a session early (mode and amount stay editable during a block) ---------- */

function buildEnding() {
  for (const amount of PAYMENT_AMOUNTS) {
    const button = amountChip(`ending-amount-${amount}`, formatAmount(amount, locale));
    button.addEventListener("click", () => onAmountPreset(amount));
    amountButtons.set(amount, button);
  }
  ui.amountOther = amountChip("ending-amount-other", t("options_amount_other"));
  ui.amountOther.setAttribute("aria-controls", ui.amountCustom.id);
  ui.amountOther.addEventListener("click", onAmountOther);
  const [prefix, suffix] = currencyAffixes();
  ui.amountPrefix.textContent = prefix;
  ui.amountSuffix.textContent = suffix;
  ui.amountInput.placeholder = t("options_amount_placeholder", [String(CUSTOM_AMOUNT_MIN), String(CUSTOM_AMOUNT_MAX)]);
}

function amountChip(testid, label) {
  const button = el("button", "amount-chip num");
  button.type = "button";
  button.dataset.testid = testid;
  button.textContent = label;
  ui.amountChips.append(button);
  return button;
}

// The currency sign around a typed amount, where the locale writes it ("€5" in en, "5 €" in fr).
function currencyAffixes() {
  const sample = formatAmount(1, locale);
  const index = sample.indexOf("1");
  return index === -1 ? ["", ""] : [sample.slice(0, index).trim(), sample.slice(index + 1).trim()];
}

// A whole number of the allowed range, else null.
function parseAmount(text) {
  const value = String(text ?? "").trim();
  return /^\d{1,4}$/.test(value) && isValidAmount(Number(value)) ? Number(value) : null;
}

function renderEnding(force) {
  if (force) resetAmountDraft();
  const { mode, amount } = model.unlock;
  for (const input of ui.modeInputs) input.checked = input.value === mode;
  for (const [value, card] of ui.modeCards) card.classList.toggle("is-selected", value === mode);
  ui.amountBox.hidden = mode !== "money";

  const other = amountOtherOpen || !isPresetAmount(amount);
  for (const [value, button] of amountButtons) button.setAttribute("aria-pressed", String(!other && value === amount));
  ui.amountOther.setAttribute("aria-pressed", String(other));
  ui.amountCustom.hidden = !other;
  setInputValue(ui.amountInput, amountDraft ?? String(amount), force);
  updateAmountError();
}

function updateAmountError() {
  const show = amountErrorShown && amountDraft !== null && parseAmount(amountDraft) === null;
  const range = [formatAmount(CUSTOM_AMOUNT_MIN, locale), formatAmount(CUSTOM_AMOUNT_MAX, locale)];
  ui.amountError.textContent = show ? t("options_amount_error", range) : "";
  ui.amountError.hidden = !show;
  if (show) ui.amountInput.setAttribute("aria-invalid", "true");
  else ui.amountInput.removeAttribute("aria-invalid");
}

function resetAmountDraft() {
  clearTimeout(amountTimer);
  amountTimer = null;
  amountDraft = null;
  amountErrorShown = false;
  amountOtherOpen = false;
}

function onModeChange(mode) {
  if (!model || !UNLOCK_MODES.includes(mode) || mode === model.unlock.mode) return;
  // A valid amount still being typed goes with the switch; an invalid one is dropped.
  const typed = amountDraft === null ? null : parseAmount(amountDraft);
  resetAmountDraft();
  commit("unlock", { ...model.unlock, mode, amount: typed ?? model.unlock.amount });
}

function onAmountPreset(amount) {
  if (!model) return;
  resetAmountDraft();
  if (amount === model.unlock.amount) renderEnding(false);
  else commit("unlock", { ...model.unlock, amount });
}

function onAmountOther() {
  if (!model) return;
  if (!amountOtherOpen && isPresetAmount(model.unlock.amount)) {
    amountOtherOpen = true;
    amountDraft = "";
    amountErrorShown = false;
    renderEnding(false);
  }
  ui.amountInput.focus();
}

function onAmountInput() {
  if (!model) return;
  amountDraft = ui.amountInput.value;
  if (parseAmount(amountDraft) !== null || !amountDraft.trim()) amountErrorShown = false;
  updateAmountError();
  clearTimeout(amountTimer);
  amountTimer = setTimeout(commitAmount, AMOUNT_DEBOUNCE_MS);
}

function onAmountKeydown(event) {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  commitAmount();
}

// Left empty: back to the stored amount (and to its chip when it is a preset).
function onAmountBlur() {
  commitAmount();
  if (!model || amountDraft === null || amountDraft.trim()) return;
  amountDraft = null;
  if (isPresetAmount(model.unlock.amount)) amountOtherOpen = false;
  renderEnding(false);
}

// Saves the typed amount when it is valid, otherwise shows why it can't be saved.
function commitAmount() {
  clearTimeout(amountTimer);
  amountTimer = null;
  if (amountDraft === null || !model || !amountDraft.trim()) return;
  const amount = parseAmount(amountDraft);
  if (amount === null) {
    amountErrorShown = true;
    updateAmountError();
    return;
  }
  amountDraft = null;
  amountErrorShown = false;
  if (amount === model.unlock.amount) renderEnding(false);
  else commit("unlock", { ...model.unlock, amount });
}

/* ---------- Unlock sentence ---------- */

function buildPhrase() {
  ui.phraseInput.placeholder = t(DEFAULT_PHRASE_KEY);
}

function oneLine(text) {
  return text.replace(LINE_BREAKS, " ").replace(CONTROL_CHARS, "");
}

// Mirrors the background validation: one line, no control characters, whitespace runs collapsed, trimmed.
function cleanPhrase(text) {
  return oneLine(String(text ?? "").normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim();
}

// An empty sentence is valid: it means "use the default one".
function phraseProblem(phrase) {
  if (!phrase) return null;
  if (phrase.length < PHRASE_MIN) return "short";
  if (phrase.length > PHRASE_MAX) return "long";
  return null;
}

function phraseProblemText(problem) {
  return problem === "short"
    ? t("options_phrase_error_short", [String(PHRASE_MIN)])
    : t("options_phrase_error_long", [String(PHRASE_MAX)]);
}

function resetPhraseDraft() {
  clearTimeout(phraseTimer);
  phraseTimer = null;
  phraseDraft = null;
  phraseErrorShown = false;
  phraseRefused = false;
}

// During a block the field shows the stored sentence, read only: any draft is dropped.
function renderPhrase(force) {
  const locked = isLocked();
  if (force || locked) resetPhraseDraft();
  const input = ui.phraseInput;
  setInputValue(input, phraseDraft ?? model.unlock.phrase, force || locked);
  input.disabled = locked;
  setTitle(input, locked ? lockedTitle() : "");
  setTitle(ui.phraseReset, locked ? lockedTitle() : "");
  ui.phraseLockNote.hidden = !locked;
  updatePhraseMeta();
}

function updatePhraseMeta() {
  const input = ui.phraseInput;
  const phrase = cleanPhrase(input.value);
  const problem = phraseProblem(phrase);
  // Nothing to count or reset while the default sentence is in use.
  ui.phraseCounter.textContent = phrase ? t("options_phrase_counter", [String(phrase.length), String(PHRASE_MAX)]) : "";
  ui.phraseCounter.classList.toggle("is-short", problem === "short");
  ui.phraseCounter.classList.toggle("is-long", problem === "long");

  const message = phraseRefused ? reasonText("invalid_phrase") : phraseErrorShown && problem ? phraseProblemText(problem) : "";
  ui.phraseError.textContent = message;
  ui.phraseError.hidden = !message;
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");

  ui.phraseFoot.hidden = !input.value && !model?.unlock.phrase;
  ui.phraseReset.disabled = isLocked();
}

function onPhraseBeforeInput(event) {
  if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") event.preventDefault();
}

// Also called without an event once an IME composition ends.
function onPhraseInput(event) {
  if (!model || isLocked()) return;
  const input = ui.phraseInput;
  phraseRefused = false;
  if (event?.isComposing) {
    phraseDraft = input.value;
    clearTimeout(phraseTimer);
    phraseTimer = null;
    updatePhraseMeta();
    return;
  }
  // Pasted or dropped line breaks become spaces; the caret stays right after the inserted text.
  const value = input.value;
  const cleaned = oneLine(value);
  if (cleaned !== value) {
    const caret = oneLine(value.slice(0, input.selectionEnd)).length;
    input.value = cleaned;
    input.setSelectionRange(caret, caret);
  }
  phraseDraft = input.value;
  if (!phraseProblem(cleanPhrase(phraseDraft))) phraseErrorShown = false;
  clearTimeout(phraseTimer);
  phraseTimer = setTimeout(commitPhrase, PHRASE_DEBOUNCE_MS);
  updatePhraseMeta();
}

function onPhraseKeydown(event) {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  commitPhrase();
}

function onPhraseBlur() {
  commitPhrase();
  if (phraseDraft !== null || !model) return;
  // Once the field is left, show the sentence exactly as it is stored (trimmed, single spaces).
  setInputValue(ui.phraseInput, model.unlock.phrase, false);
  updatePhraseMeta();
}

// Saves the draft when it is valid, otherwise shows why it can't be saved.
function commitPhrase() {
  clearTimeout(phraseTimer);
  phraseTimer = null;
  if (phraseDraft === null || !model || isLocked()) return;
  const phrase = cleanPhrase(phraseDraft);
  if (phraseProblem(phrase)) {
    phraseErrorShown = true;
    updatePhraseMeta();
    return;
  }
  phraseDraft = null;
  phraseErrorShown = false;
  phraseRefused = false;
  if (phrase === model.unlock.phrase) {
    updatePhraseMeta();
    return;
  }
  commit("unlock", { ...model.unlock, phrase });
}

// The background refused the sentence: keep it in the field so it can be fixed in place.
// Skipped when newer typing is pending, since that draft gets its own verdict.
function keepRefusedPhrase() {
  if (phraseDraft !== null) return;
  phraseDraft = ui.phraseInput.value;
  phraseRefused = true;
  updatePhraseMeta();
}

function onPhraseReset() {
  if (!model || isLocked()) return;
  resetPhraseDraft();
  ui.phraseInput.value = "";
  // The button disables itself once there is nothing left to reset, so keep focus in the page.
  ui.phraseInput.focus();
  if (model.unlock.phrase) commit("unlock", { ...model.unlock, phrase: "" });
  else updatePhraseMeta();
}

/* ---------- About ---------- */

function buildAbout() {
  ui.version.textContent = t("options_version", [chrome.runtime.getManifest().version]);
  ui.coffee.href = coffeeUrl(locale);
  ui.coffee.hidden = !coffeeUrl(locale);
  ui.incognitoButton.title = t("options_incognito_help");
  renderIncognito();
}

function renderIncognito() {
  try {
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      ui.incognitoRow.hidden = false;
      ui.incognitoRow.classList.toggle("is-off", !allowed);
      ui.incognitoIcon.replaceChildren(icon(allowed ? "check" : "eye-off"));
      ui.incognitoText.textContent = t(allowed ? "options_incognito_on" : "options_incognito_off");
      ui.incognitoButton.hidden = Boolean(allowed);
    });
  } catch {
    ui.incognitoRow.hidden = true;
  }
}

function openExtensionDetails() {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

/* ---------- Toast ---------- */

function showToast(message, kind, action = null) {
  clearTimeout(toastTimer);
  ui.toast.classList.remove("banner-danger", "banner-warning", "banner-info");
  ui.toast.classList.add(`banner-${kind}`);
  ui.toast.dataset.kind = kind;
  ui.toastIcon.replaceChildren(icon(kind === "info" ? "check" : "alert"));
  ui.toastText.textContent = message;
  toastAction = action?.run ?? null;
  ui.toastAction.textContent = action?.label ?? "";
  ui.toastAction.hidden = !action;
  ui.toast.classList.add("is-visible");
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastAction = null;
  ui.toast.classList.remove("is-visible");
}

function onToastAction() {
  const run = toastAction;
  hideToast();
  run?.();
}

/* ---------- Reset ---------- */

function resetLocked() {
  return isLocked() && !RESET_DURING_BLOCK;
}

function renderReset() {
  const locked = resetLocked();
  ui.resetAll.disabled = locked || resetting;
  setTitle(ui.resetAll, locked ? lockedTitle() : "");
  ui.resetLockNote.hidden = !locked;
  if (locked && !ui.resetConfirm.hidden) hideResetConfirm();
  ui.resetConfirmText.textContent = t(isLocked() ? "options_reset_confirm_block" : "options_reset_confirm");
}

function onResetAsk() {
  if (resetLocked() || resetting) return;
  renderReset();
  ui.resetConfirm.hidden = false;
  ui.resetFoot.hidden = true;
  ui.resetNo.focus();
}

function hideResetConfirm() {
  const hadFocus = ui.resetConfirm.contains(document.activeElement);
  ui.resetConfirm.hidden = true;
  ui.resetFoot.hidden = false;
  if (hadFocus) ui.resetAll.focus();
}

async function onResetConfirm() {
  if (resetting || resetLocked()) return;
  resetting = true;
  discardPendingEdits();
  ui.resetYes.disabled = true;
  ui.resetNo.disabled = true;
  const response = await api.resetAll();
  if (response?.ok) {
    location.replace(chrome.runtime.getURL("onboarding/onboarding.html"));
    return;
  }
  resetting = false;
  ui.resetYes.disabled = false;
  ui.resetNo.disabled = false;
  hideResetConfirm();
  showToast(reasonText(response?.reason), "danger");
  refresh();
}

// Debounced edits must not land after the reset (leaving the page would flush them otherwise).
function discardPendingEdits() {
  for (const key of [...textTimers.keys()]) cancelTextSave(key);
  clearTimeout(phraseTimer);
  phraseTimer = null;
  clearTimeout(amountTimer);
  amountTimer = null;
  for (const timer of slotTimers.values()) clearTimeout(timer);
  slotTimers.clear();
  pendingKeys.clear();
}

/* ---------- Utils ---------- */

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

init();
