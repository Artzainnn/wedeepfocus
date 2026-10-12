// Pure helpers for the service worker: input validation, strict snapshot, suspend (a session
// ended early), enforcement lists and alarm math. No chrome, no document, so they can be tested
// with node:test (checkPaidEnd only needs fetch).

import {
  DEFAULT_SETTINGS,
  GOAL_COUNT,
  GOAL_MAX_LENGTH,
  GROUP_ICONS,
  GROUP_NAME_MAX,
  LOOKAHEAD_DAYS,
  MAX_CUSTOM_DOMAINS,
  MAX_GROUP_DOMAINS,
  MAX_GROUPS,
  PHRASE_MAX,
  PHRASE_MIN,
  SESSION_MAX,
  SESSION_MIN,
  SETTINGS_KEYS,
  UNLOCK_MODES,
} from "../shared/constants.js";
import { normalizeDomain } from "../shared/domains.js";
import { isValidAmount, verifyPayment } from "../shared/payment.js";
import { cleanGroupName, getPreset, isGroupId } from "../shared/presets.js";
import { blockState, isValidSlot } from "../shared/schedule.js";
import { addToDay, focusSince } from "../shared/stats.js";

export { SETTINGS_KEYS };
export const STAT_KINDS = ["blocked", "resisted"];
// endSession: typing the sentence, or a payment the server confirmed.
export const END_METHODS = ["sentence", "paid"];
export const MAX_SCHEDULES = 50;
export const MAX_SCHEDULE_ID_LENGTH = 64;
export const SYNC_ITEM_QUOTA = 8192;

const MINUTE_MS = 60_000;
const LOOKAHEAD_MS = LOOKAHEAD_DAYS * 24 * 60 * MINUTE_MS;
// How long a suspend lasts when the ended block has no known end.
export const SUSPEND_FALLBACK_MS = 24 * 60 * MINUTE_MS;
export const HEARTBEAT_MINUTES = 5;
// The alarm never fires sooner than this after a reconcile.
export const ALARM_MIN_DELAY_MS = 1_000;
// Fired this long after an exact transition so the reconcile it triggers sees the new state.
export const ALARM_SLACK_MS = 250;

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function fail(reason) {
  return { ok: false, reason };
}

function ok(value) {
  return { ok: true, value };
}

// Accepts integers (or integer strings) in SESSION_MIN..SESSION_MAX, returns null otherwise.
export function parseMinutes(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(number) && number >= SESSION_MIN && number <= SESSION_MAX ? number : null;
}

export function activeSession(session, now) {
  if (!isPlainObject(session) || !Number.isFinite(session.endsAt) || session.endsAt <= now) return null;
  const startedAt = Number.isFinite(session.startedAt) ? Math.min(session.startedAt, now) : now;
  return { startedAt, endsAt: session.endsAt };
}

export function livePasses(passes, now) {
  const live = {};
  if (!isPlainObject(passes)) return live;
  for (const [domain, expiresAt] of Object.entries(passes)) {
    if (Number.isFinite(expiresAt) && expiresAt > now) live[domain] = expiresAt;
  }
  return live;
}

export function passesChanged(stored, live) {
  if (!isPlainObject(stored)) return true;
  return Object.keys(stored).length !== Object.keys(live).length;
}

export function todayStats(stats, dayKey) {
  if (!isPlainObject(stats) || stats.day !== dayKey) return { day: dayKey, blocked: 0, resisted: 0 };
  return { day: dayKey, blocked: counter(stats.blocked), resisted: counter(stats.resisted) };
}

export function bumpStat(stats, kind, dayKey) {
  const today = todayStats(stats, dayKey);
  return { ...today, [kind]: today[kind] + 1 };
}

function counter(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// JSON with object keys sorted, so values read back from chrome.storage (which may reorder keys)
// compare equal to the ones we wrote. undefined and null are the same thing here.
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value ?? null));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value;
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
  return sorted;
}

// ---------------------------------------------------------------------------
// Settings patches

// Returns { ok: true, value } with only the recognized, sanitized keys, or { ok: false, reason }.
export function sanitizePatch(patch, prev) {
  if (!isPlainObject(patch)) return fail("invalid_request");
  const sanitizers = {
    groups: sanitizeGroups,
    sites: sanitizeSites,
    schedules: sanitizeSchedules,
    goals: sanitizeGoals,
    prefs: sanitizePrefs,
    unlock: sanitizeUnlock,
  };
  const quotaReasons = {
    groups: "invalid_groups",
    sites: "too_many_domains",
    schedules: "invalid_schedule",
    unlock: "invalid_phrase",
  };
  const value = {};
  for (const key of SETTINGS_KEYS) {
    if (!Object.hasOwn(patch, key)) continue;
    const result = sanitizers[key](patch[key], prev?.[key]);
    if (!result.ok) return result;
    if (itemBytes(key, result.value) > SYNC_ITEM_QUOTA) return fail(quotaReasons[key] ?? "storage_error");
    value[key] = result.value;
  }
  return ok(value);
}

// Keeps only the keys whose value differs from the stored one (saves sync write quota).
export function pickChanged(values, prev) {
  const changed = {};
  for (const [key, value] of Object.entries(values)) {
    if (stableStringify(value) !== stableStringify(prev?.[key])) changed[key] = value;
  }
  return changed;
}

// V2 settings (sites.categories / sites.excluded) are migrated to groups at read time until
// `groups` is stored. Writing `sites` alone would drop them first, so the first write of either
// key also stores the other one (`settings` is the merged view `stored` gives).
export function completeMigration(changes, stored, settings) {
  const sites = isPlainObject(stored) && isPlainObject(stored.sites) ? stored.sites : {};
  const legacy = Object.hasOwn(sites, "categories") || Object.hasOwn(sites, "excluded");
  const touched = Object.hasOwn(changes, "groups") || Object.hasOwn(changes, "sites");
  if (!legacy || !touched || Array.isArray(stored?.groups)) return changes;
  return { groups: settings.groups, sites: settings.sites, ...changes };
}

export function itemBytes(key, value) {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

// Only the user's own sites live here now: V2 fields (categories, excluded) are dropped.
function sanitizeSites(input, prev = {}) {
  if (!isPlainObject(input)) return fail("invalid_request");
  const custom = normalizeDomainList(input.custom ?? prev.custom ?? []);
  if (!custom) return fail("invalid_domain");
  if (custom.length > MAX_CUSTOM_DOMAINS) return fail("too_many_domains");
  return ok({ custom });
}

// The whole list (order = display order). One invalid group refuses the patch.
function sanitizeGroups(input) {
  if (!Array.isArray(input) || input.length > MAX_GROUPS) return fail("invalid_groups");
  const ids = new Set();
  const groups = [];
  for (const raw of input) {
    const group = sanitizeGroup(raw);
    if (!group || ids.has(group.id)) return fail("invalid_groups");
    ids.add(group.id);
    groups.push(group);
  }
  return ok(groups);
}

// Same shape and key order as storage.mergeSettings. `preset` must name a preset when set (null
// or "" mean none); only preset groups may have an empty name (their localized name shows).
function sanitizeGroup(raw) {
  if (!isPlainObject(raw) || !isGroupId(raw.id) || typeof raw.enabled !== "boolean") return null;
  if (!GROUP_ICONS.includes(raw.icon)) return null;
  const hasPreset = raw.preset !== undefined && raw.preset !== null && raw.preset !== "";
  if (hasPreset && !getPreset(raw.preset)) return null;
  if (raw.name !== undefined && typeof raw.name !== "string") return null;
  const name = cleanGroupName(raw.name);
  if (Array.from(name).length > GROUP_NAME_MAX || (!name && !hasPreset)) return null;
  const domains = normalizeDomainList(raw.domains);
  if (!domains || domains.length > MAX_GROUP_DOMAINS) return null;
  return {
    id: raw.id,
    ...(hasPreset ? { preset: raw.preset } : {}),
    name,
    icon: raw.icon,
    domains,
    enabled: raw.enabled,
  };
}

// Normalizes and dedupes while keeping the original order; null when any entry is invalid.
function normalizeDomainList(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  for (const item of list) {
    const domain = typeof item === "string" ? normalizeDomain(item) : null;
    if (!domain) return null;
    seen.add(domain);
  }
  return [...seen];
}

function sanitizeSchedules(input) {
  if (!Array.isArray(input) || input.length > MAX_SCHEDULES) return fail("invalid_schedule");
  const ids = new Set();
  const slots = [];
  for (const raw of input) {
    const slot = sanitizeSlot(raw);
    if (!slot || ids.has(slot.id)) return fail("invalid_schedule");
    ids.add(slot.id);
    slots.push(slot);
  }
  return ok(slots);
}

function sanitizeSlot(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.days)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id || id.length > MAX_SCHEDULE_ID_LENGTH) return null;
  const slot = {
    id,
    days: [...new Set(raw.days)],
    start: raw.start,
    end: raw.end,
    enabled: raw.enabled !== false,
  };
  return isValidSlot(slot) ? slot : null;
}

function sanitizeGoals(input, prev = {}) {
  if (!isPlainObject(input)) return fail("invalid_request");
  const source = Array.isArray(input.items) ? input.items : Array.isArray(prev.items) ? prev.items : [];
  const items = Array.from({ length: GOAL_COUNT }, (_, index) => cleanGoal(source[index]));
  const showQuote = typeof input.showQuote === "boolean" ? input.showQuote : prev.showQuote !== false;
  return ok({ items, showQuote });
}

// Truncates by code point (never splits an emoji). Surrounding spaces are kept on purpose:
// autosave happens while the user types, and stripping a trailing space would fight the input.
function cleanGoal(value) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  const truncated = Array.from(flat).slice(0, GOAL_MAX_LENGTH).join("");
  return truncated.trim() ? truncated : "";
}

function sanitizePrefs(input, prev = {}) {
  if (!isPlainObject(input)) return fail("invalid_request");
  const onboarded = typeof input.onboarded === "boolean" ? input.onboarded : Boolean(prev.onboarded);
  return ok({ onboarded });
}

// Always stores { phrase, mode, amount }; a missing field keeps the stored one. The sentence follows
// validatePhrase (invalid_phrase); the mode must be one of UNLOCK_MODES and the amount a valid
// whole amount, kept in free mode too (invalid_unlock).
function sanitizeUnlock(input, prev) {
  if (!isPlainObject(input)) return fail("invalid_request");
  const stored = storedUnlock(prev);
  let phrase = stored.phrase;
  if (input.phrase !== undefined) {
    const result = validatePhrase(input.phrase);
    if (!result.ok) return result;
    phrase = result.value;
  }
  const mode = input.mode === undefined ? stored.mode : input.mode;
  const amount = input.amount === undefined ? stored.amount : input.amount;
  if (!UNLOCK_MODES.includes(mode) || !isValidAmount(amount)) return fail("invalid_unlock");
  return ok({ phrase, mode, amount });
}

// The stored unlock value with defaults for what V3 did not store (mode, amount).
function storedUnlock(prev) {
  const value = isPlainObject(prev) ? prev : {};
  const defaults = DEFAULT_SETTINGS.unlock;
  return {
    phrase: typeof value.phrase === "string" ? value.phrase : defaults.phrase,
    mode: UNLOCK_MODES.includes(value.mode) ? value.mode : defaults.mode,
    amount: isValidAmount(value.amount) ? value.amount : defaults.amount,
  };
}

// ---------------------------------------------------------------------------
// Custom unlock sentence

const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/;
const CONTROL_CHAR = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/;

// Stored form of an unlock sentence: whitespace runs become one space, no surrounding spaces.
export function normalizePhrase(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// { ok: true, value } with the normalized sentence, or { ok: false, reason: "invalid_phrase" }.
// "" means "use the default localized sentence". Otherwise the sentence must stay on one line,
// with no control characters, and be PHRASE_MIN to PHRASE_MAX characters once normalized.
// A line break at the very start or end is trimmed like any other surrounding whitespace.
export function validatePhrase(value) {
  if (typeof value !== "string") return fail("invalid_phrase");
  const trimmed = value.trim();
  if (LINE_BREAK.test(trimmed) || CONTROL_CHAR.test(trimmed)) return fail("invalid_phrase");
  const phrase = normalizePhrase(trimmed);
  if (phrase && (phrase.length < PHRASE_MIN || phrase.length > PHRASE_MAX)) return fail("invalid_phrase");
  return ok(phrase);
}

// ---------------------------------------------------------------------------
// Strict snapshot (chrome.storage.local "strict": { domains, until } | null)
//
// While a block is active the worker remembers its domains and its end. Until that end the block
// stays active and those domains stay blocked, even if the schedules or sites behind it were
// removed or shortened without going through the lock (sync from another device, DevTools).

// Sorted union of domain lists without duplicates, minus subdomains of a listed parent
// ("mail.google.com" goes when "google.com" is there, so a pass for a host always lifts it).
export function unionDomains(...lists) {
  const set = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const domain of list) if (typeof domain === "string" && domain) set.add(domain);
  }
  return [...set].filter((domain) => !hasListedParent(domain, set)).sort();
}

function hasListedParent(domain, set) {
  for (let dot = domain.indexOf("."); dot !== -1; dot = domain.indexOf(".", dot + 1)) {
    if (set.has(domain.slice(dot + 1))) return true;
  }
  return false;
}

// The stored snapshot if it still covers `now`, sanitized (invalid domains dropped, end clamped to
// the lookahead like every block end); null when missing, malformed or expired.
export function liveStrict(value, now) {
  if (!isPlainObject(value) || !Number.isFinite(value.until) || value.until <= now) return null;
  const domains = Array.isArray(value.domains) ? value.domains.map(sanitizeDomain).filter(Boolean) : [];
  return { domains: unionDomains(domains), until: Math.min(value.until, now + LOOKAHEAD_MS) };
}

function sanitizeDomain(value) {
  return typeof value === "string" ? normalizeDomain(value) : null;
}

// Block state, blocked domains and the snapshot and suspend to store, from the settings and the
// stored snapshot and suspend. `domains` are the effective domains of the current settings.
// Returns { block, domains, strict, suspend } where `block` has the blockState shape.
export function resolveBlock({ now, schedules, session, domains, strict, suspend }) {
  const pause = liveSuspend(suspend, now);
  if (pause) return suspendedBlock(now, schedules, session, domains, pause);
  const base = blockState(now, { schedules, session });
  const snapshot = liveStrict(strict, now);
  if (!snapshot) {
    const current = unionDomains(domains);
    return {
      block: base,
      domains: current,
      strict: base.active ? { domains: current, until: base.until } : null,
      suspend: null,
    };
  }
  const block = base.active && base.until >= snapshot.until ? base : extendBlock(base, now, schedules, session, snapshot.until);
  const union = unionDomains(domains, snapshot.domains);
  return { block, domains: union, strict: { domains: union, until: Math.max(snapshot.until, block.until) }, suspend: null };
}

// The snapshot acts like a session covering [now, until): merged with the real session and the
// schedules, so a slot starting right at `until` keeps the block continuous. The label stays the
// one of the real block; without one, the lost block was almost certainly a synced schedule.
function extendBlock(base, now, schedules, session, until) {
  const current = activeSession(session, now);
  const covering = current
    ? { startedAt: current.startedAt, endsAt: Math.max(current.endsAt, until) }
    : { startedAt: now, endsAt: until };
  const extended = blockState(now, { schedules, session: covering });
  return { ...extended, source: base.active ? base.source : "schedule" };
}

// ---------------------------------------------------------------------------
// Suspend (chrome.storage.local "suspend": { until } | null), SPEC 13.1
//
// Written when a session is ended early. Until `until` the schedules and the strict snapshot are
// ignored and no snapshot is written, so nothing blocks; only a session started since then does
// (the user asked for it). Once `until` passes, the schedules take over again.

// The stored suspend if it still covers `now`, reduced to { until } and clamped to the lookahead
// like every block end; null when missing, malformed or expired.
export function liveSuspend(value, now) {
  if (!isPlainObject(value) || !Number.isFinite(value.until) || value.until <= now) return null;
  return { until: Math.min(value.until, now + LOOKAHEAD_MS) };
}

function suspendedBlock(now, schedules, session, domains, pause) {
  const block = blockState(now, { session });
  return {
    block: block.active ? block : { ...block, nextStart: resumeTime(schedules, pause.until) },
    domains: unionDomains(domains),
    strict: null,
    suspend: pause,
  };
}

// When a scheduled block starts again after a suspend ending at `until`: `until` itself if a slot
// covers it, else the next slot start (null if none within the lookahead).
function resumeTime(schedules, until) {
  const state = blockState(until, { schedules });
  return state.active ? until : state.nextStart;
}

// The suspend endSession writes for the active `block`: until the end of that block (a day when it
// has none), and never earlier than a suspend already running (a session started during it).
export function suspendOnEnd(now, block, suspend) {
  const end = Number.isFinite(block?.until) && block.until > now ? block.until : now + SUSPEND_FALLBACK_MS;
  const current = liveSuspend(suspend, now);
  return { until: Math.max(end, current ? current.until : end) };
}

// endSession({ method: "paid", sessionId, token }): { ok: true } once the payment server confirms
// that this Checkout Session is paid for this token, else the refusal to send back.
export async function checkPaidEnd({ sessionId, token } = {}) {
  const result = await verifyPayment({ sessionId, token });
  if (!result.ok) return fail("payment_unavailable");
  return result.paid ? { ok: true } : fail("payment_not_verified");
}

// ---------------------------------------------------------------------------
// Enforcement

// enforced: blocked domains minus live passes. redirect: the ones with host permission (goals
// page), fallback: the others (Chrome's error page). Every domain is re-validated because one
// invalid entry makes the whole declarativeNetRequest update fail; `invalid` lists the dropped ones.
export function enforcementLists({ active, domains, granted, passes, now }) {
  const lists = { enforced: [], redirect: [], fallback: [], invalid: [] };
  if (!active) return lists;
  const grantedSet = new Set(Array.isArray(granted) ? granted : []);
  const live = isPlainObject(passes) ? passes : {};
  for (const domain of Array.isArray(domains) ? domains : []) {
    if (sanitizeDomain(domain) !== domain) {
      lists.invalid.push(domain);
      continue;
    }
    if (live[domain] > now) continue;
    lists.enforced.push(domain);
    (grantedSet.has(domain) ? lists.redirect : lists.fallback).push(domain);
  }
  return lists;
}

// ---------------------------------------------------------------------------
// Alarm

// Instant the badge text changes: the remaining time crosses a whole minute.
export function nextBadgeChange(now, until) {
  if (!Number.isFinite(until) || until <= now) return null;
  const minutes = Math.ceil((until - now) / MINUTE_MS);
  return until - (minutes - 1) * MINUTE_MS;
}

// One re-armed alarm: the next schedule/session/pass transition, the next badge change of an
// active block ending at `until` (its last change is the end itself) or the heartbeat, whichever
// comes first, and never sooner than ALARM_MIN_DELAY_MS.
export function nextAlarmTime(now, { transition = null, until = null } = {}) {
  const candidates = [now + HEARTBEAT_MINUTES * MINUTE_MS];
  for (const time of [transition, nextBadgeChange(now, until)]) {
    if (Number.isFinite(time) && time > now) candidates.push(time + ALARM_SLACK_MS);
  }
  return Math.max(now + ALARM_MIN_DELAY_MS, Math.min(...candidates));
}

// ---------------------------------------------------------------------------
// storage.onChanged loop guard ("local" area)

// Stats never affect enforcement. A key whose value did not change, or changed to the value this
// worker just wrote (`selfWrites`: key -> stableStringify(value)), needs no new reconcile.
export function localChangeNeedsReconcile(changes, selfWrites = new Map()) {
  if (!isPlainObject(changes)) return false;
  return Object.entries(changes).some(([key, change]) => {
    if (key === "stats" || key === "history" || key === "focusClock") return false;
    const next = stableStringify(change?.newValue);
    if (next === stableStringify(change?.oldValue)) return false;
    return selfWrites.get(key) !== next;
  });
}

// ---------------------------------------------------------------------------
// Usage history (chrome.storage.local "history" and "focusClock"), shown on the stats page only.

// What reconcile should store after running at `now`: protected focus time since the last write,
// and a completed block when one just ended on its own. null when nothing needs writing yet (at
// most one write a minute while the state stays the same).
export function trackFocus({ now, active, clock, history, dayKey }) {
  const gained = focusSince(clock, now);
  const completed = clock?.active === true && !active;
  const changed = !clock || (clock.active === true) !== active;
  if (!changed && gained < 60_000) return null;
  const changes = {};
  if (gained) changes.focusMs = gained;
  if (completed) changes.completed = 1;
  return {
    focusClock: { at: now, active },
    history: Object.keys(changes).length ? addToDay(history, dayKey, changes) : undefined,
  };
}

// The history entry for a session ended early: focus up to now, then a free or paid end (with
// the amount and currency the page reports, used for the local stats only).
export function endedChanges({ now, clock, method, amount, currency }) {
  const changes = { focusMs: focusSince(clock, now) };
  if (method === "paid") {
    changes.endedPaid = 1;
    if (Number.isInteger(amount) && amount > 0 && amount <= 500 && (currency === "EUR" || currency === "USD")) {
      changes.paid = { [currency]: amount };
    }
  } else {
    changes.endedFree = 1;
  }
  return changes;
}
