// Background service worker. Stateless: every event runs reconcile(), which derives the
// blocking rules, badge and alarm from storage. Reconciles and state-changing messages are
// serialized through a single promise chain so they never interleave.

import { BADGE_COLOR, EXTEND_MINUTES, PASS_MINUTES, RESET_DURING_BLOCK } from "../shared/constants.js";
import { nextTransition } from "../shared/schedule.js";
import {
  domainsForOrigins,
  effectiveDomains,
  findBlockingDomain,
  normalizeDomain,
  originPatterns,
} from "../shared/domains.js";
import { checkChange } from "../shared/lock.js";
import { BLOCK_RULE_ID, FALLBACK_RULE_ID, buildRules } from "../shared/rules.js";
import { formatBadge, formatClock, formatWeekdayClock, localDayKey } from "../shared/format.js";
import { getRuntime, getSettings, mergeSettings } from "../shared/storage.js";
import { t, uiLocale } from "../shared/i18n.js";
import { feedbackUrl } from "../shared/feedback.js";
import {
  END_METHODS,
  HEARTBEAT_MINUTES,
  SETTINGS_KEYS,
  STAT_KINDS,
  activeSession,
  bumpStat,
  checkPaidEnd,
  completeMigration,
  endedChanges,
  enforcementLists,
  fail,
  isPlainObject,
  livePasses,
  localChangeNeedsReconcile,
  nextAlarmTime,
  parseMinutes,
  passesChanged,
  pickChanged,
  resolveBlock,
  sanitizePatch,
  stableStringify,
  suspendOnEnd,
  todayStats,
  trackFocus,
} from "./logic.js";
import { addToDay } from "../shared/stats.js";

const BLOCKED_URL = chrome.runtime.getURL("blocked/blocked.html");
const ONBOARDING_URL = chrome.runtime.getURL("onboarding/onboarding.html");
const RECONCILE_ALARM = "reconcile";
const LEGACY_ALARMS = ["transition", "tick"];
// An existing alarm this close to the wanted time is kept: re-creating it would let Chrome push
// it back to its 30 s minimum delay again.
const ALARM_TOLERANCE_MS = 1_000;
const MINUTE_MS = 60_000;
// Used when a block has no computable end (continuous beyond the lookahead): shows "10h+".
const FAR_REMAINING_MS = 24 * 60 * MINUTE_MS;
const BADGE_TEXT = "#ffffff";
const WEB_URL = /^https?:\/\//i;

const noop = () => {};

function logError(label, error) {
  console.error(`[focus] ${label}:`, error);
}

async function step(label, task) {
  try {
    return await task();
  } catch (error) {
    logError(label, error);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serialization

let chain = Promise.resolve();
let pendingReconcile = null;

function enqueue(task) {
  // Anything queued after this task must see its effects, so a waiting reconcile can't be reused.
  pendingReconcile = null;
  const run = chain.then(task);
  chain = run.then(noop, noop);
  return run;
}

// Coalesces bursts: if a reconcile is already waiting at the tail of the chain, share it.
function reconcile() {
  if (pendingReconcile) return pendingReconcile;
  const run = enqueue(() => {
    if (pendingReconcile === run) pendingReconcile = null;
    return reconcileNow();
  }).catch((error) => {
    logError("reconcile failed", error);
    return null;
  });
  pendingReconcile = run;
  return run;
}

// For use inside an already queued task (queuing again from there would deadlock).
function reconcileInline() {
  return step("reconcile failed", reconcileNow);
}

// ---------------------------------------------------------------------------
// Runtime writes (chrome.storage.local)

// Last value this worker wrote per key: storage.onChanged ignores the echo of our own writes.
const selfWrites = new Map();

async function writeLocal(patch) {
  for (const [key, value] of Object.entries(patch)) selfWrites.set(key, stableStringify(value));
  await chrome.storage.local.set(patch);
}

// ---------------------------------------------------------------------------
// Reconcile

async function readSnapshot() {
  const [settings, runtime, local, permissions] = await Promise.all([
    getSettings(),
    getRuntime(),
    chrome.storage.local.get({ strict: null, suspend: null, history: null, focusClock: null }),
    chrome.permissions.getAll(),
  ]);
  const now = Date.now();
  const locale = uiLocale();
  const passes = livePasses(runtime.passes, now);
  const session = activeSession(runtime.session, now);
  const resolved = resolveBlock({
    now,
    schedules: settings.schedules,
    session,
    domains: effectiveDomains(settings),
    strict: local.strict,
    suspend: local.suspend,
  });
  const { block, domains } = resolved;
  const granted = domainsForOrigins(permissions.origins ?? [], domains);
  const grantedSet = new Set(granted);
  const missing = domains.filter((domain) => !grantedSet.has(domain));
  const { enforced, redirect, fallback, invalid } = enforcementLists({ active: block.active, domains, granted, passes, now });
  const stats = todayStats(runtime.stats, localDayKey(now));
  return {
    now,
    locale,
    settings,
    runtime,
    passes,
    session,
    block,
    domains,
    granted,
    missing,
    enforced,
    redirect,
    fallback,
    invalid,
    strict: resolved.strict,
    storedStrict: local.strict ?? null,
    suspend: resolved.suspend,
    storedSuspend: local.suspend ?? null,
    history: local.history,
    focusClock: local.focusClock,
    stats,
  };
}

async function reconcileNow() {
  const snap = await readSnapshot();
  if (snap.invalid.length) console.warn("[focus] invalid domains left out of the rules:", snap.invalid);
  await step("save runtime state", () => saveRuntimeState(snap));
  await step("apply rules", () => applyEnforcement(snap));
  await step("update badge", () => updateBadge(snap));
  await step("update alarm", () => updateAlarm(snap));
  return {
    active: snap.block.active,
    until: snap.block.until,
    enforced: snap.enforced,
    redirect: snap.redirect,
    fallback: snap.fallback,
    missing: snap.missing,
  };
}

// Drops expired passes, sessions and suspends, and stores the strict snapshot when it changed.
async function saveRuntimeState({ now, block, runtime, passes, session, strict, storedStrict, suspend, storedSuspend, history, focusClock }) {
  const patch = {};
  const focus = trackFocus({ now, active: block.active, clock: focusClock, history, dayKey: localDayKey(now) });
  if (focus) {
    patch.focusClock = focus.focusClock;
    if (focus.history) patch.history = focus.history;
  }
  if (passesChanged(runtime.passes, passes)) patch.passes = passes;
  if (runtime.session && !session) patch.session = null;
  if (stableStringify(strict) !== stableStringify(storedStrict)) patch.strict = strict;
  if (stableStringify(suspend) !== stableStringify(storedSuspend)) patch.suspend = suspend;
  if (Object.keys(patch).length) await writeLocal(patch);
}

async function applyEnforcement({ block, redirect, fallback }) {
  const stored = await chrome.storage.session.get({ enforced: [], blockUntil: 0, rulesSig: "" });
  const rules = buildRules({ redirect, block: fallback }, BLOCKED_URL);
  const rulesSig = stableStringify(rules);
  // The rules are in place before any tab is swept (and before any message is answered).
  const rulesApplied = await step("update rules", () => syncRules(rules, rulesSig, stored.rulesSig));

  const previous = new Set(Array.isArray(stored.enforced) ? stored.enforced : []);
  const newlyRedirected = redirect.filter((domain) => !previous.has(domain));
  if (newlyRedirected.length) await step("redirect open tabs", () => redirectOpenTabs(newlyRedirected));

  // Read by the tabs.onUpdated safety net. A failed rule update keeps the old signature so the
  // next reconcile tries again.
  const next = {
    enforced: redirect,
    blockUntil: block.active ? (block.until ?? Number.MAX_SAFE_INTEGER) : 0,
    rulesSig: rulesApplied ? rulesSig : stored.rulesSig,
  };
  if (stableStringify(next) !== stableStringify(stored)) await chrome.storage.session.set(next);
}

// Dynamic rules outlive storage.session (restart, update, reload), so the saved signature only
// counts while the installed rule ids still match. One call removes both rule ids (and any stray
// id) and adds the new rules, so there is never a moment without rules.
async function syncRules(rules, rulesSig, storedSig) {
  const existingIds = (await chrome.declarativeNetRequest.getDynamicRules()).map((rule) => rule.id);
  const wantedIds = rules.map((rule) => rule.id);
  if (rulesSig === storedSig && sameIds(existingIds, wantedIds)) return true;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...new Set([BLOCK_RULE_ID, FALLBACK_RULE_ID, ...existingIds])],
    addRules: rules,
  });
  return true;
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort((a, b) => a - b);
  return [...left].sort((a, b) => a - b).every((id, index) => id === sorted[index]);
}

async function redirectOpenTabs(domains) {
  const tabs = await chrome.tabs.query({ url: originPatterns(domains) });
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id == null || tab.id === chrome.tabs.TAB_ID_NONE || !isRedirectable(tab.url, domains)) return undefined;
      return redirectTab(tab.id, tab.url);
    }),
  );
}

async function redirectTab(tabId, url) {
  try {
    await chrome.tabs.update(tabId, { url: `${BLOCKED_URL}#${url}` });
  } catch {
    // The tab was closed or navigated away in the meantime: nothing to do.
  }
}

function isBlockedPage(url) {
  return typeof url === "string" && url.startsWith(BLOCKED_URL);
}

function isRedirectable(url, domains) {
  return typeof url === "string" && WEB_URL.test(url) && !isBlockedPage(url) && blockingDomain(url, domains) !== null;
}

function blockingDomain(url, domains) {
  try {
    return findBlockingDomain(new URL(url).hostname, domains);
  } catch {
    return null;
  }
}

// Safety net for navigations the redirect rule never sees (history.pushState, back/forward
// cache, pages served by a site's service worker). changeInfo.url only shows up for hosts we
// have access to, which are exactly the redirected ones. Reads the redirect list saved by the
// last reconcile, so it stays cheap and survives worker restarts.
async function guardTab(tabId, url, tab) {
  if (isBlockedPage(tab?.url) || isBlockedPage(tab?.pendingUrl)) return;
  const [{ enforced, blockUntil }, { passes }] = await Promise.all([
    chrome.storage.session.get({ enforced: [], blockUntil: 0 }),
    chrome.storage.local.get({ passes: {} }),
  ]);
  const now = Date.now();
  if (!(blockUntil > now) || !Array.isArray(enforced)) return;
  const domain = blockingDomain(url, enforced);
  if (!domain || livePasses(passes, now)[domain]) return;
  await redirectTab(tabId, url);
}

async function updateBadge({ now, locale, block, missing }) {
  const remaining = block.until != null ? block.until - now : FAR_REMAINING_MS;
  const text = block.active ? formatBadge(remaining) : "";
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR }),
    chrome.action.setBadgeTextColor({ color: BADGE_TEXT }),
    chrome.action.setTitle({ title: badgeTitle({ locale, block, missing }) }),
  ]);
}

function badgeTitle({ locale, block, missing }) {
  const lines = [];
  if (block.active && block.until != null) {
    lines.push(t("badge_title_active", [formatClock(block.until, locale)]));
  } else {
    lines.push(t("appName"));
    if (!block.active && block.nextStart != null) {
      lines.push(t("bg_title_next", [formatWeekdayClock(block.nextStart, locale)]));
    }
  }
  if (missing.length === 1) lines.push(t("bg_title_missing_one"));
  if (missing.length > 1) lines.push(t("bg_title_missing_other", [String(missing.length)]));
  return lines.join("\n");
}

// A single alarm, re-armed at the end of every reconcile: separate alarms delay each other
// because Chrome rate-limits alarm polling per extension. The end of a suspend is a transition too.
async function updateAlarm({ now, settings, session, passes, block, suspend }) {
  const transition = nextTransition(now, { schedules: settings.schedules, session, passes, suspend });
  const when = nextAlarmTime(now, { transition, until: block.active ? block.until : null });
  const existing = await chrome.alarms.get(RECONCILE_ALARM);
  if (
    existing &&
    existing.periodInMinutes === HEARTBEAT_MINUTES &&
    Math.abs(existing.scheduledTime - when) <= ALARM_TOLERANCE_MS
  ) {
    return;
  }
  await chrome.alarms.create(RECONCILE_ALARM, { when, periodInMinutes: HEARTBEAT_MINUTES });
}

function clearLegacyAlarms() {
  for (const name of LEGACY_ALARMS) {
    chrome.alarms.clear(name).catch((error) => logError(`clear alarm ${name}`, error));
  }
}

// ---------------------------------------------------------------------------
// Messages

function stateResponse(snap) {
  return {
    ok: true,
    now: snap.now,
    block: snap.block,
    session: snap.session,
    passes: snap.passes,
    domains: snap.domains,
    granted: snap.granted,
    missing: snap.missing,
    enforced: snap.enforced,
    redirect: snap.redirect,
    fallback: snap.fallback,
    settings: snap.settings,
    stats: snap.stats,
    locale: snap.locale,
    suspend: snap.suspend,
  };
}

async function currentState() {
  return stateResponse(await readSnapshot());
}

// For pages. When a transition has passed but its alarm has not fired yet (Chrome can delay alarms
// by up to 30 s), the installed rules lag behind: reconcile first so the answer and the rules
// agree (e.g. "Continue" on the blocked page right after the block ends). Queued tasks use
// currentState() instead: waiting for a reconcile from inside the chain would deadlock.
async function getState() {
  const snap = await readSnapshot();
  const { rulesSig } = await chrome.storage.session.get({ rulesSig: "" });
  if (stableStringify(buildRules({ redirect: snap.redirect, block: snap.fallback }, BLOCKED_URL)) === rulesSig) {
    return stateResponse(snap);
  }
  await reconcile();
  return currentState();
}

async function startSession(input) {
  const minutes = parseMinutes(input);
  if (minutes === null) return fail("invalid_minutes");
  const runtime = await getRuntime();
  const now = Date.now();
  const current = activeSession(runtime.session, now);
  const session = {
    startedAt: current ? current.startedAt : now,
    endsAt: Math.max(current ? current.endsAt : 0, now + minutes * MINUTE_MS),
  };
  await writeLocal({ session });
  // The rules are updated before we answer, so the caller sees (and navigates into) the new state.
  await reconcileInline();
  return currentState();
}

async function extendSession(input) {
  const minutes = parseMinutes(input ?? EXTEND_MINUTES);
  if (minutes === null) return fail("invalid_minutes");
  const { now, session: current, block } = await readSnapshot();
  const base = Math.max(current ? current.endsAt : 0, block.active && block.until != null ? block.until : now);
  const session = { startedAt: current ? current.startedAt : now, endsAt: base + minutes * MINUTE_MS };
  await writeLocal({ session });
  await reconcileInline();
  return currentState();
}

async function grantPass(input) {
  const snap = await readSnapshot();
  const host = typeof input === "string" ? normalizeDomain(input) : null;
  const domain = host && snap.block.active ? findBlockingDomain(host, snap.enforced) : null;
  if (!domain) return fail("not_blocked");
  const expiresAt = snap.now + PASS_MINUTES * MINUTE_MS;
  await writeLocal({ passes: { ...snap.passes, [domain]: expiresAt } });
  // Rules are updated before we answer, so the page can navigate right away.
  await reconcileInline();
  return { ok: true, domain, expiresAt };
}

// Ends the active block early (SPEC 13.2): until its end, nothing blocks (see logic.js, suspend).
// A payment is confirmed with the payment server first, outside the queue: the network must not
// hold up reconciles and other messages.
async function endSession(message) {
  const method = isPlainObject(message) ? message.method : undefined;
  if (!END_METHODS.includes(method)) return fail("invalid_request");
  if (method === "paid") {
    const verdict = await checkPaidEnd(message);
    if (!verdict.ok) return verdict;
  }
  return enqueue(() => endActiveBlock(message));
}

async function endActiveBlock(message) {
  const { now, block, suspend, history, focusClock } = await readSnapshot();
  if (!block.active) return fail("not_blocked");
  const ended = endedChanges({ now, clock: focusClock, method: message.method, amount: message.amount, currency: message.currency });
  await writeLocal({
    suspend: suspendOnEnd(now, block, suspend),
    session: null,
    strict: null,
    passes: {},
    history: addToDay(history, localDayKey(now), ended),
    focusClock: { at: now, active: false },
  });
  // The rules are removed before we answer, so the page can navigate right away.
  await reconcileInline();
  return currentState();
}

function lockView(settings) {
  return { groups: settings.groups, sites: settings.sites, schedules: settings.schedules, unlock: settings.unlock };
}

async function saveSettings(patch) {
  // Raw values too: completeMigration needs to know what is actually stored.
  const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
  const settings = mergeSettings(stored, uiLocale());
  const sanitized = sanitizePatch(patch, settings);
  if (!sanitized.ok) return sanitized;
  const changes = pickChanged(sanitized.value, settings);
  if (!Object.keys(changes).length) return { ok: true };

  // The lock follows the strict snapshot too: a block kept alive by it is still a block.
  const { block } = await readSnapshot();
  const verdict = checkChange(lockView(settings), lockView({ ...settings, ...changes }), block.active);
  if (!verdict.ok) return fail(verdict.reason);

  try {
    await chrome.storage.sync.set(completeMigration(changes, stored, settings));
  } catch (error) {
    logError("saveSettings write failed", error);
    return fail("storage_error");
  }
  await reconcileInline();
  return { ok: true };
}

// Everything this device keeps at runtime: a reset clears it all.
const RUNTIME_RESET_KEYS = ["session", "passes", "strict", "suspend", "stats", "history", "focusClock"];

// Back to a fresh install: settings (removed from sync, so on every synced device too), runtime
// state and site access granted at runtime. Ends a running block unless RESET_DURING_BLOCK is off.
async function resetAll() {
  const { block } = await readSnapshot();
  if (block.active && !RESET_DURING_BLOCK) return fail("lock_reset");
  try {
    await chrome.storage.sync.remove(SETTINGS_KEYS);
  } catch (error) {
    logError("resetAll sync write failed", error);
    return fail("storage_error");
  }
  await step("reset runtime state", () => chrome.storage.local.remove(RUNTIME_RESET_KEYS));
  await step("revoke site access", revokeRuntimeOrigins);
  await reconcileInline();
  return { ok: true };
}

// Origins declared in the manifest can't be removed (test builds declare some): only runtime grants go.
async function revokeRuntimeOrigins() {
  const declared = new Set(chrome.runtime.getManifest().host_permissions ?? []);
  const { origins = [] } = await chrome.permissions.getAll();
  const granted = origins.filter((origin) => !declared.has(origin));
  if (granted.length) await chrome.permissions.remove({ origins: granted });
}

async function recordStat(kind) {
  if (!STAT_KINDS.includes(kind)) return fail("invalid_request");
  const runtime = await getRuntime();
  const dayKey = localDayKey(Date.now());
  const stats = bumpStat(runtime.stats, kind, dayKey);
  const { history } = await chrome.storage.local.get({ history: null });
  await writeLocal({ stats, history: addToDay(history, dayKey, { [kind]: 1 }) });
  return { ok: true, stats };
}

async function openOptions() {
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

async function openOnboarding() {
  const [existing] = await chrome.tabs.query({ url: `${ONBOARDING_URL}*` }).catch(() => []);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true }).catch(noop);
  } else {
    await chrome.tabs.create({ url: ONBOARDING_URL });
  }
  return { ok: true };
}

const HANDLERS = new Map([
  ["getState", () => getState()],
  ["startSession", (message) => enqueue(() => startSession(message.minutes))],
  ["extendSession", (message) => enqueue(() => extendSession(message.minutes))],
  ["grantPass", (message) => enqueue(() => grantPass(message.domain))],
  ["endSession", (message) => endSession(message)],
  ["saveSettings", (message) => enqueue(() => saveSettings(message.patch))],
  ["recordStat", (message) => enqueue(() => recordStat(message.kind))],
  ["resetAll", () => enqueue(() => resetAll())],
  ["openOptions", () => openOptions()],
  ["openOnboarding", () => openOnboarding()],
]);

function respond(sendResponse, response) {
  try {
    sendResponse(response);
  } catch {
    // The sender went away (popup closed): nobody is listening anymore.
  }
}

// ---------------------------------------------------------------------------
// Listeners (registered synchronously at top level so events wake the worker correctly)

// No defaults are written to chrome.storage.sync: on a second device the synced settings may not
// have arrived yet and would be overwritten. Defaults are merged at read time (getSettings).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.tabs.create({ url: ONBOARDING_URL }).catch((error) => logError("open onboarding", error));
  }
  setUninstallPage();
  reconcile();
});

chrome.runtime.onStartup.addListener(() => {
  setUninstallPage();
  reconcile();
});

// On uninstall, Chrome opens the feedback page ("why are you leaving?"). Only the language,
// "uninstall" and the version are in the address; the extension sends nothing itself.
function setUninstallPage() {
  const url = feedbackUrl(uiLocale(), "uninstall", chrome.runtime.getManifest().version);
  chrome.runtime.setUninstallURL(url).catch((error) => logError("uninstall page", error));
}

chrome.alarms.onAlarm.addListener(() => {
  reconcile();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" || (area === "local" && localChangeNeedsReconcile(changes, selfWrites))) {
    reconcile();
  }
});

chrome.permissions.onAdded.addListener(() => {
  reconcile();
});

chrome.permissions.onRemoved.addListener(() => {
  reconcile();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url;
  if (typeof url !== "string" || !WEB_URL.test(url)) return;
  guardTab(tabId, url, tab).catch((error) => logError("tab safety net", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const type = isPlainObject(message) ? message.type : undefined;
  const handler = HANDLERS.get(type);
  Promise.resolve()
    .then(() => (handler ? handler(message) : fail("invalid_request")))
    .then(
      (response) => respond(sendResponse, response),
      (error) => {
        logError(`message ${type} failed`, error);
        respond(sendResponse, fail("internal_error"));
      },
    );
  return true;
});

// Test hook (harmless in production): e2e tests await a full reconcile.
globalThis.__focus = { reconcile };

// The worker also starts after being re-enabled, when no install/startup event fires:
// make sure rules, badge and alarm match storage right away.
clearLegacyAlarms();
reconcile();
