// "Reset everything" in the options page: back to defaults (sync removed, runtime state cleared),
// then setup starts again. For now (RESET_DURING_BLOCK) it also works during a block and ends it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_KEYS,
  SOCIAL_DOMAINS,
  SUITE_TIMEOUT,
  assertDefaultGroups,
  isDisabled,
  isShown,
  launch,
  localDayKey,
  presetGroup,
  requireExtensionFiles,
  slotAroundNow,
  userGroup,
} from "./helpers.js";

const RUNTIME_KEYS = ["session", "passes", "strict", "stats"];
const CUSTOM = "news.ycombinator.com";
const PHRASE = "I would rather finish my chapter than scroll for another hour today.";

function seedSettings(schedules) {
  return {
    groups: [
      presetGroup("social", { domains: SOCIAL_DOMAINS.filter((domain) => domain !== "pinterest.com"), enabled: true, name: "Doomscrolling" }),
      presetGroup("video", { domains: ["youtube.com", "twitch.tv"], enabled: true }),
      userGroup("g_work01", "Work chat", { icon: "chat", domains: ["slack.com"], enabled: false }),
    ],
    sites: { custom: [CUSTOM] },
    schedules,
    goals: { items: ["Ship the onboarding"], showQuote: false },
    prefs: { onboarded: true },
    unlock: { phrase: PHRASE },
  };
}

async function openOptions(ctx) {
  const page = await ctx.openOptions();
  await page.getByTestId("options-reset-all").waitFor();
  return page;
}

async function confirmReset(page) {
  await page.getByTestId("options-reset-all").click();
  await page.getByTestId("options-reset-confirm").waitFor({ state: "visible" });
  await Promise.all([
    page.waitForURL(/\/onboarding\/onboarding\.html/, { timeout: 10_000 }),
    page.getByTestId("options-reset-yes").click(),
  ]);
}

describe("reset everything", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;

  before(async () => {
    requireExtensionFiles("options/options.html", "options/options.js", "onboarding/onboarding.html");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  test("cancel keeps every setting", async () => {
    const dormant = slotAroundNow(Date.now(), { id: "s_dormant", dayOffset: 3 }).slot;
    await ctx.setSync(seedSettings([dormant]));
    await ctx.reconcile();
    const stored = await ctx.getSync(SETTINGS_KEYS);

    const page = await openOptions(ctx);
    await page.getByTestId("options-reset-all").click();
    assert.ok(await isShown(page.getByTestId("options-reset-confirm")), "the confirmation shows");
    await page.getByTestId("options-reset-no").click();
    assert.equal(await isShown(page.getByTestId("options-reset-confirm")), false, "the confirmation hides again");
    assert.ok(await isShown(page.getByTestId("options-reset-all")), "the reset button is back");
    assert.deepEqual(await ctx.getSync(SETTINGS_KEYS), stored, "nothing was deleted");
    await page.close();
  });

  test("outside a block: deletes settings and runtime state, then setup starts again", async () => {
    const dormant = slotAroundNow(Date.now(), { id: "s_dormant", dayOffset: 3 }).slot;
    await ctx.setSync(seedSettings([dormant]));
    await ctx.setLocal({ stats: { day: localDayKey(), blocked: 4, resisted: 2 }, passes: {} });
    await ctx.reconcile();

    const page = await openOptions(ctx);
    assert.equal(await isDisabled(page.getByTestId("options-reset-all")), false);
    await confirmReset(page);

    assert.deepEqual(await ctx.getSync(SETTINGS_KEYS), {}, "every synced setting is removed (defaults apply)");
    assert.deepEqual(await ctx.getLocal(RUNTIME_KEYS), {}, "session, passes, strict snapshot and stats are cleared");
    await page.getByTestId("onb-step-1").waitFor({ state: "visible" });

    const state = await ctx.getState();
    assert.equal(state.settings.prefs.onboarded, false);
    await assertDefaultGroups(state.settings.groups, "en");
    assert.deepEqual(state.settings.sites.custom, []);
    assert.deepEqual(state.settings.schedules, []);
    assert.deepEqual(state.settings.goals, { items: [""], showQuote: true });
    assert.equal(state.settings.unlock.phrase, "");
    assert.equal(state.block.active, false);
    assert.deepEqual(await ctx.getRules(), [], "no blocking rule is left");
    await page.close();
  });

  test("during a block (allowed for now): ends the block and starts setup again", async () => {
    const around = slotAroundNow(Date.now(), { id: "s_now" }).slot;
    await ctx.setSync(seedSettings([around]));
    await ctx.startSessionDirect(30);
    const before = await ctx.getState();
    assert.equal(before.block.active, true, "a block is running before the reset");
    assert.ok((await ctx.getRules()).length > 0, "rules are installed before the reset");

    const page = await openOptions(ctx);
    assert.equal(await isDisabled(page.getByTestId("options-reset-all")), false, "reset stays available during a block");
    assert.equal(await isShown(page.getByTestId("reset-lock-note")), false);
    await page.getByTestId("options-reset-all").click();
    const text = await page.getByTestId("options-reset-confirm-text").textContent();
    const expected = await ctx.inExtensionPage(() => chrome.i18n.getMessage("options_reset_confirm_block"));
    assert.equal(text.trim(), expected, "the confirmation says the running block ends");
    await Promise.all([
      page.waitForURL(/\/onboarding\/onboarding\.html/, { timeout: 10_000 }),
      page.getByTestId("options-reset-yes").click(),
    ]);

    const after = await ctx.getState();
    assert.equal(after.block.active, false, "the block is over");
    assert.equal(after.session, null);
    assert.deepEqual(await ctx.getRules(), []);
    assert.equal(await ctx.getBadge(), "");
    assert.deepEqual(await ctx.getLocal(RUNTIME_KEYS), {});
    await page.close();
  });

  test("the background answers resetAll directly", async () => {
    await ctx.setSync(seedSettings([]));
    const response = await ctx.message({ type: "resetAll" });
    assert.deepEqual(response, { ok: true });
    assert.deepEqual(await ctx.getSync(SETTINGS_KEYS), {});
  });

  test("no extension errors", () => {
    ctx.assertNoExtensionErrors();
  });
});
