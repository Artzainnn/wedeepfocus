// Manual session started from the popup (SPEC 7.1, section 6 startSession / extendSession).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_PATTERN,
  COFFEE_LABEL,
  MINUTE,
  RECONCILE_ALARM,
  REDIRECT_RULE_ID,
  SUITE_TIMEOUT,
  findRawI18nKeys,
  isShown,
  launch,
  normalizeCopy,
  parseCountdown,
  requireExtensionFiles,
  sorted,
  waitFor,
  waitForValue,
} from "./helpers.js";

const HEARTBEAT_MINUTES = 5;

// SPEC 11.2: a single alarm (separate alarms delay each other under Chrome's rate limit).
async function onlyReconcileAlarm(ctx) {
  const alarms = await ctx.alarms();
  assert.deepEqual(
    alarms.map((alarm) => alarm.name),
    [RECONCILE_ALARM],
    `expected only the "${RECONCILE_ALARM}" alarm, got ${JSON.stringify(alarms)}`,
  );
  assert.equal(alarms[0].periodInMinutes, HEARTBEAT_MINUTES, "the alarm doubles as a 5 minute heartbeat");
  return alarms[0];
}

describe("popup session", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let popup;
  let openLinkedin;
  let openLinkedinUrl;

  before(async () => {
    requireExtensionFiles("popup/popup.html", "popup/popup.js", "blocked/blocked.html", "blocked/blocked.js");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  const readSession = async () => (await ctx.getLocal("session")).session ?? null;

  test("nothing is blocked before a session starts", { timeout: 30_000 }, async () => {
    openLinkedinUrl = ctx.site("linkedin.com", "/feed/?trk=e2e");
    openLinkedin = await ctx.newPage();
    await ctx.gotoSite(openLinkedin, openLinkedinUrl);
    assert.equal(await ctx.getBadge(), "");
    assert.deepEqual(await ctx.getRules(), []);
  });

  test("while idle the reconcile alarm is only a heartbeat", async () => {
    await ctx.reconcile();
    const alarm = await onlyReconcileAlarm(ctx);
    const inMs = alarm.scheduledTime - Date.now();
    assert.ok(inMs <= HEARTBEAT_MINUTES * MINUTE + 1_000, `next reconcile within 5 min, got ${inMs} ms`);
  });

  test("the idle popup offers quick start and validates custom minutes", { timeout: 30_000 }, async () => {
    popup = await ctx.openExtensionPage("popup/popup.html");
    await popup.getByTestId("popup-status").waitFor({ state: "visible" });
    await popup.getByTestId("popup-start-15").waitFor({ state: "visible" });
    assert.equal(await isShown(popup.getByTestId("popup-countdown")), false, "no countdown while idle");
    assert.deepEqual(await findRawI18nKeys(popup), [], "no untranslated i18n keys in the popup");

    // SPEC 12.6 and 12.8: an orange text link with the new label.
    const coffee = popup.getByTestId("popup-coffee");
    await coffee.waitFor({ state: "visible" });
    assert.equal(normalizeCopy(await coffee.innerText()), COFFEE_LABEL.en);
    assert.ok(await coffee.evaluate((el) => el.classList.contains("link-coffee")), "popup-coffee uses .link-coffee");

    await popup.getByTestId("popup-start-other").click();
    const minutes = popup.getByTestId("popup-custom-minutes");
    await minutes.waitFor({ state: "visible" });
    for (const invalid of ["0", "481"]) {
      await minutes.fill(invalid);
      await popup.getByTestId("popup-custom-start").click();
      await popup.getByTestId("popup-custom-error").waitFor({ state: "visible" });
      assert.equal(await readSession(), null, `${invalid} minutes must not start a session`);
    }
  });

  test("startSession rejects invalid durations", async () => {
    for (const minutes of [0, -5, 481, 2.5]) {
      const res = await ctx.message({ type: "startSession", minutes });
      assert.equal(res?.ok, false, `startSession(${JSON.stringify(minutes)}) should be refused`);
      assert.equal(res.reason, "invalid_minutes");
    }
    assert.equal(await readSession(), null);
  });

  test("starting 15 minutes from the popup shows a live countdown", { timeout: 30_000 }, async () => {
    const clickedAt = Date.now();
    await popup.getByTestId("popup-start-15").click();
    const session = await waitForValue(readSession, (s) => Boolean(s?.endsAt), { message: "a session in storage" });
    const length = session.endsAt - clickedAt;
    assert.ok(length > 14.5 * MINUTE && length <= 15 * MINUTE + 5_000, `session should last about 15 min, got ${length} ms`);

    const countdown = popup.getByTestId("popup-countdown");
    await countdown.waitFor({ state: "visible" });
    const first = (await countdown.textContent()).trim();
    const remaining = parseCountdown(first);
    assert.ok(remaining > 14 * MINUTE && remaining <= 15 * MINUTE, `countdown "${first}" should be close to 15:00`);
    await waitFor(async () => (await countdown.textContent()).trim() !== first, {
      timeout: 4_000,
      message: "the popup countdown to tick",
    });
    await popup.getByTestId("popup-extend").waitFor({ state: "visible" });
    assert.equal(await isShown(popup.getByTestId("popup-start-15")), false, "quick start is hidden while active");
  });

  test("the badge shows the remaining time", { timeout: 20_000 }, async () => {
    const badge = await waitForValue(() => ctx.getBadge(), (text) => BADGE_PATTERN.test(text), { message: "the badge text" });
    assert.match(badge, /^(15|14)m$/);
  });

  test("the reconcile alarm is re-armed for the next badge change", async () => {
    await ctx.reconcile();
    const alarm = await onlyReconcileAlarm(ctx);
    // The badge counts minutes, so it changes at most a minute from now.
    const inMs = alarm.scheduledTime - Date.now();
    assert.ok(inMs <= MINUTE + 1_000, `next reconcile at the next badge change (within a minute), got ${inMs} ms`);
  });

  test("the linkedin tab that was already open gets redirected", { timeout: 20_000 }, async () => {
    await ctx.waitForBlocked(openLinkedin, openLinkedinUrl);
  });

  test("with host access every blocked site is redirected, no fallback rule", async () => {
    const rules = await ctx.getRules();
    assert.deepEqual(
      rules.map((rule) => [rule.id, rule.action?.type]),
      [[REDIRECT_RULE_ID, "redirect"]],
      `expected only the redirect rule, got ${JSON.stringify(rules)}`,
    );
    const { domains } = await ctx.getState();
    assert.deepEqual(sorted(await ctx.redirectDomains()), sorted(domains));
  });

  test("new navigations to linkedin.com, its subdomains and facebook.com are redirected", { timeout: 40_000 }, async () => {
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("linkedin.com", "/in/someone?utm_source=e2e&x=1"));
    await ctx.gotoBlocked(page, ctx.site("www.linkedin.com", "/feed/"));
    await ctx.gotoBlocked(page, ctx.site("facebook.com", "/groups/42"));
    await page.close();
  });

  test("example.org is not blocked", { timeout: 20_000 }, async () => {
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("example.org", "/hello?x=1"));
    await page.close();
  });

  test("Add 10 min extends the session by ten minutes", { timeout: 30_000 }, async () => {
    const before = await readSession();
    await popup.getByTestId("popup-extend").click();
    const after = await waitForValue(readSession, (s) => s && s.endsAt > before.endsAt, { message: "the session to be extended" });
    const added = after.endsAt - before.endsAt;
    assert.ok(Math.abs(added - 10 * MINUTE) < 5_000, `expected +10 min, got +${added} ms`);
    assert.equal(after.startedAt, before.startedAt, "extending keeps the original start");
    const countdown = popup.getByTestId("popup-countdown");
    await waitFor(async () => parseCountdown(await countdown.textContent()) > 18 * MINUTE, {
      message: "the popup countdown to show about 20 minutes",
    });
  });

  test("the block lifts on its own when the session ends", { timeout: 60_000 }, async () => {
    // The reconcile alarm must fire at session end without any user action. The session is
    // shortened in storage, so its strict snapshot (SPEC 11.2) is dropped too: otherwise it
    // rightly keeps the block until the original end.
    await ctx.reconcile();
    const now = Date.now();
    await ctx.setLocal({ session: { startedAt: now - 20 * MINUTE, endsAt: now + 3_000 }, strict: null });
    await waitFor(async () => (await ctx.getBadge()) === "", { timeout: 50_000, interval: 250, message: "the badge to clear" });
    await waitFor(async () => (await ctx.getRules()).length === 0, { message: "the rules to be removed" });
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await popup.getByTestId("popup-start-15").waitFor({ state: "visible" });
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
