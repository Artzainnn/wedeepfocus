// 10 minute passes (SPEC section 6 grantPass, reconcile steps 1, 4 and 6).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { MINUTE, SUITE_TIMEOUT, launch, requireExtensionFiles, waitFor, waitForValue } from "./helpers.js";

describe("passes", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let tab;
  let tabUrl;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html");
    ctx = await launch();
    await ctx.startSessionDirect(30);
  });

  after(async () => {
    await ctx?.close();
  });

  const readPasses = async () => (await ctx.getLocal("passes")).passes ?? {};

  test("grantPass refuses a site that is not blocked", async () => {
    const res = await ctx.message({ type: "grantPass", domain: "example.org" });
    assert.equal(res?.ok, false);
    assert.equal(res.reason, "not_blocked");
    assert.equal((await readPasses())["example.org"], undefined);
  });

  test("grantPass opens a blocked site for 10 minutes", { timeout: 30_000 }, async () => {
    const askedAt = Date.now();
    const res = await ctx.message({ type: "grantPass", domain: "linkedin.com" });
    assert.equal(res?.ok, true, `grantPass should succeed, got ${JSON.stringify(res)}`);
    const expiresIn = res.expiresAt - askedAt;
    assert.ok(expiresIn > 9 * MINUTE && expiresIn <= 10 * MINUTE + 5_000, `pass should last 10 min, got ${expiresIn} ms`);
    assert.equal((await readPasses())["linkedin.com"], res.expiresAt);

    const enforced = await ctx.enforcedDomains();
    assert.ok(!enforced.includes("linkedin.com"), "linkedin.com is no longer redirected");
    assert.ok(enforced.includes("facebook.com"), "other sites stay blocked");

    tabUrl = ctx.site("linkedin.com", "/feed/?from=pass");
    tab = await ctx.newPage();
    await ctx.gotoSite(tab, tabUrl);
  });

  test("an expired pass re-blocks the site and redirects the open tab", { timeout: 30_000 }, async () => {
    await ctx.setLocal({ passes: { "linkedin.com": Date.now() - 1_000 } });
    await ctx.reconcile();
    await ctx.waitForBlocked(tab, tabUrl);
    assert.ok((await ctx.enforcedDomains()).includes("linkedin.com"));
    await waitForValue(readPasses, (passes) => !("linkedin.com" in passes), {
      message: "reconcile to drop the expired pass from storage",
    });
  });

  test("a pass expiring while the tab is open re-blocks it without any user action", { timeout: 90_000 }, async () => {
    // Relies on the reconcile alarm armed at the pass expiry (Chrome may delay it up to about 30 s).
    const res = await ctx.message({ type: "grantPass", domain: "linkedin.com" });
    assert.equal(res?.ok, true);
    const page = await ctx.newPage();
    const url = ctx.site("linkedin.com", "/notifications/");
    await ctx.gotoSite(page, url);

    await ctx.setLocal({ passes: { "linkedin.com": Date.now() + 3_000 } });
    await ctx.waitForBlocked(page, url, { timeout: 75_000 });
    await waitFor(async () => (await ctx.enforcedDomains()).includes("linkedin.com"), {
      message: "linkedin.com to be enforced again",
    });
    await page.close();
  });

  test("the tabs.onUpdated safety net catches a same-page navigation the rule never sees", { timeout: 30_000 }, async () => {
    // SPEC 11.1: history.pushState, back/forward cache and service-worker-served pages skip the
    // redirect rule. A linkedin.com page opened during a pass stands in for such a page.
    const res = await ctx.message({ type: "grantPass", domain: "linkedin.com" });
    assert.equal(res?.ok, true);
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/?from=spa"));

    // The pass ends, but the worker is told the tab sweep already covered linkedin.com, so only
    // the safety net (reading the redirect list from storage.session) can catch the tab.
    await ctx.swEval(async () => {
      const { enforced } = await chrome.storage.session.get({ enforced: [] });
      await chrome.storage.session.set({ enforced: [...enforced, "linkedin.com"] });
    });
    await ctx.setLocal({ passes: {} });
    await ctx.reconcile();

    const nextUrl = ctx.site("linkedin.com", "/feed/next");
    await page.evaluate(() => history.pushState({}, "", "/feed/next"));
    await ctx.waitForBlocked(page, nextUrl);
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
