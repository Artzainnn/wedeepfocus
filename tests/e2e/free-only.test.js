// First release build (ACCOUNTABILITY_ENABLED = false): free only, no payment step anywhere.
// The other suites run with the flag on to keep the payment flow covered for later.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SUITE_TIMEOUT, isShown, launch, waitFor, waitForValue } from "./helpers.js";

describe("free only release", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;

  before(async () => {
    ctx = await launch({ accountability: false });
  });

  after(async () => {
    await ctx?.close();
  });

  test("onboarding has 3 steps and finishes on the goal step as free only", { timeout: 60_000 }, async () => {
    const url = ctx.extUrl("onboarding/onboarding.html");
    const page = await waitFor(() => ctx.findPage((p) => p.url().startsWith(url)), { timeout: 15_000, message: "the onboarding tab" });
    await page.getByTestId("onb-step-1").waitFor({ state: "visible" });
    assert.equal(await page.locator(".onb-dot").count(), 3, "three step dots");
    const next = () => page.locator('[data-testid="onb-next"]:visible').first();
    await next().click();
    await page.getByTestId("onb-step-2").waitFor({ state: "visible" });
    assert.equal((await page.getByTestId("onb-strict").innerText()).trim(), "To end early: type a sentence.");
    await next().click();
    await page.getByTestId("onb-step-3").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("onb-next")), false, "no Continue on the last step");
    await page.getByTestId("onb-finish").click();
    await page.getByTestId("onb-done").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("onb-step-4")), false, "the money step never shows");
    await waitForValue(() => ctx.getSync("prefs"), ({ prefs }) => prefs?.onboarded === true, { message: "prefs.onboarded saved" });
    const { settings } = await ctx.getState();
    assert.equal(settings.unlock.mode, "free");
    await page.close();
  });

  test("settings keep the sentence but offer no money option", { timeout: 30_000 }, async () => {
    const page = await ctx.openExtensionPage("options/options.html");
    await page.getByTestId("phrase-input").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("ending-mode-money")), false);
    assert.equal(await isShown(page.getByTestId("ending-mode-free")), false);
    await page.close();
  });

  test("ending a session goes straight from the question to the sentence, even with money stored", { timeout: 30_000 }, async () => {
    await ctx.setSync({ unlock: { phrase: "", mode: "money", amount: 5 } });
    await ctx.startSessionDirect(30);
    const page = await ctx.openExtensionPage("blocked/blocked.html?end=1");
    await page.getByTestId("friction-step-1").waitFor({ state: "visible" });
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("friction-step-pay")), false, "no payment step");
    await page.close();
  });

  test("stats show no money card", { timeout: 30_000 }, async () => {
    const page = await ctx.openExtensionPage("stats/stats.html");
    await page.locator(".page:not([aria-busy])").waitFor();
    assert.equal(await isShown(page.getByTestId("stats-paid")), false);
    assert.equal((await page.getByTestId("stats-ended").innerText()).includes("paid"), false);
    await page.close();
  });
});
