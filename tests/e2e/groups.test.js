// Groups in the options page (SPEC 12.2, 12.5): the preset groups show with social on, a new
// group can be created, named, given an icon and sites, and it is enforced during a session.
// Removing a site or turning a group off (outside a block) stops blocking it. Also the single
// goal field and the coffee button of the options page.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  COFFEE_LABEL,
  GROUP_ICONS,
  GROUP_NAME_MAX,
  MAX_GROUPS,
  MAX_GROUP_DOMAINS,
  PRESET_IDS,
  SUITE_TIMEOUT,
  USER_GROUP_ID,
  assertDefaultGroups,
  expandGroup,
  findRawI18nKeys,
  isSelected,
  isShown,
  launch,
  normalizeCopy,
  requireExtensionFiles,
  sleep,
  testIdSuffixes,
  userGroup,
  waitFor,
  waitForValue,
} from "./helpers.js";

const GROUP_NAME = "Work chat";

describe("groups in the options page", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let options;
  let groupId;

  before(async () => {
    requireExtensionFiles("options/options.html", "options/options.js", "blocked/blocked.html");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  const storedGroups = async () => (await ctx.getSync("groups")).groups ?? null;
  const storedGroup = async (id) => (await storedGroups())?.find((group) => group.id === id) ?? null;
  const waitForGroup = (id, predicate, message) =>
    waitForValue(() => storedGroup(id), (group) => Boolean(group) && predicate(group), { message });

  /** Ids of the group rows currently rendered (from their toggles and name inputs). */
  async function renderedGroupIds() {
    const ids = [...(await testIdSuffixes(options, "group-toggle-")), ...(await testIdSuffixes(options, "group-name-"))];
    return new Set(ids);
  }

  test("the preset groups are listed, social on, and the coffee button has its new label", { timeout: 30_000 }, async () => {
    await assertDefaultGroups((await ctx.getState()).settings.groups, "en");
    options = await ctx.openOptions();
    for (const id of PRESET_IDS) {
      await options.getByTestId(`group-${id}`).waitFor({ state: "visible" });
      assert.equal(await isSelected(options.getByTestId(`group-toggle-${id}`)), id === "social", `group-toggle-${id}`);
    }
    // A preset group without a custom name shows its translated name.
    const socialName = await ctx.inExtensionPage(() => chrome.i18n.getMessage("category_social"));
    assert.ok(normalizeCopy(await options.getByTestId("group-social").innerText()).includes(socialName), `group-social shows "${socialName}"`);

    const coffee = options.getByTestId("options-coffee");
    await coffee.scrollIntoViewIfNeeded();
    assert.equal(normalizeCopy(await coffee.innerText()), COFFEE_LABEL.en);
    assert.ok(await coffee.evaluate((el) => el.classList.contains("link-coffee") && !el.classList.contains("btn")), "options-coffee is an orange .link-coffee text link, not a button");
    assert.deepEqual(await findRawI18nKeys(options), [], "no untranslated i18n keys on the options page");
  });

  test("a preset group's name field shows the translated name as placeholder", { timeout: 20_000 }, async () => {
    await expandGroup(options, "social");
    const socialName = await ctx.inExtensionPage(() => chrome.i18n.getMessage("category_social"));
    const name = options.getByTestId("group-name-social");
    assert.equal(await name.inputValue(), "", "no custom name yet");
    assert.equal(normalizeCopy(await name.getAttribute("placeholder")), normalizeCopy(socialName));
    assert.ok(await isShown(options.getByTestId("group-site-social-linkedin.com")), "the social sites show as chips");
  });

  test("New group adds an expanded group with its name focused", { timeout: 20_000 }, async () => {
    const before = await renderedGroupIds();
    await options.getByTestId("group-new").click();
    const ids = await waitForValue(
      async () => [...(await renderedGroupIds())].filter((id) => !before.has(id)),
      (fresh) => fresh.length === 1,
      { message: "one new group row after clicking group-new" },
    );
    [groupId] = ids;
    assert.match(groupId, USER_GROUP_ID, 'new group ids are "g_" plus 6 to 10 base36 characters');
    await options.getByTestId(`group-name-${groupId}`).waitFor({ state: "visible" });
    const focused = await options.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    assert.equal(focused, `group-name-${groupId}`, "the name of the new group has the focus");
    assert.equal(await isSelected(options.getByTestId(`group-toggle-${groupId}`)), true, "a new group starts enabled");

    // The icon picker offers every GROUP_ICONS icon, the star is the default one.
    const icons = await testIdSuffixes(options, `group-icon-${groupId}-`);
    assert.deepEqual([...icons].sort(), [...GROUP_ICONS].sort(), "one icon button per GROUP_ICONS entry");
    assert.equal(await isSelected(options.getByTestId(`group-icon-${groupId}-star`)), true, "a new group gets the star icon");
  });

  test("name, icon and sites typed in the editor are saved", { timeout: 40_000 }, async () => {
    await options.getByTestId(`group-name-${groupId}`).fill(GROUP_NAME);
    let group = await waitForGroup(groupId, (g) => g.name === GROUP_NAME, `the group name "${GROUP_NAME}" to be saved`);
    assert.equal(group.enabled, true);
    assert.equal(group.preset, undefined, "a user group has no preset");

    const chat = options.getByTestId(`group-icon-${groupId}-chat`);
    await chat.click();
    group = await waitForGroup(groupId, (g) => g.icon === "chat", "the chat icon to be saved");
    await waitFor(() => isSelected(chat), { message: "the chat icon button to be pressed" });
    assert.equal(await isSelected(options.getByTestId(`group-icon-${groupId}-star`)), false, "only one icon is pressed");

    const addInput = options.getByTestId(`group-add-input-${groupId}`);
    const add = options.getByTestId(`group-add-${groupId}`);
    await addInput.fill("not a site");
    await add.click();
    await options.getByTestId(`group-error-${groupId}`).waitFor({ state: "visible" });
    assert.deepEqual((await storedGroup(groupId)).domains, [], "an invalid entry is not saved");

    // Full URLs are accepted and normalized.
    await addInput.fill("https://www.Slack.com/signin?from=e2e");
    await add.click();
    group = await waitForGroup(groupId, (g) => g.domains.includes("slack.com"), "slack.com to be added to the group");
    assert.deepEqual(group.domains, ["slack.com"]);
    await options.getByTestId(`group-site-${groupId}-slack.com`).waitFor({ state: "visible" });
    await waitFor(async () => !(await isShown(options.getByTestId(`group-error-${groupId}`))), { message: "the error to clear" });

    await addInput.fill("slack.com");
    await add.click();
    await sleep(500);
    assert.deepEqual((await storedGroup(groupId)).domains, ["slack.com"], "a site is listed once");

    const row = options.getByTestId(`group-${groupId}`);
    await waitFor(async () => normalizeCopy(await row.innerText()).includes(GROUP_NAME), {
      message: () => `the row group-${groupId} to show the name "${GROUP_NAME}"`,
    });
  });

  test("the new group is enforced during a session", { timeout: 40_000 }, async () => {
    await ctx.startSessionDirect(20);
    const state = await ctx.getState();
    assert.equal(state.block.active, true);
    assert.ok(state.domains.includes("slack.com"), `slack.com should be enforced: ${JSON.stringify(state.domains)}`);

    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("slack.com", "/"));
    await ctx.gotoBlocked(page, ctx.site("app.slack.com", "/client/T123"));
    await ctx.gotoBlocked(page, ctx.site("linkedin.com", "/feed/"));
    await ctx.gotoSite(page, ctx.site("example.org", "/still-open"));
    await page.close();
  });

  test("a site removed from a group is no longer blocked", { timeout: 40_000 }, async () => {
    await ctx.endSessionDirect();
    await waitFor(async () => !(await isShown(options.getByTestId("options-lock-banner"))), { message: "the lock banner to go away" });

    await expandGroup(options, "social");
    await options.getByTestId("group-site-remove-social-linkedin.com").click();
    const social = await waitForGroup("social", (g) => !g.domains.includes("linkedin.com"), "linkedin.com to leave the social group");
    assert.ok(social.domains.includes("facebook.com"), "the other sites stay");
    assert.equal(social.enabled, true);
    await waitFor(async () => !(await isShown(options.getByTestId("group-site-social-linkedin.com"))), { message: "the chip to go away" });

    await ctx.startSessionDirect(20);
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await ctx.gotoBlocked(page, ctx.site("facebook.com", "/"));
    await ctx.gotoBlocked(page, ctx.site("slack.com", "/"));
    await page.close();
  });

  test("a group turned off is no longer blocked", { timeout: 40_000 }, async () => {
    await ctx.endSessionDirect();
    await waitFor(async () => !(await isShown(options.getByTestId("options-lock-banner"))), { message: "the lock banner to go away" });

    await options.getByTestId(`group-toggle-${groupId}`).click();
    await waitForGroup(groupId, (g) => g.enabled === false, "the new group to be turned off");
    await ctx.startSessionDirect(20);
    const state = await ctx.getState();
    assert.ok(!state.domains.includes("slack.com"), "slack.com is not enforced anymore");
    const page = await ctx.newPage();
    await ctx.gotoSite(page, ctx.site("slack.com", "/"));
    await page.close();
  });

  test("Your why is a single field that saves one sentence", { timeout: 30_000 }, async () => {
    const goal = options.getByTestId("goal-0");
    await goal.scrollIntoViewIfNeeded();
    assert.equal(await options.locator('[data-testid="goal-1"], [data-testid="goal-2"]').count(), 0, "one goal only (SPEC 12.5)");
    await goal.fill("Ship the beta by Friday");
    await waitForValue(() => ctx.getSync("goals"), ({ goals }) => goals?.items?.[0] === "Ship the beta by Friday", {
      message: "the goal typed in goal-0 to be saved",
    });
    const { goals } = await ctx.getSync("goals");
    assert.deepEqual(goals.items, ["Ship the beta by Friday"], "goals.items holds exactly one goal");
    assert.equal(await options.getByTestId("quote-toggle").count(), 0, "no motivational line setting any more");
  });

  test("a disabled group can be deleted", { timeout: 30_000 }, async () => {
    await ctx.endSessionDirect();
    await waitFor(async () => !(await isShown(options.getByTestId("options-lock-banner"))), { message: "the lock banner to go away" });
    options.on("dialog", (dialog) => dialog.accept().catch(() => {}));
    await expandGroup(options, groupId);
    await options.getByTestId(`group-delete-${groupId}`).click();
    await waitForValue(storedGroups, (groups) => Array.isArray(groups) && !groups.some((g) => g.id === groupId), {
      message: "the group to be deleted from storage",
    });
    await waitFor(async () => !(await isShown(options.getByTestId(`group-${groupId}`))), { message: "the group row to go away" });
    await options.close();
  });

  test("the background refuses invalid groups and normalizes their sites", { timeout: 20_000 }, async () => {
    const base = (await ctx.getState()).settings.groups;
    const valid = userGroup("g_valid1", "Valid", { icon: "book" });
    const many = Array.from({ length: MAX_GROUPS + 1 - base.length }, (_, i) => userGroup(`g_many${String(i).padStart(2, "0")}`, `Group ${i}`));
    const refused = {
      "a groups value that is not an array": { social: true },
      "two groups with the same id": [...base, { ...valid }, { ...valid, name: "Twin" }],
      "an id that is not a group id": [...base, { ...valid, id: "not a valid id!" }],
      "an icon outside GROUP_ICONS": [...base, { ...valid, icon: "rocket" }],
      "a user group without a name": [...base, { ...valid, name: "   " }],
      "a name over 30 characters": [...base, { ...valid, name: "x".repeat(GROUP_NAME_MAX + 1) }],
      "enabled that is not a boolean": [...base, { ...valid, enabled: "yes" }],
      "more than 100 sites in a group": [...base, { ...valid, domains: Array.from({ length: MAX_GROUP_DOMAINS + 1 }, (_, i) => `site${i}.com`) }],
      "more than 20 groups": [...base, ...many],
    };
    const before = await ctx.getSync("groups");
    for (const [label, groups] of Object.entries(refused)) {
      const res = await ctx.saveSettings({ groups });
      assert.deepEqual(res, { ok: false, reason: "invalid_groups" }, label);
    }
    assert.deepEqual(await ctx.getSync("groups"), before, "refused groups are not written");

    const messy = { ...valid, name: "  Reading  ", domains: ["https://www.Example.org/some/path", "example.org", "WWW.EXAMPLE.ORG."] };
    const res = await ctx.saveSettings({ groups: [...base, messy] });
    assert.equal(res?.ok, true, `a valid group should be saved, got ${JSON.stringify(res)}`);
    const stored = await storedGroup(valid.id);
    assert.equal(stored.name, "Reading", "names are trimmed");
    assert.deepEqual(stored.domains, ["example.org"], "sites are normalized and listed once");
    assert.equal((await ctx.saveSettings({ groups: base }))?.ok, true, "the valid group can be deleted again");
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
