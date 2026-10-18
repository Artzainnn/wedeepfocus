import { t, applyI18n, uiLocale } from "../shared/i18n.js";
import { api, onStateChange } from "../shared/api.js";
import { icon } from "../shared/icons.js";
import { PRESETS, presetDomains, defaultGroups, groupDisplayName } from "../shared/presets.js";
import { normalizeDomain, effectiveDomains, findBlockingDomain, originPatterns } from "../shared/domains.js";
import { parseHM } from "../shared/schedule.js";
import { formatClock } from "../shared/format.js";
import { formatAmount, isValidAmount } from "../shared/payment.js";
import {
  ACCOUNTABILITY_ENABLED,
  CUSTOM_AMOUNT_MAX,
  CUSTOM_AMOUNT_MIN,
  DEFAULT_AMOUNT,
  DEFAULT_SLOT,
  EXTEND_MINUTES,
  GOAL_MAX_LENGTH,
  MAX_CUSTOM_DOMAINS,
  PAYMENT_AMOUNTS,
  SESSION_PRESETS,
} from "../shared/constants.js";

// Step 4 (money or free) only exists while accountability payments are on.
const TOTAL_STEPS = ACCOUNTABILITY_ENABLED ? 4 : 3;
const STEPS = Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1);
const TRY_MINUTES = SESSION_PRESETS[0]; // the same first choice as the popup and home page
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first, Date#getDay numbering
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const BUSY_DELAY_MS = 250;
const PIN_POLL_MS = 1500;
const PIN_BROWSERS = ["chrome", "edge", "brave", "arc", "other"];
// Suggested whys (i18n goal_option_<id>), "finish" preselected. The why is stored as the goal.
const GOAL_CHOICES = ["finish", "future", "proud", "time"];
const DEFAULT_GOAL_CHOICE = "finish";

const locale = uiLocale();
const $ = (id) => document.getElementById(id);

// Wizard state lives in memory only; each step is saved when the user continues.
const model = {
  step: 0, // 0 while loading, then 1..4 or "done"
  groups: [], // stored groups: the preset cards are applied to them on save, other groups stay as they are
  picks: new Map(), // preset id -> { selected, sites (display order), on (the sites kept) }
  custom: [],
  when: "manual",
  slot: null,
  otherSchedules: [],
  goal: "",
  goalChoice: DEFAULT_GOAL_CHOICE,
  // Step 4 always starts on money with the default amount; the stored phrase is kept as it is.
  mode: ACCOUNTABILITY_ENABLED ? "money" : "free",
  amount: DEFAULT_AMOUNT, // last preset picked
  amountOther: false, // "Other" picked: the typed amount applies
  amountText: "",
};
const cards = new Map(); // preset id -> elements of its card
const expanded = new Set(); // preset ids whose sites are shown

let state = null;
let busy = false;
let busyTimer = 0;
let refreshTimer = 0;
let expiryTimer = 0;
let slotTouched = false;
let sessionTried = false;
let trying = false;
// Pin step on the done screen: "unknown" until the browser answers, then "waiting", "pinned",
// "skipped", or "unsupported" (the browser cannot tell, so only the short reminder shows).
let pinStep = "unknown";
let pinTimer = 0;
let browserKind = "chrome";
// Set while this page saves prefs.onboarded itself, so its own write is not taken for a sync.
let finishing = false;

init();

async function init() {
  applyI18n();
  document.title = t("onb_doc_title", [t("appName")]);
  $("dots").querySelectorAll(".onb-dot").forEach((dot, index) => index >= TOTAL_STEPS && dot.remove());
  mountIcons();
  hideBrokenImages();
  buildGroups();
  buildDays();
  buildAmounts();
  buildGoalOptions();
  buildPinStep();
  bindEvents();

  state = await fetchState();
  loadModel(state.settings);
  renderAll();

  $("main").removeAttribute("aria-busy");
  if (state.settings.prefs.onboarded === true) showDone({ focus: false });
  else goTo(1, { focus: false });

  onStateChange(scheduleRefresh);
  window.addEventListener("focus", scheduleRefresh);
}

/* ---------- state ---------- */

async function fetchState() {
  const response = await api.getState();
  if (response?.ok && response.settings) return { ...response, settings: withDefaults(response.settings) };
  return { ok: false, settings: withDefaults(null), missing: [], block: { active: false, until: null } };
}

// The background already merges defaults; this only guards the fields the wizard reads.
function withDefaults(settings) {
  const source = isObject(settings) ? settings : {};
  const sites = isObject(source.sites) ? source.sites : {};
  const goals = isObject(source.goals) ? source.goals : {};
  const unlock = isObject(source.unlock) ? source.unlock : {};
  const groups = Array.isArray(source.groups)
    ? source.groups
      .filter((group) => isObject(group) && typeof group.id === "string")
      .map((group) => ({ ...group, domains: stringList(group.domains) }))
    : defaultGroups(locale);
  return {
    groups,
    sites: { custom: stringList(sites.custom) },
    schedules: Array.isArray(source.schedules) ? source.schedules.filter(isObject) : [],
    goals: {
      items: stringList(goals.items),
      showQuote: typeof goals.showQuote === "boolean" ? goals.showQuote : true,
    },
    prefs: isObject(source.prefs) ? { ...source.prefs } : { onboarded: false },
    unlock: { phrase: typeof unlock.phrase === "string" ? unlock.phrase : "" },
  };
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 100);
}

async function refresh() {
  state = await fetchState();
  if (model.step === "done") renderDone();
  else if (setUpElsewhere()) showSyncedSetup();
}

// On a second device this page opens before Chrome sync delivers the settings. Once they show
// that setup was finished elsewhere, walking through it again would overwrite them.
function setUpElsewhere() {
  return typeof model.step === "number" && model.step >= 1 && !busy && !finishing
    && state.ok !== false && state.settings.prefs.onboarded === true;
}

function showSyncedSetup() {
  loadModel(state.settings);
  renderAll();
  showDone({ focus: false });
}

function loadModel(settings) {
  loadSites(settings);
  loadSchedule(settings);
  loadGoal(settings);
}

function loadSites({ groups, sites }) {
  model.groups = groups.map((group) => ({ ...group, domains: [...group.domains] }));
  model.picks = new Map(PRESETS.map((preset) => [preset.id, pickFor(preset, presetGroup(preset.id))]));
  model.custom = [...sites.custom];
  for (const id of expanded) {
    if (!model.picks.get(id)?.selected) expanded.delete(id);
  }
}

function presetGroup(presetId) {
  return model.groups.find((group) => group.preset === presetId) ?? null;
}

// A card lists every suggested site plus any the group gained in settings; the group's own list
// says which ones are kept. A preset group deleted in settings starts unpicked.
function pickFor(preset, group) {
  const suggested = presetDomains(preset, locale);
  const kept = group ? group.domains : suggested;
  return {
    selected: group?.enabled === true,
    sites: [...new Set([...suggested, ...kept])],
    on: new Set(kept),
  };
}

// The onboarding edits the first stored slot (so going back and forth never duplicates it)
// and leaves any other slot untouched.
function loadSchedule({ schedules }) {
  const [first, ...rest] = schedules;
  model.otherSchedules = rest;
  if (first && Array.isArray(first.days)) {
    model.slot = { id: first.id, days: [...first.days], start: first.start, end: first.end };
  } else {
    model.slot = {
      id: model.slot?.id ?? newScheduleId(),
      days: [...DEFAULT_SLOT.days],
      start: DEFAULT_SLOT.start,
      end: DEFAULT_SLOT.end,
    };
  }
  model.when = schedules.some((slot) => slot.enabled !== false) ? "schedule" : "manual";
}

// A stored goal that matches a suggestion selects it; any other text is the user's own goal.
function loadGoal({ goals }) {
  const stored = (goals.items.find((goal) => goal.trim()) ?? "").trim();
  const match = GOAL_CHOICES.find((id) => goalText(id) === stored);
  model.goalChoice = stored ? match ?? "custom" : DEFAULT_GOAL_CHOICE;
  model.goal = match ? "" : stored;
}

function goalText(id) {
  return t(`goal_option_${id}`);
}

function chosenGoal() {
  return model.goalChoice === "custom" ? model.goal.trim() : goalText(model.goalChoice);
}

// All preset groups keep their place (disabled ones included, with the sites left on); a preset
// group deleted in settings only comes back when its card is picked.
function groupsToSave() {
  const applied = new Set();
  const groups = model.groups.map((group) => {
    const pick = model.picks.get(group.preset);
    if (!pick || applied.has(group.preset)) return group;
    applied.add(group.preset);
    return withPick(group, pick);
  });
  for (const preset of PRESETS) {
    const pick = model.picks.get(preset.id);
    if (pick.selected && !applied.has(preset.id)) groups.push(withPick(freshPresetGroup(preset), pick));
  }
  return groups;
}

// Stored order first (an untouched group saves unchanged), then the sites put back in.
function withPick(group, pick) {
  const kept = group.domains.filter((domain) => pick.on.has(domain));
  const added = pick.sites.filter((domain) => pick.on.has(domain) && !kept.includes(domain));
  return { ...group, enabled: pick.selected, domains: [...kept, ...added] };
}

function freshPresetGroup(preset) {
  return defaultGroups(locale).find((group) => group.preset === preset.id)
    ?? { id: preset.id, preset: preset.id, name: "", icon: preset.icon, domains: [], enabled: false };
}

function sitesToSave() {
  return { custom: [...model.custom] };
}

// Everything the user chose, as the background will enforce it.
function chosenDomains() {
  return effectiveDomains({ groups: groupsToSave(), sites: sitesToSave() });
}

function schedulesToSave() {
  if (model.when === "manual") return [];
  const { id, days, start, end } = model.slot;
  const slot = { id, days: [...new Set(days)].sort((a, b) => a - b), start, end, enabled: true };
  return [slot, ...model.otherSchedules];
}

/* ---------- navigation ---------- */

function goTo(step, { focus = true, direction = "forward" } = {}) {
  model.step = step;
  setError($("nav-error"), "");
  for (const n of STEPS) $(`step-${n}`).hidden = n !== step;
  $("done").hidden = true;
  $("pin-arrow").setAttribute("hidden", "");
  $("dots").hidden = false;
  $("nav").hidden = false;
  $("back").hidden = step === 1;
  $("next").hidden = step === TOTAL_STEPS;
  $("finish").hidden = step !== TOTAL_STEPS;
  renderDots(step);
  animateIn($(`step-${step}`), direction);
  if (focus) focusHeading(`step-${step}-title`);
}

function showDone({ focus = true } = {}) {
  model.step = "done";
  setError($("nav-error"), "");
  for (const n of STEPS) $(`step-${n}`).hidden = true;
  $("dots").hidden = true;
  $("nav").hidden = true;
  $("done").hidden = false;
  animateIn($("done"), "forward");
  renderDone();
  checkPin({ focus });
}

function renderDots(step) {
  $("dots").querySelectorAll(".onb-dot").forEach((dot, index) => {
    dot.classList.toggle("is-done", index < step - 1);
    dot.classList.toggle("is-current", index === step - 1);
  });
  $("dots-label").textContent = t("onb_step_aria", [step, TOTAL_STEPS]);
}

function animateIn(section, direction) {
  section.classList.remove("is-forward", "is-back");
  void section.offsetWidth; // restarts the entrance animation
  section.classList.add(direction === "back" ? "is-back" : "is-forward");
}

function focusHeading(id) {
  $(id).focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function onNext() {
  if (busy) return;
  if (model.step === 1) continueFromSites();
  else if (model.step === 2) continueFromSchedule();
  else if (model.step === 3) continueFromGoal();
}

function onBack() {
  if (busy || typeof model.step !== "number" || model.step <= 1) return;
  goTo(model.step - 1, { direction: "back" });
}

// chrome.permissions.request needs the click's user gesture: it is called before any await.
function continueFromSites() {
  if (!commitPendingCustom()) return;
  const patch = { groups: groupsToSave(), sites: sitesToSave() };
  const domains = effectiveDomains(patch);
  if (domains.length === 0) {
    setError($("nav-error"), t("onb_pick_one"));
    return;
  }
  const permission = requestOrigins(domains);
  save(patch, permission).then((ok) => {
    if (ok) goTo(2);
  });
}

function continueFromSchedule() {
  slotTouched = true;
  const error = slotError();
  renderSchedule();
  if (error) {
    focusFirstSlotProblem();
    return;
  }
  save({ schedules: schedulesToSave() }).then((ok) => {
    if (ok) goTo(3);
  });
}

function continueFromGoal() {
  if (!goalReady()) return;
  if (TOTAL_STEPS === 3) {
    finish();
    return;
  }
  save({ goals: goalsToSave() }).then((ok) => {
    if (ok) goTo(4);
  });
}

function goalReady() {
  if (chosenGoal()) return true;
  $("goal-error").textContent = t("onb_goal_empty");
  $("goal").focus();
  return false;
}

function goalsToSave() {
  return {
    items: [chosenGoal().slice(0, GOAL_MAX_LENGTH)],
    showQuote: state.settings.goals.showQuote,
  };
}

function finish() {
  if (busy) return;
  if (TOTAL_STEPS === 3 && !goalReady()) return;
  const amount = ACCOUNTABILITY_ENABLED ? chosenAmount() : state.settings.unlock.amount;
  if (amount === null) {
    showAmountError(true);
    $("amount-input").focus();
    return;
  }
  finishing = true;
  // The full unlock object, with the phrase left as stored (empty means the default sentence).
  const unlock = { phrase: state.settings.unlock.phrase, mode: ACCOUNTABILITY_ENABLED ? model.mode : "free", amount };
  const prefs = { ...state.settings.prefs, onboarded: true };
  save({ unlock, goals: goalsToSave(), prefs }).then(async (ok) => {
    if (!ok) {
      finishing = false;
      return;
    }
    state = await fetchState();
    showDone();
  });
}

async function save(patch, pending) {
  setBusy(true);
  setError($("nav-error"), "");
  try {
    const [response] = await Promise.all([api.saveSettings(patch), pending]);
    if (response?.ok) return true;
    await handleRefusal(response?.reason);
    return false;
  } finally {
    setBusy(false);
  }
}

// The background refused the change (strict mode during an active block): show why and
// put the step back in line with what is actually stored.
async function handleRefusal(reason) {
  setError($("nav-error"), reasonMessage(reason));
  state = await fetchState();
  if (model.step === 1) {
    loadSites(state.settings);
    renderSites();
  } else if (model.step === 2) {
    loadSchedule(state.settings);
    renderSchedule();
  }
}

// Visual feedback only when a save is slow (or Chrome's permission prompt is open), so quick saves don't flicker.
function setBusy(on) {
  busy = on;
  clearTimeout(busyTimer);
  if (on) busyTimer = setTimeout(() => showBusy(true), BUSY_DELAY_MS);
  else showBusy(false);
}

function showBusy(on) {
  $("nav").classList.toggle("is-busy", on);
  for (const id of ["next", "finish", "back"]) {
    if (on) $(id).setAttribute("aria-disabled", "true");
    else $(id).removeAttribute("aria-disabled");
  }
}

function requestOrigins(domains) {
  if (!domains.length) return Promise.resolve(true);
  try {
    return chrome.permissions.request({ origins: originPatterns(domains) }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/* ---------- step 1: groups ---------- */

function buildGroups() {
  const root = $("groups");
  for (const preset of PRESETS) {
    const id = preset.id;
    const card = el("div", "onb-group");

    const toggle = el("label", "onb-group-toggle");
    toggle.setAttribute("data-testid", `onb-category-${id}`);
    const input = el("input", "onb-group-input");
    input.type = "checkbox";
    input.addEventListener("change", () => pickGroup(id, input.checked));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.click();
      }
    });
    const bubble = el("span", "onb-bubble");
    const name = el("span", "onb-group-name");
    const count = el("span", "onb-group-count");
    const text = el("span", "onb-group-text");
    text.append(name, count);
    const main = el("span", "onb-group-main");
    main.append(bubble, text);
    const check = el("span", "onb-check");
    check.setAttribute("aria-hidden", "true");
    check.append(safeIcon("check", "icon icon-sm"));
    toggle.append(input, main, check);

    const panel = el("div", "onb-sites");
    panel.id = `onb-sites-${id}`;
    panel.setAttribute("role", "group");
    panel.hidden = true;

    const edit = el("button", "btn btn-sm btn-ghost onb-edit");
    edit.type = "button";
    edit.hidden = true;
    edit.setAttribute("data-testid", `onb-edit-${id}`);
    edit.setAttribute("aria-controls", panel.id);
    edit.setAttribute("aria-expanded", "false");
    edit.append(el("span", "", t("onb_edit")), safeIcon("chevron-down", "icon icon-sm"));
    edit.addEventListener("click", () => toggleExpanded(id));

    card.append(toggle, edit, panel);
    root.append(card);
    cards.set(id, { card, input, bubble, name, count, edit, panel });
  }
}

function renderSites() {
  for (const preset of PRESETS) renderCard(preset);
  renderCustomList();
}

function renderCard(preset) {
  const pick = model.picks.get(preset.id);
  const refs = cards.get(preset.id);
  const group = presetGroup(preset.id) ?? freshPresetGroup(preset);
  const label = groupDisplayName(group, t);
  const iconName = typeof group.icon === "string" && group.icon ? group.icon : preset.icon;
  const open = pick.selected && expanded.has(preset.id);

  refs.input.checked = pick.selected;
  refs.card.classList.toggle("is-selected", pick.selected);
  refs.name.textContent = label;
  refs.count.textContent = sitesText(pick.on.size);
  if (refs.bubble.dataset.icon !== iconName) {
    refs.bubble.dataset.icon = iconName;
    refs.bubble.replaceChildren(safeIcon(iconName));
  }
  refs.edit.hidden = !pick.selected;
  refs.edit.setAttribute("aria-label", t("onb_edit_label", [label]));
  refs.edit.setAttribute("aria-expanded", String(open));
  refs.panel.setAttribute("aria-label", label);
  refs.panel.hidden = !open;
  if (open) renderSiteChips(preset.id, pick, refs.panel);
}

// Chips are updated in place so the one just toggled keeps the keyboard focus.
function renderSiteChips(id, pick, panel) {
  const shown = [...panel.children].map((chip) => chip.dataset.domain);
  if (shown.join(" ") !== pick.sites.join(" ")) {
    panel.replaceChildren(...pick.sites.map((domain) => siteChip(id, domain)));
  }
  for (const chip of panel.children) {
    const on = pick.on.has(chip.dataset.domain);
    chip.classList.toggle("is-off", !on);
    chip.setAttribute("aria-pressed", String(on));
  }
}

function siteChip(id, domain) {
  const chip = el("button", "chip onb-site", domain);
  chip.type = "button";
  chip.dataset.domain = domain;
  chip.setAttribute("data-testid", `onb-site-${id}-${domain}`);
  chip.addEventListener("click", () => toggleSite(id, domain));
  return chip;
}

function pickGroup(id, selected) {
  model.picks.get(id).selected = selected;
  if (!selected) expanded.delete(id);
  onSitesEdited();
}

function toggleExpanded(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  renderSites();
}

function toggleSite(id, domain) {
  const { on } = model.picks.get(id);
  if (on.has(domain)) on.delete(domain);
  else on.add(domain);
  onSitesEdited();
}

function onSitesEdited() {
  setError($("nav-error"), "");
  renderSites();
}

/* ---------- step 1: your own sites ---------- */

function renderCustomList() {
  const list = $("custom-list");
  list.replaceChildren(
    ...model.custom.map((domain) => {
      const item = el("li", "chip onb-custom-chip");
      const remove = el("button", "onb-chip-remove");
      remove.type = "button";
      remove.setAttribute("aria-label", t("onb_custom_remove", [domain]));
      remove.setAttribute("data-testid", `onb-custom-remove-${domain}`);
      remove.append(safeIcon("x", "icon icon-sm"));
      remove.addEventListener("click", () => removeCustom(domain));
      item.append(el("span", "onb-custom-text", domain), remove);
      return item;
    }),
  );
  list.hidden = model.custom.length === 0;
}

function addCustom() {
  const input = $("custom-input");
  if (!input.value.trim()) {
    input.focus();
    return;
  }
  const result = parseCustom(input.value);
  showCustomError(result.error);
  if (result.error) return;
  model.custom.push(result.domain);
  input.value = "";
  onSitesEdited();
  input.focus();
}

// Text typed but not added yet is added on Continue. A site already on the list is simply dropped.
function commitPendingCustom() {
  const input = $("custom-input");
  if (!input.value.trim()) return true;
  const result = parseCustom(input.value);
  if (result.duplicate) {
    input.value = "";
    showCustomError("");
    return true;
  }
  showCustomError(result.error);
  if (result.error) {
    input.focus();
    return false;
  }
  model.custom.push(result.domain);
  input.value = "";
  renderSites();
  return true;
}

function parseCustom(text) {
  const domain = normalizeDomain(text);
  if (!domain) return { error: reasonMessage("invalid_domain") };
  if (findBlockingDomain(domain, chosenDomains())) return { error: reasonMessage("duplicate_domain"), duplicate: true };
  if (model.custom.length >= MAX_CUSTOM_DOMAINS) return { error: reasonMessage("too_many_domains") };
  return { domain, error: "" };
}

function showCustomError(message) {
  setError($("custom-error"), message);
  $("custom-input").setAttribute("aria-invalid", String(Boolean(message)));
}

function removeCustom(domain) {
  model.custom = model.custom.filter((item) => item !== domain);
  onSitesEdited();
  $("custom-input").focus();
}

/* ---------- step 2: when ---------- */

function buildDays() {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long" });
  const root = $("days");
  for (const day of WEEK_ORDER) {
    const date = new Date(2024, 0, day === 0 ? 7 : day); // 1 January 2024 is a Monday
    const button = el("button", "onb-day", short.format(date).replace(/\.$/, ""));
    button.type = "button";
    button.dataset.day = String(day);
    button.setAttribute("aria-label", long.format(date));
    button.setAttribute("data-testid", `onb-day-${day}`);
    button.addEventListener("click", () => toggleDay(day));
    root.append(button);
  }
}

function toggleDay(day) {
  const days = new Set(model.slot.days);
  if (days.has(day)) days.delete(day);
  else days.add(day);
  model.slot.days = [...days];
  slotTouched = true;
  renderSchedule();
}

function renderSchedule() {
  $("when-manual").checked = model.when === "manual";
  $("when-schedule").checked = model.when === "schedule";
  for (const choice of $("step-2").querySelectorAll(".onb-choice")) {
    choice.classList.toggle("is-selected", choice.querySelector("input").checked);
  }
  $("slot").hidden = model.when !== "schedule";

  for (const button of $("days").children) {
    button.setAttribute("aria-pressed", String(model.slot.days.includes(Number(button.dataset.day))));
  }
  syncValue($("slot-start"), model.slot.start);
  syncValue($("slot-end"), model.slot.end);

  const start = parseHM(model.slot.start);
  const end = parseHM(model.slot.end);
  $("next-day").hidden = !(end < start);

  const error = slotTouched ? slotError() : "";
  const timeError = Boolean(error) && error !== t("onb_error_no_day");
  setError($("slot-error"), error);
  $("slot-start").setAttribute("aria-invalid", String(timeError));
  $("slot-end").setAttribute("aria-invalid", String(timeError));
}

function slotError() {
  if (model.when !== "schedule") return "";
  if (model.slot.days.length === 0) return t("onb_error_no_day");
  const start = parseHM(model.slot.start);
  const end = parseHM(model.slot.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return t("onb_error_invalid_time");
  if (start === end) return t("onb_error_same_time");
  return "";
}

function focusFirstSlotProblem() {
  if (model.slot.days.length === 0) $("days").querySelector("button")?.focus();
  else if (Number.isNaN(parseHM(model.slot.start))) $("slot-start").focus();
  else $("slot-end").focus();
}

function onTimeInput(key, input) {
  model.slot[key] = input.value;
  renderSchedule();
}

function markSlotTouched() {
  slotTouched = true;
  renderSchedule();
}

function newScheduleId() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `s_${random.slice(0, 6)}`;
}

/* ---------- step 3: why (stored as the goal) ---------- */

function buildGoalOptions() {
  const root = $("goal-options");
  for (const id of [...GOAL_CHOICES, "custom"]) {
    const option = el("button", `onb-goal-option${id === "custom" ? " onb-goal-option-custom" : ""}`);
    option.type = "button";
    option.setAttribute("role", "radio");
    option.setAttribute("data-testid", `onb-goal-option-${id}`);
    option.dataset.choice = id;
    const label = el("span", "onb-goal-label", id === "custom" ? t("onb_goal_custom") : goalText(id));
    const radio = el("span", "onb-radio");
    radio.setAttribute("aria-hidden", "true");
    option.append(label, radio);
    option.addEventListener("click", () => pickGoal(id));
    root.append(option);
  }
}

function pickGoal(id) {
  model.goalChoice = id;
  $("goal-error").textContent = "";
  renderGoal();
  if (id === "custom") $("goal").focus();
}

function renderGoal() {
  for (const option of $("goal-options").children) {
    const checked = option.dataset.choice === model.goalChoice;
    option.setAttribute("aria-checked", String(checked));
    option.tabIndex = checked ? 0 : -1;
    option.classList.toggle("is-selected", checked);
  }
  const input = $("goal");
  input.hidden = model.goalChoice !== "custom";
  input.maxLength = GOAL_MAX_LENGTH;
  syncValue(input, model.goal);
}

/* ---------- step 4: ending a session early ---------- */

function buildAmounts() {
  const root = $("amounts");
  for (const amount of PAYMENT_AMOUNTS) {
    const chip = amountChip(`onb-amount-${amount}`, formatAmount(amount, locale));
    chip.dataset.amount = String(amount);
    chip.addEventListener("click", () => pickAmount(amount));
    root.append(chip);
  }
  const other = amountChip("onb-amount-other", t("onb_amount_other"));
  other.id = "amount-other";
  other.setAttribute("aria-controls", "amount-custom");
  other.addEventListener("click", openOtherAmount);
  root.append(other);

  const [prefix, suffix] = currencyAffixes();
  $("amount-prefix").textContent = prefix;
  $("amount-suffix").textContent = suffix;
  $("amount-input").placeholder = t("onb_amount_placeholder", [CUSTOM_AMOUNT_MIN, CUSTOM_AMOUNT_MAX]);
}

function amountChip(testid, label) {
  const chip = el("button", "onb-amount-chip", label);
  chip.type = "button";
  chip.setAttribute("data-testid", testid);
  return chip;
}

// The currency sign around a typed amount, where the locale writes it ("€5" in en, "5 €" in fr).
function currencyAffixes() {
  const sample = formatAmount(1, locale);
  const index = sample.indexOf("1");
  return index === -1 ? ["", ""] : [sample.slice(0, index).trim(), sample.slice(index + 1).trim()];
}

function renderMode() {
  $("mode-money").checked = model.mode === "money";
  $("mode-free").checked = model.mode === "free";
  for (const card of $("step-4").querySelectorAll(".onb-mode")) {
    card.classList.toggle("is-selected", card.querySelector(".onb-mode-input").checked);
  }
  $("amount").hidden = model.mode !== "money";
  for (const chip of $("amounts").querySelectorAll("[data-amount]")) {
    chip.setAttribute("aria-pressed", String(!model.amountOther && Number(chip.dataset.amount) === model.amount));
  }
  $("amount-other").setAttribute("aria-pressed", String(model.amountOther));
  $("amount-custom").hidden = !model.amountOther;
  syncValue($("amount-input"), model.amountText);
  renderStrict();
}

// Step 2 says how a session can end early: money wording until "Free only" is picked.
function renderStrict() {
  $("strict-text").textContent = t(model.mode === "free" ? "onb_strict_free" : "onb_strict_money");
}

function pickMode(mode) {
  model.mode = mode === "free" ? "free" : "money";
  showAmountError(false);
  setError($("nav-error"), "");
  renderMode();
}

function pickAmount(amount) {
  model.amount = amount;
  model.amountOther = false;
  showAmountError(false);
  renderMode();
}

function openOtherAmount() {
  model.amountOther = true;
  renderMode();
  $("amount-input").focus();
}

// A whole number of the allowed range, else null.
function parseAmount(text) {
  const value = String(text ?? "").trim();
  return /^\d{1,4}$/.test(value) && isValidAmount(Number(value)) ? Number(value) : null;
}

// The amount to save, or null while "Other" holds no valid amount for the money mode.
// Free mode never needs one: the last valid amount is kept for a later switch in the settings.
function chosenAmount() {
  if (!model.amountOther) return model.amount;
  const typed = parseAmount(model.amountText);
  if (typed !== null) return typed;
  return model.mode === "free" ? model.amount : null;
}

function showAmountError(on) {
  const range = [formatAmount(CUSTOM_AMOUNT_MIN, locale), formatAmount(CUSTOM_AMOUNT_MAX, locale)];
  setError($("amount-error"), on ? t("onb_amount_error", range) : "");
  $("amount-input").setAttribute("aria-invalid", String(on));
}

function onAmountInput(input) {
  model.amountText = input.value;
  showAmountError(false);
}

function onAmountBlur() {
  if (model.amountText.trim() && parseAmount(model.amountText) === null) showAmountError(true);
}

/* ---------- done ---------- */

function renderDone() {
  renderMissing();
  renderTry();
  renderPin();
}

/* ---------- done: pin step ---------- */

function buildPinStep() {
  const app = t("appName");
  $("pin-title").textContent = t("onb_pin_title", [app]);
  $("benefit-start").textContent = t("onb_pin_benefit_start", [TRY_MINUTES]);
  $("benefit-add").textContent = t("onb_pin_benefit_add", [EXTEND_MINUTES]);
  for (const demo of document.querySelectorAll('[data-i18n-aria-label="onb_pin_demo"]')) demo.setAttribute("aria-label", t("onb_pin_demo", [EXTEND_MINUTES]));
  for (const label of document.querySelectorAll(".pd-add-label")) label.textContent = t("popup_extend", [EXTEND_MINUTES]);
  for (const after of document.querySelectorAll(".pd-b")) after.textContent = formatMinutes(30 + EXTEND_MINUTES);
  for (const before of document.querySelectorAll(".pd-a")) before.textContent = formatMinutes(30);
  new ResizeObserver(fitPinDemo).observe($("pin-demo"));
  detectBrowser().then(setBrowserKind);
  // Arc adds its palette to pages a moment after they load.
  setTimeout(() => detectBrowser().then(setBrowserKind), 1200);
  chrome.action?.onUserSettingsChanged?.addListener((change) => {
    if (change?.isOnToolbar === true) onPinned();
  });
}

// The demo window is drawn at 720 px wide; zoom it to the space available (the box is at most 920 px).
function fitPinDemo() {
  const width = $("pin-demo").clientWidth;
  if (width) $("pin-stage").style.zoom = String(width / 720);
}

function formatMinutes(minutes) {
  return `${minutes}:00`;
}

// Where the extensions menu lives differs per browser: Arc keeps it behind the site controls
// icon in its sidebar, Edge shows an eye instead of a pin. Arc sets --arc-palette-* on pages,
// Brave answers navigator.brave, Edge names itself in the user agent brands.
async function detectBrowser() {
  if (getComputedStyle(document.documentElement).getPropertyValue("--arc-palette-title").trim()) return "arc";
  try {
    if (navigator.brave && (await navigator.brave.isBrave())) return "brave";
  } catch {
    // Not Brave.
  }
  const brands = (navigator.userAgentData?.brands ?? []).map((entry) => entry.brand);
  if (brands.some((brand) => /edge/i.test(brand))) return "edge";
  if (brands.includes("Google Chrome") || !brands.length) return "chrome";
  return "other";
}

function setBrowserKind(kind) {
  browserKind = PIN_BROWSERS.includes(kind) ? kind : "other";
  renderPin();
}

// The browser decides whether the icon is pinned (chrome.action.getUserSettings). null: it cannot tell.
async function readPinned() {
  try {
    const settings = await chrome.action.getUserSettings();
    return typeof settings?.isOnToolbar === "boolean" ? settings.isOnToolbar : null;
  } catch {
    return null;
  }
}

async function checkPin({ focus = false } = {}) {
  const pinned = await readPinned();
  if (pinned === null) pinStep = "unsupported";
  else if (pinned) pinStep = "pinned";
  else if (pinStep !== "skipped") pinStep = "waiting";
  renderPin();
  watchPin();
  if (focus) focusHeading(pinStep === "waiting" ? "pin-title" : "done-title");
}

// Chrome 130+ reports the pin as it happens (onUserSettingsChanged); a short poll covers older
// versions and browsers that never send the event.
function watchPin() {
  clearTimeout(pinTimer);
  if (pinStep !== "waiting") return;
  pinTimer = setTimeout(async () => {
    if (pinStep !== "waiting") return;
    if (!document.hidden && (await readPinned()) === true) onPinned();
    else watchPin();
  }, PIN_POLL_MS);
}

function onPinned() {
  if (pinStep !== "waiting" || model.step !== "done") return;
  pinStep = "pinned";
  clearTimeout(pinTimer);
  renderPin();
  animateIn($("final"), "forward");
  focusHeading("done-title");
}

function skipPin() {
  pinStep = "skipped";
  clearTimeout(pinTimer);
  renderPin();
  animateIn($("final"), "forward");
  focusHeading("done-title");
}

function renderPin() {
  const known = pinStep !== "unknown";
  const waiting = pinStep === "waiting";
  $("pin-step").hidden = !waiting;
  $("final").hidden = !known || waiting;
  $("benefits").hidden = pinStep !== "pinned";
  $("pin-reminder").hidden = pinStep === "pinned";
  const title = t(pinStep === "pinned" ? "onb_pinned_title" : "onb_done_title");
  if ($("done-title").textContent !== title) $("done-title").textContent = title;
  $("pin-step").dataset.browser = browserKind;
  $("pin-arrow").dataset.browser = browserKind;
  $("pin-arrow").toggleAttribute("hidden", !waiting || model.step !== "done"); // an SVG element has no .hidden
  const how = t(`onb_pin_how_${browserKind}`, [t("appName")]);
  if ($("pin-how").textContent !== how) $("pin-how").textContent = how;
}

// Sites without host access are still blocked, with Chrome's error page instead of the goal.
function renderMissing() {
  const count = Array.isArray(state.missing) ? state.missing.length : 0;
  $("missing").hidden = count === 0;
  if (count) $("missing-text").textContent = count === 1 ? t("onb_missing_one") : t("onb_missing_many", [count]);
}

function grantMissing() {
  const missing = Array.isArray(state.missing) ? state.missing : [];
  if (!missing.length) return;
  requestOrigins(missing).then(refresh);
}

function renderTry() {
  const block = state.block ?? {};
  const now = Date.now();
  const active = block.active === true && Number.isFinite(block.until) && block.until > now;
  if (!active) sessionTried = false;
  const started = sessionTried && active;
  const label = started ? t("onb_focus_until", [formatClock(block.until, locale)]) : t("onb_try_session", [TRY_MINUTES]);

  const button = $("try-session");
  button.classList.toggle("is-started", started);
  if (started) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
  $("try-icon").hidden = !started;
  if ($("try-label").textContent !== label) $("try-label").textContent = label;
  $("try-status").textContent = started ? label : "";

  clearTimeout(expiryTimer);
  // No storage event fires when a block simply runs out, so refresh on our own at that moment.
  if (active) expiryTimer = setTimeout(scheduleRefresh, Math.min(block.until - now + 1000, MAX_TIMEOUT_MS));
}

async function trySession() {
  if (trying || $("try-session").getAttribute("aria-disabled") === "true") return;
  trying = true;
  setError($("try-error"), "");
  const response = await api.startSession(TRY_MINUTES);
  trying = false;
  if (!response?.ok) {
    setError($("try-error"), reasonMessage(response?.reason));
    return;
  }
  sessionTried = true;
  state = { ...response, settings: withDefaults(response.settings) };
  renderDone();
}

/* ---------- events ---------- */

function bindEvents() {
  $("next").addEventListener("click", onNext);
  $("back").addEventListener("click", onBack);
  $("finish").addEventListener("click", finish);

  $("custom-add").addEventListener("click", addCustom);
  $("custom-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      addCustom();
    }
  });
  $("custom-input").addEventListener("input", () => showCustomError(""));

  for (const radio of document.querySelectorAll('input[name="when"]')) {
    radio.addEventListener("change", () => {
      model.when = radio.value;
      setError($("nav-error"), "");
      renderSchedule();
    });
  }
  $("slot-start").addEventListener("input", (event) => onTimeInput("start", event.target));
  $("slot-end").addEventListener("input", (event) => onTimeInput("end", event.target));
  $("slot-start").addEventListener("change", markSlotTouched);
  $("slot-end").addEventListener("change", markSlotTouched);
  $("step-2").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      onNext();
    }
  });

  $("goal").addEventListener("input", (event) => {
    model.goal = event.target.value;
    $("goal-error").textContent = "";
  });
  $("goal").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      onNext();
    }
  });

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => pickMode(radio.value));
  }
  $("amount-input").addEventListener("input", (event) => onAmountInput(event.target));
  $("amount-input").addEventListener("blur", onAmountBlur);
  $("step-4").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      finish();
    }
  });

  $("try-session").addEventListener("click", trySession);
  $("pin-skip").addEventListener("click", skipPin);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pinStep === "waiting") readPinned().then((pinned) => pinned && onPinned());
  });
  $("open-settings").addEventListener("click", () => api.openOptions());
  $("grant-missing").addEventListener("click", grantMissing);
}

/* ---------- helpers ---------- */

function renderAll() {
  renderSites();
  renderSchedule();
  renderGoal();
  renderMode();
}

function sitesText(count) {
  if (count === 0) return t("onb_sites_zero");
  if (count === 1) return t("onb_sites_one");
  return t("onb_sites_many", [count]);
}

function mountIcons() {
  for (const slot of document.querySelectorAll("span[data-icon]")) {
    slot.replaceWith(safeIcon(slot.dataset.icon, slot.getAttribute("class") || "icon"));
  }
}

function hideBrokenImages() {
  for (const image of document.querySelectorAll("img")) {
    const hide = () => image.classList.add("is-broken");
    if (image.complete && image.naturalWidth === 0) hide();
    else image.addEventListener("error", hide, { once: true });
  }
}

function safeIcon(name, className = "icon") {
  try {
    const node = icon(name, className);
    if (node instanceof Node) return node;
  } catch {
    // Unknown icon name: fall back to an empty box of the same size.
  }
  return el("span", className);
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setError(node, message) {
  node.textContent = message || "";
}

// Localized text for a background refusal ("lock_group" -> reason_lock_group).
function reasonMessage(reason) {
  const key = `reason_${reason}`;
  const message = typeof reason === "string" && /^[a-z0-9_]+$/.test(reason) ? t(key) : key;
  return message === key ? t("reason_unknown") : message;
}

function syncValue(input, value) {
  if (input.value !== value) input.value = value ?? "";
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
