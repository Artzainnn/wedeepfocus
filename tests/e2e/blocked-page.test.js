// Blocked page content (SPEC 7.4, 12.7): host, live countdown, the goal, motivational line,
// stats, "Back to work" and the "not blocked anymore" state. Never a coffee link (SPEC 1).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EXT_SRC,
  MINUTE,
  SUITE_TIMEOUT,
  findRawI18nKeys,
  isShown,
  launch,
  localDayKey,
  parseCountdown,
  requireExtensionFiles,
  waitFor,
  waitForValue,
} from "./helpers.js";

const GOAL = "Ship the beta by Friday";
const GOALS = { items: [GOAL], showQuote: true };

async function loadQuotes(locale) {
  try {
    const { QUOTES } = await import(pathToFileURL(path.join(EXT_SRC, "blocked", "quotes.js")).href);
    return Array.isArray(QUOTES?.[locale]) ? QUOTES[locale] : null;
  } catch {
    return null;
  }
}

describe("blocked page", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let page;
  let blockedSiteUrl;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html", "blocked/blocked.js", "blocked/quotes.js");
    ctx = await launch();
    await ctx.setSync({ goals: GOALS });
    await ctx.startSessionDirect(25);
  });

  after(async () => {
    await ctx?.close();
  });

  test("shows the host, a live countdown, the goal and a quote", { timeout: 40_000 }, async () => {
    blockedSiteUrl = ctx.site("linkedin.com", "/feed/?from=blocked-page");
    page = await ctx.newPage();
    await ctx.gotoBlocked(page, blockedSiteUrl);
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });

    assert.match(await page.getByTestId("blocked-host").textContent(), /linkedin\.com/);

    const countdown = page.getByTestId("blocked-countdown");
    const first = (await countdown.textContent()).trim();
    const remaining = parseCountdown(first);
    assert.ok(remaining > 23 * MINUTE && remaining <= 25 * MINUTE, `countdown "${first}" should be close to 25:00`);
    await waitFor(async () => (await countdown.textContent()).trim() !== first, {
      timeout: 4_000,
      message: "the blocked page countdown to tick",
    });

    const goalsText = await page.getByTestId("blocked-goals").innerText();
    assert.ok(goalsText.includes(GOAL), `the goal is missing from: ${goalsText}`);

    const quote = page.getByTestId("blocked-quote");
    await quote.waitFor({ state: "visible" });
    const quoteText = (await quote.innerText()).trim();
    assert.ok(quoteText.length > 5, "the motivational line is not empty");
    const quotes = await loadQuotes("en");
    if (quotes) {
      const normalize = (s) => s.replace(/\s+/g, " ").trim();
      assert.ok(quotes.map(normalize).includes(normalize(quoteText)), `"${quoteText}" should come from QUOTES.en`);
    }

    assert.deepEqual(await findRawI18nKeys(page), [], "no untranslated i18n keys on the blocked page");
  });

  test("never shows a coffee link", async () => {
    const coffee = page.locator('[data-testid*="coffee"], .link-coffee, .btn-coffee');
    assert.equal(await coffee.count(), 0, "no coffee link on the blocked page");
    const label = await page.evaluate(() => chrome.i18n.getMessage("common_coffee"));
    assert.ok(!(await page.locator("body").innerText()).includes(label), `"${label}" must not show on the blocked page`);
  });

  test("records one blocked visit per page load", { timeout: 20_000 }, async () => {
    const { stats } = await waitForValue(() => ctx.getLocal("stats"), ({ stats: s }) => s?.blocked >= 1, {
      message: "stats.blocked to be incremented",
    });
    assert.equal(stats.day, localDayKey());
    assert.equal(stats.blocked, 1);
  });

  test("hides the quote when the motivational line is turned off", { timeout: 20_000 }, async () => {
    await ctx.setSync({ goals: { ...GOALS, showQuote: false } });
    await waitFor(async () => !(await isShown(page.getByTestId("blocked-quote"))), {
      message: "the quote to disappear after showQuote is turned off",
    });
    const { stats } = await ctx.getLocal("stats");
    assert.equal(stats.blocked, 1, "a re-render must not count another blocked visit");
  });

  test("without a goal it invites the user to add one", { timeout: 20_000 }, async () => {
    await ctx.setSync({ goals: { items: [""], showQuote: true } });
    const goals = page.getByTestId("blocked-goals");
    await waitFor(async () => !(await goals.innerText()).includes(GOAL), { message: "the goal to be cleared" });
    assert.ok((await goals.locator("a, button").count()) >= 1, "an empty goal block links to the settings");
    await ctx.setSync({ goals: GOALS });
    await waitFor(async () => (await goals.innerText()).includes(GOAL), { message: "the goal to come back" });
  });

  test("Back to work records a resisted attempt and leaves the blocked page", { timeout: 20_000 }, async () => {
    const resistedBefore = (await ctx.getLocal("stats")).stats?.resisted ?? 0;
    await page.getByTestId("blocked-back").click();
    // Closes the tab when the window has other tabs, otherwise opens a new tab page.
    await waitFor(() => page.isClosed() || !page.url().startsWith(ctx.blockedPageUrl), {
      message: () => `the blocked tab to close or leave the blocked page (URL: ${page.isClosed() ? "closed" : page.url()})`,
    });
    await waitForValue(() => ctx.getLocal("stats"), ({ stats }) => stats?.resisted === resistedBefore + 1, {
      message: "stats.resisted to be incremented",
    });
  });

  test("framed by a web page it shows only the static view, without the unlock flow", { timeout: 30_000 }, async () => {
    const framer = await ctx.newPage();
    await ctx.gotoSite(framer, ctx.site("example.org", "/framer"));
    await framer.evaluate(
      (src) =>
        new Promise((resolve, reject) => {
          const frame = document.createElement("iframe");
          frame.style.cssText = "width: 900px; height: 700px; border: 0";
          frame.addEventListener("load", () => resolve(), { once: true });
          frame.addEventListener("error", () => reject(new Error("the iframe failed to load")), { once: true });
          frame.src = src;
          document.body.append(frame);
        }),
      ctx.blockedUrlFor(ctx.site("linkedin.com", "/feed/?framed=1")),
    );
    const frame = framer.frameLocator("iframe");
    await frame.getByTestId("blocked-main").waitFor({ state: "visible" });
    assert.equal(await isShown(frame.getByTestId("blocked-need")), false, "no friction flow inside a frame (SPEC 11.3)");
    assert.equal(await isShown(frame.getByTestId("friction-step-1")), false);
    assert.equal(await isShown(frame.getByTestId("blocked-continue")), false);
    await framer.close();
  });

  test("once the block is over it offers to continue without redirecting on its own", { timeout: 30_000 }, async () => {
    page = await ctx.newPage();
    await ctx.gotoBlocked(page, blockedSiteUrl);
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });

    await ctx.endSessionDirect();
    const proceed = page.getByTestId("blocked-continue");
    await proceed.waitFor({ state: "visible" });
    assert.ok(page.url().startsWith(ctx.blockedPageUrl), "no automatic redirect");

    await proceed.click();
    await ctx.expectSiteLoaded(page, blockedSiteUrl);
  });

  test("a blocked page opened after the block ended shows the continue button", { timeout: 20_000 }, async () => {
    const late = await ctx.newPage();
    await late.goto(ctx.blockedUrlFor(ctx.site("facebook.com", "/watch")));
    await late.getByTestId("blocked-continue").waitFor({ state: "visible" });
    assert.equal(await isShown(late.getByTestId("blocked-main")), false);
    await late.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
