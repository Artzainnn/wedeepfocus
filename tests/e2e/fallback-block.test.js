// Fallback block (SPEC 11.1): with host access for linkedin.com only, linkedin.com is still
// redirected to the goals page (rule 1) while facebook.com, enforced without permission, is
// blocked by rule 2 and ends on Chrome's own error page without ever being reached.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_RULE_ID,
  REDIRECT_RULE_ID,
  SUITE_TIMEOUT,
  launch,
  pageCopy,
  readSourceManifest,
  requireExtensionFiles,
  socialOnlySettings,
  sorted,
} from "./helpers.js";

const HOST_PERMISSIONS = ["*://*.linkedin.com/*"];
// Copy about sites without permission must say they are blocked (with Chrome's error page),
// never that they are not blocked.
const NOT_BLOCKED_COPY = /(?:\bnot|n't|cannot) (?:be |get )?blocked|before (?:it|they) can be blocked/i;

describe("fallback block without host permission", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html", "popup/popup.html", "options/options.html");
    ctx = await launch({ hostPermissions: HOST_PERMISSIONS });
    await ctx.setSync(socialOnlySettings());
    await ctx.reconcile();
  });

  after(async () => {
    await ctx?.close();
  });

  test("the manifest uses declarativeNetRequest, so block rules work without host access", () => {
    const { permissions = [] } = readSourceManifest();
    assert.ok(permissions.includes("declarativeNetRequest"), `permissions: ${JSON.stringify(permissions)}`);
    assert.ok(
      !permissions.includes("declarativeNetRequestWithHostAccess"),
      "declarativeNetRequestWithHostAccess would require host access for block rules too",
    );
  });

  test("only linkedin.com is granted, the other social sites are reported as missing", async () => {
    const origins = (await ctx.swEval(() => chrome.permissions.getAll())).origins ?? [];
    assert.deepEqual(origins, HOST_PERMISSIONS, "the launch variant grants linkedin.com only");
    const state = await ctx.getState();
    assert.deepEqual(state.granted, ["linkedin.com"]);
    assert.ok(state.missing.includes("facebook.com"), `facebook.com should be missing: ${JSON.stringify(state.missing)}`);
    assert.ok(!state.missing.includes("linkedin.com"));
    assert.deepEqual(sorted([...state.granted, ...state.missing]), sorted(state.domains));
    assert.deepEqual(await ctx.getRules(), [], "no rules while idle");
  });

  test("a session installs a redirect rule for granted sites and a block rule for the others", { timeout: 20_000 }, async () => {
    const res = await ctx.message({ type: "startSession", minutes: 20 });
    assert.equal(res?.ok, true, `startSession should succeed, got ${JSON.stringify(res)}`);
    assert.equal(res.block?.active, true);

    const rules = await ctx.getRules();
    assert.deepEqual(sorted(rules.map((rule) => rule.id)), [REDIRECT_RULE_ID, FALLBACK_RULE_ID], JSON.stringify(rules));

    const redirect = rules.find((rule) => rule.id === REDIRECT_RULE_ID);
    assert.equal(redirect.action.type, "redirect");
    assert.equal(redirect.action.redirect?.regexSubstitution, `${ctx.blockedPageUrl}#\\0`);
    assert.deepEqual(redirect.condition.requestDomains, ["linkedin.com"]);
    assert.deepEqual(redirect.condition.resourceTypes, ["main_frame"]);

    const fallback = rules.find((rule) => rule.id === FALLBACK_RULE_ID);
    assert.equal(fallback.action.type, "block");
    assert.deepEqual(fallback.condition.resourceTypes, ["main_frame"]);
    const blocked = fallback.condition.requestDomains;
    assert.ok(blocked.includes("facebook.com"), `rule 2 should block facebook.com: ${JSON.stringify(blocked)}`);
    assert.ok(!blocked.includes("linkedin.com"), "linkedin.com is redirected, not blocked");
    assert.deepEqual(sorted(blocked), sorted(res.missing), "every enforced site without permission is blocked");
  });

  test("facebook.com ends on Chrome's error page and is never reached", { timeout: 30_000 }, async () => {
    for (const url of [ctx.site("facebook.com", "/"), ctx.site("www.facebook.com", "/groups/42?from=fallback")]) {
      const page = await ctx.newPage();
      await ctx.gotoFallbackBlocked(page, url);
      await page.close();
    }
  });

  test("linkedin.com still lands on the goals page", { timeout: 30_000 }, async () => {
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("linkedin.com", "/feed/?from=fallback"));
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });
    await ctx.gotoBlocked(page, ctx.site("www.linkedin.com", "/in/someone"));
    await page.close();
  });

  test("the popup and options offer to allow access without saying the sites are not blocked", { timeout: 30_000 }, async () => {
    const popup = await ctx.openExtensionPage("popup/popup.html");
    await popup.getByTestId("popup-grant-missing").waitFor({ state: "visible" });
    for (const text of await pageCopy(popup)) assert.doesNotMatch(text, NOT_BLOCKED_COPY, "popup copy");
    await popup.close();

    const options = await ctx.openOptions();
    await options.getByTestId("options-grant-missing").waitFor({ state: "visible" });
    for (const text of await pageCopy(options)) assert.doesNotMatch(text, NOT_BLOCKED_COPY, "options copy");
    await options.close();
  });

  test("when the session ends, facebook.com loads again", { timeout: 30_000 }, async () => {
    await ctx.endSessionDirect();
    assert.deepEqual(await ctx.getRules(), [], "both rules are removed");
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("facebook.com", "/"));
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
