// Onboarding (SPEC 12.4, 13.6): opens on install, 4 short steps and a done screen. Step 1 picks
// groups (a site can be left out of a group) and custom sites, step 2 defaults to manual
// sessions (no schedule), step 3 takes one goal, step 4 chooses how a session can be ended early
// (accountability with money, preselected at 5, or free only). Install writes nothing to sync (11.2).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_PATTERN,
  COFFEE_LABEL,
  MINUTE,
  PRESET_IDS,
  SETTINGS_KEYS,
  SUITE_TIMEOUT,
  assertDefaultGroups,
  findRawI18nKeys,
  isSelected,
  isShown,
  launch,
  normalizeCopy,
  requireExtensionFiles,
  waitFor,
  waitForValue,
} from "./helpers.js";

const CUSTOM = "news.ycombinator.com";
const GOAL = "Ship the beta by Friday";
const PRIVACY_LINE = "Stays in your browser. Nothing is sent anywhere.";
const STRICT_LINE = "To end early: pay what you chose, or type a sentence.";

describe("onboarding", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let page;

  before(async () => {
    requireExtensionFiles("onboarding/onboarding.html", "onboarding/onboarding.js");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  // Continue button of the visible step (steps 1 and 2 both use data-testid="onb-next").
  const visibleNext = () => page.locator('[data-testid="onb-next"]:visible').first();
  const visibleBack = () => page.locator('[data-testid="onb-back"]:visible').first();
  const pageText = async () => normalizeCopy(await page.locator("body").innerText());
  const storedGroups = async () => (await ctx.getSync("groups")).groups ?? null;

  test("opens on install", { timeout: 30_000 }, async () => {
    const onboardingUrl = ctx.extUrl("onboarding/onboarding.html");
    page = await waitFor(() => ctx.findPage((p) => p.url().startsWith(onboardingUrl)), {
      timeout: 15_000,
      message: "the onboarding tab to open after install",
    });
    await page.getByTestId("onb-step-1").waitFor({ state: "visible" });
    await page.getByTestId("onb-step-indicator").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("onb-back")), false, "no back button on step 1");
    assert.deepEqual(await findRawI18nKeys(page), [], "no untranslated i18n keys on step 1");
  });

  test("install leaves chrome.storage.sync untouched and defaults are merged at read time", async () => {
    // Queued after the install handler (which opened the tab above), so its writes are done.
    await ctx.reconcile();
    const stored = await ctx.getSync(null);
    const written = SETTINGS_KEYS.filter((key) => key in stored);
    // On a second device, writing defaults would overwrite settings that haven't synced yet.
    assert.deepEqual(written, [], `install must not write settings to chrome.storage.sync, found ${JSON.stringify(stored)}`);

    const { settings } = await ctx.getState();
    await assertDefaultGroups(settings.groups, "en");
    assert.deepEqual(settings.sites.custom, []);
    assert.deepEqual(settings.schedules, []);
    assert.deepEqual(settings.goals, { items: [""], showQuote: true }, "one empty goal (GOAL_COUNT = 1)");
    assert.equal(settings.prefs.onboarded, false);
    assert.deepEqual(settings.unlock, { phrase: "", mode: "free", amount: 5 }, "defaults: default sentence, free mode, 5");
  });

  test("step 1 shows the preset groups, social preselected, and one privacy line", async () => {
    for (const id of PRESET_IDS) {
      const card = page.getByTestId(`onb-category-${id}`);
      await card.waitFor({ state: "visible" });
      assert.equal(await isSelected(card), id === "social", `onb-category-${id} selected state`);
    }
    assert.ok((await pageText()).includes(PRIVACY_LINE), `step 1 says "${PRIVACY_LINE}"`);
  });

  test("a site can be left out of a selected group, and custom sites are added", { timeout: 30_000 }, async () => {
    await page.getByTestId("onb-category-video").click();
    await waitFor(() => isSelected(page.getByTestId("onb-category-video")), { message: "the video card to be selected" });

    await page.getByTestId("onb-edit-social").click();
    const chip = page.getByTestId("onb-site-social-linkedin.com");
    await chip.waitFor({ state: "visible" });
    assert.equal(await isSelected(page.getByTestId("onb-category-social")), true, "Edit does not unselect the card");
    const isOff = () => chip.evaluate((el) => el.classList.contains("is-off"));
    assert.equal(await isOff(), false, "sites start included");
    await chip.click();
    await waitFor(isOff, { message: "linkedin.com to be left out (.is-off)" });
    await chip.click();
    await waitFor(async () => !(await isOff()), { message: "a second click to include linkedin.com again" });
    await chip.click();
    await waitFor(isOff, { message: "linkedin.com to be left out again" });

    await page.getByTestId("onb-custom-input").fill(CUSTOM);
    await page.getByTestId("onb-custom-add").click();
    await page.getByTestId(`onb-custom-remove-${CUSTOM}`).waitFor({ state: "visible" });
  });

  test("Continue saves the 5 groups with their flags and remaining sites, and the custom sites", { timeout: 30_000 }, async () => {
    await visibleNext().click();
    await page.getByTestId("onb-step-2").waitFor({ state: "visible" });

    const groups = await waitForValue(storedGroups, (list) => Array.isArray(list) && list.length === PRESET_IDS.length, {
      message: "the 5 groups saved by step 1",
    });
    assert.deepEqual(groups.map((group) => group.id), PRESET_IDS);
    const enabled = Object.fromEntries(groups.map((group) => [group.id, group.enabled]));
    assert.deepEqual(enabled, { social: true, video: true, messaging: false, news: false, shopping: false });
    for (const group of groups) assert.equal(group.preset, group.id);
    const social = groups.find((group) => group.id === "social");
    assert.ok(!social.domains.includes("linkedin.com"), "linkedin.com was left out of the social group");
    assert.ok(social.domains.includes("facebook.com"), "the other social sites stay");
    assert.ok(groups.find((group) => group.id === "video").domains.includes("youtube.com"));

    const { sites } = await ctx.getSync("sites");
    assert.deepEqual(sites.custom, [CUSTOM]);
  });

  test("step 2 defaults to manual sessions and hides the slot editor", async () => {
    assert.equal(await isSelected(page.getByTestId("onb-when-manual")), true, "When I start a session is the default");
    assert.equal(await isSelected(page.getByTestId("onb-when-schedule")), false);
    assert.equal(await isShown(page.getByTestId("onb-day-1")), false, "no slot editor in manual mode");
    assert.ok((await pageText()).includes(STRICT_LINE), `step 2 says "${STRICT_LINE}"`);
    assert.ok(await isShown(page.getByTestId("onb-back")), "step 2 has a back button");
  });

  test("On a schedule reveals the weekday slot, manual hides it again", async () => {
    await page.getByTestId("onb-when-schedule").click();
    await page.getByTestId("onb-slot-start").waitFor({ state: "visible" });
    for (let day = 0; day <= 6; day += 1) {
      assert.equal(await isSelected(page.getByTestId(`onb-day-${day}`)), day >= 1 && day <= 5, `onb-day-${day}`);
    }
    assert.equal(await page.getByTestId("onb-slot-start").inputValue(), "09:00");
    assert.equal(await page.getByTestId("onb-slot-end").inputValue(), "12:00");

    await page.getByTestId("onb-when-manual").click();
    await waitFor(async () => !(await isShown(page.getByTestId("onb-slot-start"))), { message: "the slot editor to hide" });
  });

  test("Continue in manual mode saves no schedule", { timeout: 30_000 }, async () => {
    await visibleNext().click();
    await page.getByTestId("onb-step-3").waitFor({ state: "visible" });
    const { settings } = await ctx.getState();
    assert.deepEqual(settings.schedules, [], "manual mode saves schedules: []");
  });

  test("going back to choose a schedule saves the edited slot", { timeout: 30_000 }, async () => {
    await visibleBack().click();
    await page.getByTestId("onb-step-2").waitFor({ state: "visible" });
    await page.getByTestId("onb-when-schedule").click();
    // Turn today off (Friday on weekends) so the slot never starts a real block while the suite
    // runs: a running block would lock the slot and the next test could not remove it.
    const today = new Date().getDay();
    const offDay = today >= 1 && today <= 5 ? today : 5;
    await page.getByTestId(`onb-day-${offDay}`).click();
    await waitFor(async () => !(await isSelected(page.getByTestId(`onb-day-${offDay}`))), { message: "the day to be unselected" });
    await page.getByTestId("onb-slot-start").fill("08:30");
    await visibleNext().click();
    await page.getByTestId("onb-step-3").waitFor({ state: "visible" });

    const { schedules } = await waitForValue(
      () => ctx.getSync("schedules"),
      ({ schedules: list }) => Array.isArray(list) && list.length === 1,
      { message: "one schedule saved by step 2" },
    );
    const [slot] = schedules;
    assert.deepEqual([...slot.days].sort(), [1, 2, 3, 4, 5].filter((day) => day !== offDay));
    assert.equal(slot.start, "08:30");
    assert.equal(slot.end, "12:00");
    assert.equal(slot.enabled, true);
    assert.equal(typeof slot.id, "string");
  });

  test("switching back to manual removes the slot again", { timeout: 30_000 }, async () => {
    await visibleBack().click();
    await page.getByTestId("onb-step-2").waitFor({ state: "visible" });
    await page.getByTestId("onb-when-manual").click();
    await visibleNext().click();
    await page.getByTestId("onb-step-3").waitFor({ state: "visible" });
    await waitForValue(() => ctx.getSync("schedules"), ({ schedules: list }) => Array.isArray(list) && list.length === 0, {
      message: "schedules: [] saved by the manual choice",
    });
  });

  test("step 3 asks why, with 4 sentences (the first preselected) or your own", { timeout: 30_000 }, async () => {
    for (const id of ["finish", "future", "proud", "time", "custom"]) {
      assert.ok(await isShown(page.getByTestId(`onb-goal-option-${id}`)), `onb-goal-option-${id}`);
      assert.equal(await isSelected(page.getByTestId(`onb-goal-option-${id}`)), id === "finish", `${id} selected state`);
    }
    assert.equal(await isShown(page.getByTestId("onb-goal")), false, "no text field until Write my own");
    // An empty own goal is refused, then a typed one is kept.
    await page.getByTestId("onb-goal-option-custom").click();
    const input = page.getByTestId("onb-goal");
    await input.waitFor({ state: "visible" });
    assert.ok(((await input.getAttribute("placeholder")) ?? "").trim().length > 0, "the goal field has an example placeholder");
    await visibleNext().click();
    await page.getByTestId("onb-goal-error").waitFor({ state: "visible" });
    assert.ok(await isShown(page.getByTestId("onb-step-3")), "still on step 3");
    await input.fill(GOAL);
    await visibleNext().click();
    await page.getByTestId("onb-step-4").waitFor({ state: "visible" });
  });

  test("step 4 offers money (preselected, 5) and free only, both visible; Finish saves the choice", { timeout: 30_000 }, async () => {
    const money = page.getByTestId("onb-mode-money");
    const free = page.getByTestId("onb-mode-free");
    assert.ok(await isShown(money));
    assert.ok(await isShown(free), "Free only is never hidden");
    assert.equal(await isSelected(money), true, "money is preselected");
    assert.equal(await isSelected(free), false);
    for (const amount of [2, 5, 10, 20]) {
      assert.equal(await isSelected(page.getByTestId(`onb-amount-${amount}`)), amount === 5, `onb-amount-${amount}`);
    }
    await page.getByTestId("onb-amount-10").click();
    await waitFor(() => isSelected(page.getByTestId("onb-amount-10")), { message: "10 to be selected" });
    await page.getByTestId("onb-finish").click();

    await page.getByTestId("onb-done").waitFor({ state: "visible" });
    const stored = await waitForValue(
      () => ctx.getSync(["goals", "prefs"]),
      (s) => s.prefs?.onboarded === true && s.goals?.items?.[0] === GOAL,
      { message: "goals and prefs.onboarded saved by the finish step" },
    );
    assert.deepEqual(stored.goals.items, [GOAL], "exactly one goal");
    const { unlock } = await waitForValue(() => ctx.getSync("unlock"), ({ unlock: u }) => u?.mode === "money", {
      message: "unlock saved by the finish step",
    });
    assert.deepEqual(unlock, { phrase: "", mode: "money", amount: 10 });
    assert.deepEqual(await findRawI18nKeys(page), [], "no untranslated i18n keys on the done screen");
  });

  test("the done screen first asks to pin the extension, shows how and waits", async () => {
    // A fresh profile never has the icon pinned, and no extension can pin itself.
    assert.ok(await isShown(page.getByTestId("onb-pin-step")), "the pin step comes first");
    assert.ok(((await page.getByTestId("onb-pin-how").innerText()) ?? "").trim().length > 10, "how to pin, for this browser");
    assert.ok(await isShown(page.getByTestId("onb-pin-waiting")));
    assert.equal(await isShown(page.getByTestId("onb-final")), false, "the summary waits for the pin or Skip");
    assert.deepEqual(await findRawI18nKeys(page), [], "no untranslated i18n keys on the pin step");
  });

  test("once pinned the done screen moves on by itself and lists what pinning gives", { timeout: 20_000 }, async () => {
    // Stand in for the user pinning the icon: the page polls chrome.action.getUserSettings.
    await page.evaluate(() => {
      chrome.action.getUserSettings = async () => ({ isOnToolbar: true });
    });
    await page.getByTestId("onb-benefits").waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await isShown(page.getByTestId("onb-pin-step")), false);
    assert.equal(await isShown(page.getByTestId("onb-pin-hint")), false, "no pin reminder once pinned");
    const title = await page.evaluate(() => chrome.i18n.getMessage("onb_pinned_title"));
    assert.equal((await page.locator("#done-title").innerText()).trim(), title);
    await page.reload();
    await page.getByTestId("onb-pin-step").waitFor({ state: "visible" });
  });

  test("Skip shows the summary: no coffee, no missing permission line when all is granted", async () => {
    await page.getByTestId("onb-pin-skip").click();
    await page.getByTestId("onb-final").waitFor({ state: "visible" });
    assert.ok(await isShown(page.getByTestId("onb-pin-hint")), "skipped: the short pin reminder stays");
    assert.equal(await isShown(page.getByTestId("onb-benefits")), false);
    assert.ok(await isShown(page.getByTestId("onb-try-session")));
    assert.ok(await isShown(page.getByTestId("onb-open-settings")));
    assert.equal(await isShown(page.getByTestId("onb-grant-missing")), false, "every chosen site has access in this run");
    assert.equal(await page.locator('[data-testid="onb-done"] [data-testid*="coffee"]:visible, [data-testid="onb-done"] .link-coffee:visible').count(), 0);
    assert.ok(!(await page.getByTestId("onb-done").innerText()).includes(COFFEE_LABEL.en), "no coffee link on the done screen");
  });

  test("reopening onboarding after completion shows the done screen", { timeout: 30_000 }, async () => {
    await page.reload();
    await page.getByTestId("onb-done").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("onb-step-1").isVisible(), false);
  });

  test("the done screen can start a 15 minute session", { timeout: 30_000 }, async () => {
    await page.getByTestId("onb-pin-skip").click();
    const clickedAt = Date.now();
    await page.getByTestId("onb-try-session").click();
    const { session } = await waitForValue(() => ctx.getLocal("session"), ({ session: s }) => Boolean(s?.endsAt), {
      message: "a session in chrome.storage.local",
    });
    const length = session.endsAt - clickedAt;
    assert.ok(length > 14.5 * MINUTE && length <= 15 * MINUTE + 5_000, `session should last about 15 min, got ${length} ms`);
    const badge = await waitForValue(() => ctx.getBadge(), (text) => BADGE_PATTERN.test(text), { message: "the badge countdown" });
    const { block } = await ctx.getState();
    assert.equal(block.active, true);
    assert.equal(block.source, "session", "manual mode: the block comes from the session only");
    assert.match(badge, /^(15|14)m$/);
  });

  test("settings synced from another device while onboarding is open show the done screen", { timeout: 30_000 }, async () => {
    // Second device: the onboarding tab opens before Chrome sync delivers the finished setup.
    await ctx.setSync({ prefs: { onboarded: false } });
    const fresh = await ctx.openExtensionPage("onboarding/onboarding.html");
    await fresh.getByTestId("onb-step-1").waitFor({ state: "visible" });
    const before = await ctx.getSync(["groups", "sites", "schedules", "goals"]);

    await ctx.setSync({ prefs: { onboarded: true } });
    await fresh.getByTestId("onb-done").waitFor({ state: "visible" });
    assert.equal(await fresh.getByTestId("onb-step-1").isVisible(), false);
    assert.deepEqual(await ctx.getSync(["groups", "sites", "schedules", "goals"]), before, "the page writes nothing over the synced settings");
    await fresh.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
