// Strict snapshot (SPEC 11.2): once a block is active, removing its schedule or its sites
// through sync (another device, DevTools) can't end it early. The worker keeps a snapshot in
// chrome.storage.local and enforces the union of domains until the original end.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_PATTERN,
  SUITE_TIMEOUT,
  launch,
  requireExtensionFiles,
  slotAroundNow,
  socialOnlySettings,
  waitFor,
  waitForValue,
  withGroup,
} from "./helpers.js";

const CUSTOM = "news.ycombinator.com";
const SEED = socialOnlySettings({ custom: [CUSTOM] });

describe("strict snapshot", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let slot;
  let endsAt;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html", "blocked/blocked.js");
    ctx = await launch();
    ({ slot, endsAt } = slotAroundNow(Date.now(), { id: "s_strict", beforeMin: 30, afterMin: 90 }));
    await ctx.setSync({ ...SEED, schedules: [slot] });
    await ctx.reconcile();
  });

  after(async () => {
    await ctx?.close();
  });

  const readStrict = async () => (await ctx.getLocal("strict")).strict ?? null;

  test("an active scheduled block is recorded in chrome.storage.local", { timeout: 20_000 }, async () => {
    const state = await ctx.getState();
    assert.equal(state.block.active, true);
    assert.equal(state.block.source, "schedule");
    assert.equal(state.block.until, endsAt);

    const strict = await waitForValue(readStrict, (value) => value?.until === endsAt, {
      message: `strict.until to be the end of the slot (${endsAt})`,
    });
    for (const domain of state.domains) {
      assert.ok(strict.domains.includes(domain), `strict.domains should include ${domain}: ${JSON.stringify(strict.domains)}`);
    }
    assert.ok(strict.domains.includes(CUSTOM));
  });

  test("deleting the schedule and sites from another device keeps the block until the original end", { timeout: 40_000 }, async () => {
    // Written straight to sync from the worker, the way a change from another device arrives:
    // the slot is deleted, the custom site removed and linkedin.com taken out of the social group.
    const social = SEED.groups.find((group) => group.id === "social");
    const groups = withGroup(SEED.groups, "social", { domains: social.domains.filter((domain) => domain !== "linkedin.com") });
    await ctx.swEval((items) => chrome.storage.sync.set(items), { schedules: [], sites: { custom: [] }, groups });
    await ctx.reconcile();

    const state = await ctx.getState();
    assert.deepEqual(state.settings.schedules, [], "the synced deletion is stored");
    assert.deepEqual(state.settings.sites.custom, []);
    assert.ok(!state.settings.groups.find((group) => group.id === "social").domains.includes("linkedin.com"));
    assert.equal(state.block.active, true, "the block is still active");
    assert.equal(state.block.until, endsAt, "and still ends when the deleted slot would have ended");
    assert.ok(state.domains.includes(CUSTOM), `effective domains are the union with the snapshot: ${JSON.stringify(state.domains)}`);

    const redirected = await ctx.redirectDomains();
    assert.ok(redirected.includes("linkedin.com"), `linkedin.com stays redirected: ${JSON.stringify(redirected)}`);
    assert.ok(redirected.includes(CUSTOM), `${CUSTOM}, removed through sync, stays redirected`);
    assert.match(await ctx.getBadge(), BADGE_PATTERN);
    assert.equal((await readStrict())?.until, endsAt, "the snapshot is not shortened");

    // Still a block for the lock too: settings can't get looser through the API either.
    const res = await ctx.saveSettings({ groups: withGroup(state.settings.groups, "social", { enabled: false }) });
    assert.deepEqual(res, { ok: false, reason: "lock_group" });

    // The goals page must agree with the worker: still blocked, no "continue" button.
    for (const url of [ctx.site("linkedin.com", "/feed/?from=strict"), ctx.site(CUSTOM, "/news")]) {
      const page = await ctx.newPage();
      await ctx.gotoBlocked(page, url);
      await page.getByTestId("blocked-main").waitFor({ state: "visible" });
      await page.close();
    }
  });

  test("once the snapshot is over, the block lifts and the snapshot is cleared", { timeout: 30_000 }, async () => {
    const strict = await readStrict();
    await ctx.setLocal({ strict: { ...strict, until: Date.now() - 1_000 } });
    await ctx.reconcile();

    const state = await ctx.getState();
    assert.equal(state.block.active, false);
    await waitForValue(readStrict, (value) => value === null, { message: "the expired snapshot to be cleared" });
    await waitFor(async () => (await ctx.getRules()).length === 0, { message: "the rules to be removed" });
    assert.equal(await ctx.getBadge(), "");

    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
