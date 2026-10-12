// chrome.storage access. Pages read through here but never write settings directly:
// they call api.saveSettings(patch) so the background can enforce the lock.

import {
  DEFAULT_GROUP_ICON,
  DEFAULT_SETTINGS,
  GOAL_COUNT,
  GROUP_ICONS,
  GROUP_NAME_MAX,
  MAX_GROUP_DOMAINS,
  MAX_GROUPS,
  SETTINGS_KEYS,
  UNLOCK_MODES,
} from "./constants.js";
import { normalizeDomain } from "./domains.js";
import { localDayKey } from "./format.js";
import { phraseLength } from "./friction.js";
import { uiLocale } from "./i18n.js";
import { isValidAmount } from "./payment.js";
import { cleanGroupName, defaultGroups, getPreset, isGroupId } from "./presets.js";

export { SETTINGS_KEYS };
export const RUNTIME_KEYS = ["session", "passes", "stats"];

export async function getSettings() {
  return mergeSettings(await chrome.storage.sync.get(SETTINGS_KEYS), uiLocale());
}

export async function getRuntime() {
  return mergeRuntime(await chrome.storage.local.get(RUNTIME_KEYS));
}

export async function setRuntime(patch) {
  await chrome.storage.local.set(patch);
}

export function onSettingsChanged(cb) {
  return onAreaChanged("sync", cb);
}

export function onRuntimeChanged(cb) {
  return onAreaChanged("local", cb);
}

function onAreaChanged(area, cb) {
  const listener = (changes, changedArea) => {
    if (changedArea === area) cb(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// Pure helpers (exported for the background and for tests). Always return fresh objects.

// Stored sync values -> complete settings. Never throws: invalid entries are dropped or replaced by
// defaults. `locale` picks the localized preset domains of the default (or migrated) groups.
export function mergeSettings(stored, locale) {
  const source = isObject(stored) ? stored : {};
  const defaults = DEFAULT_SETTINGS;
  const sites = isObject(source.sites) ? source.sites : {};
  return {
    groups: mergeGroups(source, locale),
    sites: { custom: stringList(sites.custom) },
    schedules: Array.isArray(source.schedules)
      ? source.schedules.filter(isObject).map((slot) => ({ ...slot, days: Array.isArray(slot.days) ? [...slot.days] : [] }))
      : [],
    goals: mergeGoals(source.goals),
    prefs: { ...defaults.prefs, ...(isObject(source.prefs) ? source.prefs : {}) },
    unlock: mergeUnlock(source.unlock),
  };
}

// Stored groups win (even an empty list: the user deleted them). Otherwise V2 settings
// (sites.categories / sites.excluded) are migrated, else the default groups apply.
function mergeGroups(source, locale) {
  if (Array.isArray(source.groups)) return storedGroups(source.groups);
  const sites = isObject(source.sites) ? source.sites : {};
  if (isObject(sites.categories) || Array.isArray(sites.excluded)) return migratedGroups(sites, locale);
  return defaultGroups(locale);
}

// V2: a category on or off per preset (missing ones keep the default) and unchecked preset sites.
function migratedGroups(sites, locale) {
  const categories = isObject(sites.categories) ? sites.categories : {};
  const excluded = new Set(normalizedList(sites.excluded));
  return defaultGroups(locale).map((group) => ({
    ...group,
    domains: group.domains.filter((domain) => !excluded.has(domain)),
    enabled: typeof categories[group.id] === "boolean" ? categories[group.id] : group.enabled,
  }));
}

function storedGroups(list) {
  const ids = new Set();
  const groups = [];
  for (const raw of list) {
    const group = storedGroup(raw);
    if (!group || ids.has(group.id)) continue;
    ids.add(group.id);
    groups.push(group);
    if (groups.length === MAX_GROUPS) break;
  }
  return groups;
}

// Same shape and key order as the groups saveSettings writes. Only a missing or invalid id drops
// the group; everything else is repaired (unknown preset or icon, invalid domains, long name).
function storedGroup(raw) {
  if (!isObject(raw) || !isGroupId(raw.id)) return null;
  const preset = getPreset(raw.preset);
  return {
    id: raw.id,
    ...(preset ? { preset: preset.id } : {}),
    name: Array.from(cleanGroupName(raw.name)).slice(0, GROUP_NAME_MAX).join("").trim(),
    icon: GROUP_ICONS.includes(raw.icon) ? raw.icon : (preset?.icon ?? DEFAULT_GROUP_ICON),
    domains: [...new Set(normalizedList(raw.domains))].slice(0, MAX_GROUP_DOMAINS),
    enabled: raw.enabled === true,
  };
}

// Exactly GOAL_COUNT strings: the first non blank stored goals (V2 kept 3, often with blanks first).
function mergeGoals(value) {
  const goals = isObject(value) ? value : {};
  const filled = stringList(goals.items).filter((item) => item.trim());
  return {
    items: Array.from({ length: GOAL_COUNT }, (_, index) => filled[index] ?? ""),
    showQuote: typeof goals.showQuote === "boolean" ? goals.showQuote : DEFAULT_SETTINGS.goals.showQuote,
  };
}

// Always { phrase, mode, amount }. V3 stored only the phrase: the mode and amount get their defaults.
function mergeUnlock(value) {
  const unlock = isObject(value) ? value : {};
  const defaults = DEFAULT_SETTINGS.unlock;
  return {
    phrase: unlockPhrase(unlock.phrase),
    mode: UNLOCK_MODES.includes(unlock.mode) ? unlock.mode : defaults.mode,
    amount: isValidAmount(unlock.amount) ? unlock.amount : defaults.amount,
  };
}

// "" (the default sentence) unless the stored one can actually be typed: a phrase made only of
// spaces or invisible characters could never be completed and would make ending a session impossible.
function unlockPhrase(phrase) {
  return typeof phrase === "string" && phraseLength(phrase) > 0 ? phrase : "";
}

export function mergeRuntime(stored, now = Date.now()) {
  const source = isObject(stored) ? stored : {};
  const today = localDayKey(now);

  let session = null;
  if (isObject(source.session) && Number.isFinite(source.session.endsAt)) {
    const { startedAt, endsAt } = source.session;
    session = { startedAt: Number.isFinite(startedAt) ? startedAt : endsAt, endsAt };
  }

  const passes = {};
  if (isObject(source.passes)) {
    for (const [domain, expiresAt] of Object.entries(source.passes)) {
      if (Number.isFinite(expiresAt)) passes[domain] = expiresAt;
    }
  }

  const stats = isObject(source.stats) && source.stats.day === today
    ? { day: today, blocked: count(source.stats.blocked), resisted: count(source.stats.resisted) }
    : { day: today, blocked: 0, resisted: 0 };

  return { session, passes, stats };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function normalizedList(value) {
  return stringList(value).map(normalizeDomain).filter(Boolean);
}

function count(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}
