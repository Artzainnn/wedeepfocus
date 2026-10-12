// Local stats (history in chrome.storage.local): counters, focus accrual, the stats page and the
// popup streak chip. Nothing here is ever sent anywhere.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { MINUTE, SUITE_TIMEOUT, isShown, launch, localDayKey, requireExtensionFiles, waitForValue } from "./helpers.js";

describe("stats", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  const today = () => localDayKey(Date.now());
  const day = async () => (await ctx.getLocal("history")).history?.days?.[today()] ?? {};

  before(async () => {
    requireExtensionFiles("stats/stats.html", "stats/stats.js", "shared/stats.js");
    ctx = await launch();
    await ctx.setSync({ prefs: { onboarded: true } });
  });

  after(async () => {
    await ctx?.close();
  });

  test("a blocked page counts in today's history", { timeout: 30_000 }, async () => {
    await ctx.startSessionDirect(30);
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("linkedin.com", "/feed"));
    await waitForValue(day, (d) => d.blocked >= 1, { message: "history.blocked for today" });
    await page.close();
  });

  test("focus time accrues while a block runs", { timeout: 30_000 }, async () => {
    await ctx.setLocal({ focusClock: { at: Date.now() - 3 * MINUTE, active: true } });
    const before = (await day()).focusMs ?? 0;
    await ctx.reconcile();
    const after = (await day()).focusMs ?? 0;
    assert.ok(after - before >= 2.9 * MINUTE && after - before <= 3.1 * MINUTE, `about 3 min of focus, got ${after - before} ms`);
  });

  test("ending a session early counts as a free end", { timeout: 30_000 }, async () => {
    const res = await ctx.message({ type: "endSession", method: "sentence" });
    assert.equal(res.ok, true);
    assert.equal((await day()).endedFree, 1);
  });

  test("the stats page shows the streak, the day squares and today's totals", { timeout: 30_000 }, async () => {
    const yesterday = localDayKey(Date.now() - 24 * 60 * MINUTE);
    const { history } = await ctx.getLocal("history");
    history.days[yesterday] = { focusMs: 30 * MINUTE };
    await ctx.setLocal({ history });
    const page = await ctx.openExtensionPage("stats/stats.html");
    await page.locator(".page:not([aria-busy])").waitFor();
    assert.match(await page.getByTestId("stats-streak").innerText(), /2/);
    assert.ok((await page.locator(".daymap i").count()) >= 7 * 29, "one square per day over the last weeks");
    assert.match(await page.getByTestId("stats-blocked").innerText(), /[1-9]/);
    assert.match(await page.getByTestId("stats-ended").innerText(), /1/);
    await page.close();
  });

  test("the popup shows the streak chip and opens the stats page", { timeout: 30_000 }, async () => {
    const popup = await ctx.openExtensionPage("popup/popup.html");
    const chip = popup.getByTestId("popup-streak");
    await chip.waitFor({ state: "visible" });
    assert.match(await chip.innerText(), /^2\b/);
    const [statsPage] = await Promise.all([ctx.context.waitForEvent("page"), popup.getByTestId("popup-stats").click()]);
    await statsPage.waitForURL(/stats\/stats\.html/);
    assert.ok(await isShown(statsPage.getByTestId("stats-streak")));
    await statsPage.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
