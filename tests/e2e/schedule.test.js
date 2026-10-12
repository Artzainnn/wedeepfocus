// Weekly schedules (SPEC section 4 data model, section 6 reconcile). Slots are built relative
// to the current time so the suite passes at any hour, including around midnight.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_PATTERN,
  SUITE_TIMEOUT,
  hm,
  launch,
  requireExtensionFiles,
  slotAroundNow,
  waitFor,
  waitForValue,
} from "./helpers.js";

describe("schedules", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let linkedinTab;
  let linkedinUrl;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  // Replaces the schedules as if they had always been these: the strict snapshot of an earlier
  // block (SPEC 11.2, covered by strict-snapshot.test.js) would otherwise keep it running.
  async function applySchedules(schedules) {
    await ctx.setSync({ schedules });
    await ctx.clearStrict();
    return ctx.getState();
  }

  test("a disabled slot covering now does not block", { timeout: 30_000 }, async () => {
    const { slot } = slotAroundNow(Date.now(), { id: "s_off", enabled: false });
    const state = await applySchedules([slot]);
    assert.equal(state.block.active, false);
    assert.equal(await ctx.getBadge(), "");
    assert.deepEqual(await ctx.enforcedDomains(), []);

    linkedinUrl = ctx.site("linkedin.com", "/feed/?from=schedule");
    linkedinTab = await ctx.newPage();
    await ctx.gotoSite(linkedinTab, linkedinUrl);
  });

  test("an enabled slot covering now blocks linkedin.com but not example.org", { timeout: 40_000 }, async () => {
    const now = Date.now();
    const off = slotAroundNow(now, { id: "s_off", enabled: false }).slot;
    const on = slotAroundNow(now, { id: "s_on" });
    const state = await applySchedules([off, on.slot]);

    assert.equal(state.block.active, true);
    assert.equal(state.block.source, "schedule");
    assert.equal(state.block.until, on.endsAt, "the block ends when the slot ends");
    assert.ok(state.granted.includes("linkedin.com"));
    assert.ok((await ctx.enforcedDomains()).includes("linkedin.com"));
    await waitForValue(() => ctx.getBadge(), (text) => BADGE_PATTERN.test(text), { message: "the badge text" });

    // The tab opened before the block started is redirected by reconcile.
    await ctx.waitForBlocked(linkedinTab, linkedinUrl);

    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("www.linkedin.com", "/in/someone"));
    await ctx.gotoSite(page, ctx.site("example.org", "/still-open"));
    await page.close();
  });

  test("a slot on another weekday does not block and is reported as the next start", { timeout: 30_000 }, async () => {
    const other = slotAroundNow(Date.now(), { id: "s_other", dayOffset: 2 });
    const state = await applySchedules([other.slot]);

    assert.equal(state.block.active, false);
    assert.equal(state.block.nextStart, other.startsAt);
    assert.equal(await ctx.getBadge(), "");
    assert.deepEqual(await ctx.enforcedDomains(), []);

    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await page.close();
  });

  test("an overnight slot that started the previous evening still blocks", { timeout: 30_000 }, async (t) => {
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    if (minuteOfDay >= 23 * 60 + 56) {
      t.skip("too close to midnight to build an overnight slot from yesterday");
      return;
    }
    // Yesterday 23:58 to today at least one minute from now: end < start, so it crosses midnight.
    const endMinute = Math.min(minuteOfDay + 60, 23 * 60 + 57);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, endMinute);
    const slot = { id: "s_night", days: [yesterday.getDay()], start: "23:58", end: hm(end), enabled: true };

    const state = await applySchedules([slot]);
    assert.equal(state.block.active, true, `slot ${JSON.stringify(slot)} should cover now`);
    assert.equal(state.block.until, end.getTime());

    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("linkedin.com", "/messaging/"));
    await page.close();
  });

  test("without any slot nothing is blocked", { timeout: 30_000 }, async () => {
    const state = await applySchedules([]);
    assert.equal(state.block.active, false);
    assert.equal(state.block.nextStart, null);
    await waitFor(async () => (await ctx.getBadge()) === "", { message: "the badge to clear" });
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
