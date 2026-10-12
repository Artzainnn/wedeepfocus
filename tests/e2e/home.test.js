// Home page: "No current session" with one button that starts 15 minutes, then the live countdown.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { MINUTE, SUITE_TIMEOUT, launch, requireExtensionFiles } from "./helpers.js";

describe("home page", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;

  before(async () => {
    requireExtensionFiles("home/home.html", "home/home.js", "home/home.css");
    ctx = await launch();
    await ctx.setSync({ prefs: { onboarded: true } });
  });

  after(async () => {
    await ctx?.close();
  });

  test("without a session it says so and offers 15 minutes", { timeout: 30_000 }, async () => {
    const page = await ctx.openExtensionPage("home/home.html");
    await page.locator(".page:not([aria-busy])").waitFor();
    assert.equal((await page.getByTestId("home-idle").innerText()).includes("No current session."), true);
    assert.equal(await page.getByTestId("home-start").innerText(), "Start with 15 minutes");
    assert.equal(await page.getByTestId("home-active").isVisible(), false);
    await page.close();
  });

  test("the button starts a 15 minute session and shows the countdown", { timeout: 30_000 }, async () => {
    const page = await ctx.openExtensionPage("home/home.html");
    await page.locator(".page:not([aria-busy])").waitFor();
    const clicked = Date.now();
    await page.getByTestId("home-start").click();
    await page.getByTestId("home-active").waitFor();
    assert.match(await page.locator('[data-role="countdown"]').innerText(), /^1[45]:\d\d$/);
    const { session } = await ctx.getLocal("session");
    assert.ok(Math.abs(session.endsAt - (clicked + 15 * MINUTE)) < 10_000, "session ends about 15 minutes after the click");
    await page.close();
  });

  test("home, settings and stats all link to each other", { timeout: 30_000 }, async () => {
    for (const file of ["home/home.html", "options/options.html", "stats/stats.html"]) {
      const page = await ctx.openExtensionPage(file);
      for (const id of ["nav-home", "nav-settings", "nav-stats"]) {
        assert.equal(await page.getByTestId(id).count(), 1, `${id} in ${file}`);
      }
      await page.close();
    }
  });
});
