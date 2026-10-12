// Strict mode: while a block is active, settings may only get stricter. Pure module: no chrome, no document.

import { normalizeDomain } from "./domains.js";
import { parseHM } from "./schedule.js";

const OK = Object.freeze({ ok: true });

// prev/next: { groups, sites, schedules, unlock }. Groups are matched by id: an enabled group
// missing from `next` was deleted. Disabled groups can be edited or deleted freely. Only the
// sentence of `unlock` is locked: its mode and amount can change anytime (SPEC 13.2).
export function checkChange(prev, next, blockActive) {
  if (!blockActive) return { ...OK };
  const before = pick(prev);
  const after = pick(next, before);

  if (dropsEnabledGroup(before.groups, after.groups)) return refuse("lock_group");
  if (removesGroupSite(before.groups, after.groups)) return refuse("lock_group_site");
  if (removesCustom(before.sites, after.sites)) return refuse("lock_custom");
  if (changesSchedules(before.schedules, after.schedules)) return refuse("lock_schedule");
  if (changesPhrase(before.unlock, after.unlock)) return refuse("lock_phrase");
  return { ...OK };
}

function refuse(reason) {
  return { ok: false, reason };
}

// A key missing from `next` means "unchanged"; a key present but malformed counts as emptied.
function pick(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const field = (key) => (key in source ? source[key] : fallback?.[key]);
  return {
    groups: arrayOf(field("groups")),
    sites: objectOf(field("sites")),
    schedules: arrayOf(field("schedules")),
    unlock: objectOf(field("unlock")),
  };
}

// Every enabled group must still exist (same id) and still be enabled.
function dropsEnabledGroup(before, after) {
  return enabledGroups(before).some((group) => findGroup(after, group.id)?.enabled !== true);
}

// Every enabled group must keep all its sites (adding sites is fine).
function removesGroupSite(before, after) {
  return enabledGroups(before).some((group) => {
    const kept = domainSet(findGroup(after, group.id)?.domains);
    return [...domainSet(group.domains)].some((domain) => !kept.has(domain));
  });
}

function enabledGroups(groups) {
  return groups.filter((group) => group && typeof group === "object" && group.enabled === true);
}

// The first group with this id, like mergeSettings, which drops later duplicates.
function findGroup(groups, id) {
  return groups.find((group) => group && typeof group === "object" && group.id === id);
}

function removesCustom(before, after) {
  const now = domainSet(after.custom);
  return [...domainSet(before.custom)].some((domain) => !now.has(domain));
}

// Every existing schedule must still be present (same id) and keep its days and times.
// Extra schedules are fine: adding one can only block more.
function changesSchedules(before, after) {
  return before.some((slot) => {
    if (!slot || typeof slot !== "object") return false;
    const hasId = slot.id !== undefined && slot.id !== null;
    return !after.some((candidate) => (!hasId || candidate?.id === slot.id) && keepsSlot(slot, candidate));
  });
}

// Switching a disabled slot on only blocks more, so it is the one allowed edit.
function keepsSlot(a, b) {
  if (!b || typeof b !== "object") return false;
  const wasEnabled = a.enabled !== false;
  const isEnabled = b.enabled !== false;
  return (
    sameDays(a.days, b.days) &&
    sameTime(a.start, b.start) &&
    sameTime(a.end, b.end) &&
    (isEnabled || !wasEnabled)
  );
}

function sameDays(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function sameTime(a, b) {
  const left = parseHM(a);
  const right = parseHM(b);
  return Number.isNaN(left) || Number.isNaN(right) ? a === b : left === right;
}

// Any edit of the unlock sentence is refused, even one that makes it longer. Compared the way
// saveSettings stores it (trimmed, whitespace runs collapsed): spacing never changes what is typed.
// The mode and amount are never compared: the free way out always exists, so they can't weaken a block.
function changesPhrase(before, after) {
  return storedPhrase(before) !== storedPhrase(after);
}

function storedPhrase(unlock) {
  return typeof unlock.phrase === "string" ? unlock.phrase.replace(/\s+/g, " ").trim() : "";
}

function domainSet(list) {
  const set = new Set();
  for (const entry of arrayOf(list)) {
    if (typeof entry !== "string") continue;
    set.add(normalizeDomain(entry) ?? entry.trim().toLowerCase());
  }
  return set;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function objectOf(value) {
  return value && typeof value === "object" ? value : {};
}
