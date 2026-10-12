// Strict mode (SPEC 12.3, section 6 saveSettings, 12.5 lock banner): during an active block
// settings can only get stricter, both through the API and in the options UI.
// Refused: disabling or deleting an ENABLED group (lock_group), removing a site from an ENABLED
// group (lock_group_site), removing a custom site (lock_custom), editing existing slots
// (lock_schedule). Allowed: anything that can only block more, plus renaming, icons, order,
// and cleaning up DISABLED groups.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_KEYS,
  SOCIAL_DOMAINS,
  SUITE_TIMEOUT,
  comparableGroups,
  expandGroup,
  findRawI18nKeys,
  isDisabled,
  isSelected,
  isShown,
  launch,
  presetGroup,
  requireExtensionFiles,
  slotAroundNow,
  userGroup,
  waitFor,
  waitForValue,
  withGroup,
} from "./helpers.js";

const CUSTOM = "news.ycombinator.com";
const SOCIAL = presetGroup("social", { domains: SOCIAL_DOMAINS, enabled: true });
const VIDEO = presetGroup("video", { domains: ["youtube.com", "twitch.tv"], enabled: false });
const CHAT = userGroup("g_chat01", "Work chat", { icon: "chat", domains: ["slack.com", "discord.com"], enabled: true });
const GAMES = userGroup("g_games1", "Games", { icon: "game", domains: ["chess.com", "lichess.org", "example.org"], enabled: false });
const LATER = userGroup("g_later1", "Later", { icon: "book", domains: ["goodreads.com"], enabled: false });

/** A time of day different from both ends of `slot`. */
function otherTime(slot) {
  return ["23:30", "23:45", "06:15"].find((time) => time !== slot.start && time !== slot.end);
}

const without = (list, value) => list.filter((item) => item !== value);
const comparable = comparableGroups;

describe("lock during an active block", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let lockedSlot;
  let dormantSlot;

  before(async () => {
    requireExtensionFiles("options/options.html", "options/options.js", "blocked/blocked.html");
    ctx = await launch();
    // Slots on other weekdays: they exist (so they can be locked) but do not cover now.
    lockedSlot = slotAroundNow(Date.now(), { id: "s_locked", dayOffset: 3 }).slot;
    dormantSlot = slotAroundNow(Date.now(), { id: "s_dormant", dayOffset: 5, enabled: false }).slot;
    await ctx.setSync({
      groups: [SOCIAL, VIDEO, CHAT, GAMES, LATER],
      sites: { custom: [CUSTOM] },
      schedules: [lockedSlot, dormantSlot],
    });
    await ctx.startSessionDirect(30);
  });

  after(async () => {
    await ctx?.close();
  });

  const current = async () => (await ctx.getState()).settings;
  const groupOf = (groups, id) => groups.find((group) => group.id === id);
  /** The stored schedules with `changes` applied to the slot `id` only. */
  const withSlot = (schedules, id, changes) => schedules.map((slot) => (slot.id === id ? { ...slot, ...changes } : slot));

  async function expectRefused(patch, reason, label = JSON.stringify(patch)) {
    const before = await ctx.getSync(SETTINGS_KEYS);
    const res = await ctx.saveSettings(patch);
    assert.equal(res?.ok, false, `${label} should be refused, got ${JSON.stringify(res)}`);
    assert.equal(res.reason, reason, `reason for: ${label}`);
    assert.deepEqual(await ctx.getSync(SETTINGS_KEYS), before, `refused changes are not written (${label})`);
  }

  async function expectAccepted(patch, label = JSON.stringify(patch)) {
    const res = await ctx.saveSettings(patch);
    assert.equal(res?.ok, true, `${label} should be accepted, got ${JSON.stringify(res)}`);
  }

  test("enabled groups and custom sites are blocked, disabled groups are not", { timeout: 30_000 }, async () => {
    const state = await ctx.getState();
    assert.equal(state.block.active, true);
    for (const domain of ["linkedin.com", "slack.com", CUSTOM]) {
      assert.ok(state.domains.includes(domain), `${domain} should be enforced: ${JSON.stringify(state.domains)}`);
    }
    for (const domain of ["youtube.com", "example.org", "goodreads.com"]) {
      assert.ok(!state.domains.includes(domain), `${domain} belongs to a disabled group`);
    }
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("app.slack.com", "/client/T123"));
    await ctx.gotoBlocked(page, ctx.site(CUSTOM, "/item?id=1"));
    await ctx.gotoSite(page, ctx.site("www.youtube.com", "/watch?v=1"));
    await page.close();
  });

  test("disabling or deleting an enabled group is refused with lock_group", async () => {
    const { groups } = await current();
    await expectRefused({ groups: withGroup(groups, "social", { enabled: false }) }, "lock_group", "disable the social preset group");
    await expectRefused({ groups: withGroup(groups, CHAT.id, { enabled: false }) }, "lock_group", "disable a user group");
    await expectRefused({ groups: groups.filter((g) => g.id !== CHAT.id) }, "lock_group", "delete an enabled user group");
    await expectRefused({ groups: groups.filter((g) => g.id !== "social") }, "lock_group", "delete the enabled social group");
    await expectRefused({ groups: [] }, "lock_group", "delete every group");
    await expectRefused({ groups: withGroup(groups, CHAT.id, { name: "Chat", enabled: false }) }, "lock_group", "rename and disable at once");
  });

  test("removing a site from an enabled group is refused with lock_group_site", async () => {
    const { groups } = await current();
    const social = groupOf(groups, "social");
    const chat = groupOf(groups, CHAT.id);
    await expectRefused({ groups: withGroup(groups, "social", { domains: without(social.domains, "linkedin.com") }) }, "lock_group_site", "remove linkedin.com from social");
    await expectRefused({ groups: withGroup(groups, CHAT.id, { domains: without(chat.domains, "slack.com") }) }, "lock_group_site", "remove slack.com from Work chat");
    await expectRefused({ groups: withGroup(groups, "social", { domains: [...without(social.domains, "linkedin.com"), "tumblr.com"] }) }, "lock_group_site", "swap a site of social");
  });

  test("removing a custom site is refused with lock_custom", async () => {
    const { sites } = await current();
    await expectRefused({ sites: { ...sites, custom: without(sites.custom, CUSTOM) } }, "lock_custom");
  });

  test("editing, disabling or deleting an existing slot is refused with lock_schedule", async () => {
    const { schedules } = await current();
    const slot = schedules.find((s) => s.id === lockedSlot.id);
    await expectRefused({ schedules: withSlot(schedules, slot.id, { end: otherTime(slot) }) }, "lock_schedule");
    await expectRefused({ schedules: withSlot(schedules, slot.id, { enabled: false }) }, "lock_schedule");
    await expectRefused({ schedules: schedules.filter((s) => s.id !== slot.id) }, "lock_schedule");
    await expectRefused({ schedules: [] }, "lock_schedule");
  });

  test("turning an existing disabled slot on is allowed, turning it back off is not", { timeout: 20_000 }, async () => {
    let { schedules } = await current();
    assert.equal(schedules.find((s) => s.id === dormantSlot.id)?.enabled, false, "the slot starts disabled");
    // Enabling it only makes things stricter, but enabling and editing at once is still an edit.
    await expectRefused(
      { schedules: withSlot(schedules, dormantSlot.id, { enabled: true, end: otherTime(dormantSlot) }) },
      "lock_schedule",
    );
    await expectAccepted({ schedules: withSlot(schedules, dormantSlot.id, { enabled: true }) });

    const stored = await ctx.getSync("schedules");
    const enabled = stored.schedules.find((s) => s.id === dormantSlot.id);
    assert.deepEqual(enabled, { ...dormantSlot, enabled: true }, "only the enabled flag changed");
    assert.equal((await ctx.getState()).block.active, true);

    ({ schedules } = await current());
    await expectRefused({ schedules: withSlot(schedules, dormantSlot.id, { enabled: false }) }, "lock_schedule");
  });

  test("stricter group changes and cosmetic edits are accepted", { timeout: 30_000 }, async () => {
    let { groups } = await current();
    await expectAccepted({ groups: withGroup(groups, "video", { enabled: true }) }, "enable a disabled group");

    ({ groups } = await current());
    const reading = userGroup("g_read01", "Reading", { icon: "book", domains: ["medium.com"], enabled: true });
    const someday = userGroup("g_some01", "Someday", { icon: "heart", domains: [], enabled: false });
    await expectAccepted({ groups: [...groups, reading, someday] }, "create an enabled and a disabled group");

    ({ groups } = await current());
    await expectAccepted({ groups: withGroup(groups, "social", { domains: [...groupOf(groups, "social").domains, "tumblr.com"] }) }, "add a site to an enabled group");
    ({ groups } = await current());
    await expectAccepted({ groups: withGroup(groups, GAMES.id, { domains: [...groupOf(groups, GAMES.id).domains, "roblox.com"] }) }, "add a site to a disabled group");
    ({ groups } = await current());
    await expectAccepted({ groups: withGroup(withGroup(groups, "social", { name: "Doomscrolling" }), CHAT.id, { name: "Team chat" }) }, "rename groups");
    ({ groups } = await current());
    await expectAccepted({ groups: withGroup(groups, CHAT.id, { icon: "briefcase" }) }, "change an icon");
    ({ groups } = await current());
    await expectAccepted({ groups: [...groups].reverse() }, "reorder the groups");
    ({ groups } = await current());
    await expectAccepted({ groups: withGroup(groups, GAMES.id, { domains: without(groupOf(groups, GAMES.id).domains, "chess.com") }) }, "remove a site from a disabled group");
    ({ groups } = await current());
    await expectAccepted({ groups: groups.filter((g) => g.id !== LATER.id && g.id !== someday.id) }, "delete disabled groups");

    const stored = (await ctx.getSync("groups")).groups;
    assert.deepEqual(
      stored.map((g) => g.id),
      ["g_read01", GAMES.id, CHAT.id, "video", "social"],
      "created groups kept, disabled ones deleted, order reversed",
    );
    const social = groupOf(stored, "social");
    assert.equal(social.name, "Doomscrolling");
    assert.equal(social.enabled, true);
    assert.ok(social.domains.includes("tumblr.com") && social.domains.includes("linkedin.com"));
    assert.equal(groupOf(stored, "video").enabled, true);
    assert.deepEqual(comparable(groupOf(stored, CHAT.id)), comparable({ ...CHAT, name: "Team chat", icon: "briefcase" }));
    assert.deepEqual(comparable(groupOf(stored, GAMES.id)), comparable({ ...GAMES, domains: ["lichess.org", "example.org", "roblox.com"] }));
    assert.deepEqual(comparable(groupOf(stored, "g_read01")), comparable(reading));

    const { domains } = await ctx.getState();
    for (const domain of ["tumblr.com", "youtube.com", "medium.com"]) {
      assert.ok(domains.includes(domain), `${domain} is enforced right away: ${JSON.stringify(domains)}`);
    }
  });

  test("other stricter changes are accepted", { timeout: 20_000 }, async () => {
    let { sites, schedules } = await current();
    await expectAccepted({ sites: { ...sites, custom: [...sites.custom, "https://www.Quora.com/some/path"] } });
    ({ sites } = await current());
    assert.ok(sites.custom.includes("quora.com"), `custom sites are normalized: ${JSON.stringify(sites.custom)}`);

    const extra = slotAroundNow(Date.now(), { id: "s_extra", dayOffset: 4 }).slot;
    await expectAccepted({ schedules: [...schedules, extra] });
    await expectAccepted({ goals: { items: ["Finish the report"], showQuote: true } });

    const stored = await ctx.getSync(["schedules", "goals"]);
    assert.deepEqual(stored.schedules.map((s) => s.id), [lockedSlot.id, dormantSlot.id, "s_extra"]);
    assert.deepEqual(stored.goals.items, ["Finish the report"]);
  });

  test("the options page locks what can't be loosened and leaves the rest editable", { timeout: 60_000 }, async () => {
    const options = await ctx.openOptions();
    await options.getByTestId("options-lock-banner").waitFor({ state: "visible" });

    // Enabled groups: can't be turned off, deleted or lose a site; can grow, be renamed, get an icon.
    for (const [id, site] of [["social", "linkedin.com"], [CHAT.id, "slack.com"]]) {
      const toggle = options.getByTestId(`group-toggle-${id}`);
      await waitFor(() => isDisabled(toggle), { message: `group-toggle-${id} to be locked` });
      assert.equal(await isSelected(toggle), true, `${id} shows as enabled`);
      await expandGroup(options, id);
      assert.equal(await isDisabled(options.getByTestId(`group-delete-${id}`)), true, `an enabled group (${id}) can't be deleted`);
      assert.equal(await isDisabled(options.getByTestId(`group-site-remove-${id}-${site}`)), true, `${site} can't be removed from ${id}`);
      assert.equal(await isDisabled(options.getByTestId(`group-add-input-${id}`)), false, `sites can still be added to ${id}`);
      assert.equal(await isDisabled(options.getByTestId(`group-name-${id}`)), false, `${id} can still be renamed`);
      assert.equal(await isDisabled(options.getByTestId(`group-icon-${id}-globe`)), false, `${id} can still get another icon`);
    }

    // A disabled group: can be turned on, cleaned up or deleted.
    const gamesToggle = options.getByTestId(`group-toggle-${GAMES.id}`);
    assert.equal(await isSelected(gamesToggle), false, "Games shows as disabled");
    assert.equal(await isDisabled(gamesToggle), false, "a disabled group can be turned on");
    await expandGroup(options, GAMES.id);
    assert.equal(await isDisabled(options.getByTestId(`group-delete-${GAMES.id}`)), false, "a disabled group can be deleted");
    assert.equal(await isDisabled(options.getByTestId(`group-site-remove-${GAMES.id}-lichess.org`)), false, "a disabled group can lose a site");

    assert.equal(await isDisabled(options.getByTestId("group-new")), false, "new groups can be created");
    const remove = options.getByTestId(`custom-remove-${CUSTOM}`);
    await remove.waitFor({ state: "visible" });
    assert.equal(await isDisabled(remove), true, "custom sites can't be removed during a block");
    assert.equal(await isDisabled(options.getByTestId("custom-input")), false, "custom sites can still be added");
    assert.equal(await isDisabled(options.getByTestId("schedule-add")), false, "slots can still be added");

    const slotControls = options
      .getByTestId(`schedule-${lockedSlot.id}`)
      .locator("input:visible, button:visible, select:visible");
    const count = await slotControls.count();
    assert.ok(count > 0, "the existing slot is rendered with controls");
    for (let i = 0; i < count; i += 1) {
      const control = slotControls.nth(i);
      const label = await control.evaluate((el) => el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.outerHTML.slice(0, 80));
      assert.equal(await isDisabled(control), true, `"${label}" of an existing slot should be locked`);
    }
    assert.deepEqual(await findRawI18nKeys(options), [], "no untranslated i18n keys on the options page");
    await options.close();
  });

  test("allowed changes made in the options page during the block apply right away", { timeout: 60_000 }, async () => {
    const options = await ctx.openOptions();
    await options.getByTestId("options-lock-banner").waitFor({ state: "visible" });

    // Add a site to the enabled social group.
    await expandGroup(options, "social");
    await options.getByTestId("group-add-input-social").fill("wikipedia.org");
    await options.getByTestId("group-add-social").click();
    await waitForValue(() => ctx.getSync("groups"), ({ groups }) => groupOf(groups, "social")?.domains.includes("wikipedia.org"), {
      message: "wikipedia.org to be added to the social group",
    });
    await options.getByTestId("group-site-social-wikipedia.org").waitFor({ state: "visible" });

    // Turn the disabled Games group on: once on, it is locked like the others.
    const gamesToggle = options.getByTestId(`group-toggle-${GAMES.id}`);
    await gamesToggle.click();
    await waitForValue(() => ctx.getSync("groups"), ({ groups }) => groupOf(groups, GAMES.id)?.enabled === true, {
      message: "the Games group to be enabled",
    });
    await waitFor(() => isDisabled(gamesToggle), { message: "the Games toggle to be locked once enabled" });
    await options.close();

    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("en.wikipedia.org", "/wiki/Rabbit_hole"));
    await ctx.gotoBlocked(page, ctx.site("example.org", "/games"));
    await page.close();
  });

  test("after the block ends, removing works again from the options page", { timeout: 40_000 }, async () => {
    const options = await ctx.openOptions();
    await ctx.endSessionDirect();
    assert.equal((await ctx.getState()).block.active, false);

    await waitFor(async () => !(await isShown(options.getByTestId("options-lock-banner"))), {
      message: "the lock banner to disappear",
    });
    await expandGroup(options, "social");
    const removeSite = options.getByTestId("group-site-remove-social-linkedin.com");
    await waitFor(async () => !(await isDisabled(removeSite)), { message: "the group site remove button to be enabled" });
    await removeSite.click();
    await waitForValue(() => ctx.getSync("groups"), ({ groups }) => !groupOf(groups, "social").domains.includes("linkedin.com"), {
      message: "linkedin.com to be removed from the social group",
    });

    const remove = options.getByTestId(`custom-remove-${CUSTOM}`);
    await waitFor(async () => !(await isDisabled(remove)), { message: "the custom remove button to be enabled" });
    await remove.click();
    await waitForValue(() => ctx.getSync("sites"), ({ sites }) => !sites.custom.includes(CUSTOM), {
      message: `${CUSTOM} to be removed from sites.custom`,
    });
    await options.getByTestId("options-saved").waitFor({ state: "visible" });
    await options.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
