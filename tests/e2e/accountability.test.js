// Ending a session early (SPEC 13): money mode with a Stripe-verified payment (fake payment server
// from fixture-server.js), "Skip for free" always available, free-only mode, the popup's
// "End session early" link, and the settings section. The whole session ends either way.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SUITE_TIMEOUT, isDisabled, isSelected, isShown, launch, requireExtensionFiles, waitFor, waitForValue } from "./helpers.js";

describe("ending a session early", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let payments;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html", "blocked/blocked.js", "shared/payment.js");
    ctx = await launch();
    payments = ctx.server.payments;
    await ctx.setSync({ prefs: { onboarded: true }, goals: { items: ["Ship V4"], showQuote: false } });
  });

  after(async () => {
    await ctx?.close();
  });

  const money = (amount = 5) => ctx.setSync({ unlock: { phrase: "", mode: "money", amount } });
  const freeOnly = () => ctx.setSync({ unlock: { phrase: "", mode: "free", amount: 5 } });

  // A fresh block: no suspend left by a previous test, then a new manual session.
  async function freshSession() {
    await ctx.setLocal({ suspend: null });
    await ctx.startSessionDirect(30);
    assert.equal((await ctx.getState()).block.active, true);
  }

  async function openPayStep(url = ctx.site("linkedin.com", "/feed")) {
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, url);
    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-pay").waitFor({ state: "visible" });
    return page;
  }

  test("money mode: the pay step shows the stored amount, the presets and a visible Skip for free", { timeout: 30_000 }, async () => {
    await money(10);
    await freshSession();
    const page = await openPayStep();
    for (const amount of [2, 5, 10, 20]) {
      assert.equal(await isSelected(page.getByTestId(`friction-amount-${amount}`)), amount === 10, `friction-amount-${amount}`);
    }
    assert.match(await page.getByTestId("friction-pay").innerText(), /10/);
    assert.ok(await isShown(page.getByTestId("friction-skip")), "Skip for free is never hidden");
    await page.getByTestId("friction-amount-2").click();
    await waitFor(async () => /2/.test(await page.getByTestId("friction-pay").innerText()), { message: "the pay button to show 2" });
    await page.close();
  });

  test("paying: Stripe opens, the page waits, and the session ends only once the payment is verified", { timeout: 60_000 }, async () => {
    await money(5);
    await freshSession();
    const page = await openPayStep();
    await page.getByTestId("friction-amount-20").click();
    const [stripeTab] = await Promise.all([ctx.context.waitForEvent("page"), page.getByTestId("friction-pay").click()]);
    assert.match(stripeTab.url(), /^http:\/\/pay\.test:\d+\/checkout\/cs_test_/);
    await page.getByTestId("friction-step-waiting").waitFor({ state: "visible" });
    const session = payments.last();
    assert.equal(session.amount, 20, "the Checkout Session is for the chosen amount");
    assert.match(session.token, /^[a-f0-9]{32}$/);

    // Not paid yet: polling keeps the session running.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    assert.equal((await ctx.getState()).block.active, true, "no payment, no early end");

    payments.pay(session.id);
    await page.getByTestId("friction-ended").waitFor({ state: "visible", timeout: 15_000 });
    const state = await ctx.getState();
    assert.equal(state.block.active, false);
    assert.deepEqual(await ctx.getRules(), []);
    await stripeTab.close();
    await page.close();
  });

  test("the background refuses a paid end that the payment server doesn't confirm", async () => {
    await freshSession();
    const fake = { method: "paid", sessionId: "cs_test_forged", token: "a".repeat(32) };
    const res = await ctx.message({ type: "endSession", ...fake });
    assert.deepEqual(res, { ok: false, reason: "payment_not_verified" });
    assert.equal((await ctx.getState()).block.active, true, "the session keeps running");
  });

  test("an unreachable payment server shows an error, and Skip for free still ends the session", { timeout: 60_000 }, async () => {
    await money(5);
    await freshSession();
    payments.unavailable = true;
    try {
      const page = await openPayStep();
      await page.getByTestId("friction-pay").click();
      await page.getByTestId("friction-pay-error").waitFor({ state: "visible" });
      await page.getByTestId("friction-skip").click();
      await page.getByTestId("friction-step-2").waitFor({ state: "visible" });
      const phrase = await page.getByTestId("friction-phrase").innerText();
      await page.getByTestId("friction-input").pressSequentially(phrase.trim(), { delay: 2 });
      const unlock = page.getByTestId("friction-unlock");
      await waitFor(async () => !(await isDisabled(unlock)), { message: "the end button to be enabled" });
      await unlock.click();
      await page.getByTestId("friction-ended").waitFor({ state: "visible" });
      assert.equal((await ctx.getState()).block.active, false);
      await page.close();
    } finally {
      payments.unavailable = false;
    }
  });

  test("free only: no pay step, the question leads straight to the sentence", { timeout: 30_000 }, async () => {
    await freeOnly();
    await freshSession();
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("facebook.com", "/"));
    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("friction-step-pay")), false, "no payment option in free-only mode");
    await page.close();
  });

  test("the popup's End session early opens the ritual without a blocked site", { timeout: 30_000 }, async () => {
    await freeOnly();
    await freshSession();
    const popup = await ctx.openExtensionPage("popup/popup.html");
    const link = popup.getByTestId("popup-end-session");
    await link.waitFor({ state: "visible" });
    const [endPage] = await Promise.all([ctx.context.waitForEvent("page"), link.click()]);
    await endPage.waitForURL(/blocked\/blocked\.html\?end=1/);
    await endPage.getByTestId("friction-step-1").waitFor({ state: "visible" });
    assert.equal(await isShown(endPage.getByTestId("blocked-main")), false);
    await endPage.close();
    if (!popup.isClosed()) await popup.close();
  });

  test("the end page without a running session says there is nothing to end", { timeout: 30_000 }, async () => {
    await ctx.endSessionDirect();
    await ctx.setLocal({ suspend: null });
    const page = await ctx.openExtensionPage("blocked/blocked.html?end=1");
    await page.getByTestId("blocked-free").waitFor({ state: "visible" });
    assert.ok(await isShown(page.getByTestId("friction-close")));
    await page.close();
  });

  test("settings: mode and amount save, stay editable during a block, the sentence stays locked", { timeout: 60_000 }, async () => {
    await freeOnly();
    await freshSession();
    const options = await ctx.openExtensionPage("options/options.html");
    await options.locator('.page[aria-busy="false"]').waitFor();
    await options.getByTestId("ending-mode-money").click();
    await options.getByTestId("ending-amount-20").click();
    const { unlock } = await waitForValue(() => ctx.getSync("unlock"), ({ unlock: u }) => u?.mode === "money" && u?.amount === 20, {
      message: "money mode with 20 saved during the block",
    });
    assert.equal(unlock.phrase, "");
    assert.equal(await isDisabled(options.getByTestId("phrase-input")), true, "the sentence stays locked during a block");
    const refused = await ctx.saveSettings({ unlock: { phrase: "A brand new sentence that is long enough to be valid.", mode: "money", amount: 20 } });
    assert.deepEqual(refused, { ok: false, reason: "lock_phrase" });
    await options.close();
  });

  test("no errors in extension pages (the simulated 502 above is expected)", () => {
    const unexpected = ctx.extensionErrors().filter((entry) => !/status of 502/.test(JSON.stringify(entry)));
    assert.deepEqual(unexpected, []);
  });
});
