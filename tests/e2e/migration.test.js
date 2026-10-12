// Migration from V2 settings (SPEC 12.2): stored sites.categories / sites.excluded without stored
// groups become the default groups (enabled = categories[id], domains minus excluded), and the
// three V2 goals become one goal (the first non-empty item). What is blocked stays the same.
// Invalid stored entries are dropped without breaking anything.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_IDS,
  SUITE_TIMEOUT,
  comparableGroups,
  isSelected,
  launch,
  loadDefaultGroups,
  presetGroup,
  requireExtensionFiles,
  sorted,
  withGroup,
} from "./helpers.js";

const CUSTOM = "news.ycombinator.com";
const V2_CATEGORIES = { social: true, video: true, messaging: false, news: false, shopping: false };
const V2_SETTINGS = {
  sites: { categories: V2_CATEGORIES, excluded: ["linkedin.com", "pinterest.com"], custom: [CUSTOM] },
  goals: { items: ["", "Ship the beta", "Run a 10k in October"], showQuote: false },
  prefs: { onboarded: true },
};

/** effectiveDomains({ groups, sites }) as specified: enabled groups plus custom, parent dedupe, sorted. */
function expectedDomains(groups, custom) {
  const all = new Set([...groups.filter((group) => group.enabled).flatMap((group) => group.domains), ...custom]);
  const coveredByParent = (domain) => [...all].some((other) => other !== domain && domain.endsWith(`.${other}`));
  return sorted([...all].filter((domain) => !coveredByParent(domain)));
}

describe("migration from V2 settings", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let migrated;

  before(async () => {
    requireExtensionFiles("options/options.html", "options/options.js", "blocked/blocked.html");
    ctx = await launch();
    await ctx.setSync(V2_SETTINGS);
    await ctx.reconcile();
  });

  after(async () => {
    await ctx?.close();
  });

  test("getState turns V2 categories into groups and three goals into one", async () => {
    const { settings } = await ctx.getState();
    migrated = settings.groups;
    assert.ok(Array.isArray(migrated), `settings.groups should be an array, got ${JSON.stringify(settings.groups)}`);
    assert.deepEqual(migrated.map((group) => group.id), PRESET_IDS, "the 5 preset groups, in order");
    for (const group of migrated) {
      assert.equal(group.preset, group.id);
      assert.equal(group.enabled, V2_CATEGORIES[group.id], `${group.id} keeps its V2 on/off state`);
    }
    const social = migrated.find((group) => group.id === "social");
    assert.ok(social.domains.includes("facebook.com"), "social still blocks facebook.com");
    assert.ok(!social.domains.includes("linkedin.com") && !social.domains.includes("pinterest.com"), "V2 exclusions are removed from the group");

    const defaults = await loadDefaultGroups("en");
    if (defaults) {
      const expected = defaults.map((group) => ({
        ...group,
        enabled: V2_CATEGORIES[group.id],
        domains: group.domains.filter((domain) => !V2_SETTINGS.sites.excluded.includes(domain)),
      }));
      assert.deepEqual(comparableGroups(migrated), comparableGroups(expected), "defaultGroups with the V2 flags, minus the V2 exclusions");
    }

    assert.deepEqual(settings.sites.custom, [CUSTOM], "custom sites are kept");
    assert.deepEqual(settings.goals.items, ["Ship the beta"], "one goal: the first non-empty V2 goal");
    assert.equal(settings.goals.showQuote, false, "the quote preference is kept");
    assert.equal(settings.prefs.onboarded, true);
  });

  test("the same sites are blocked as in V2", { timeout: 40_000 }, async () => {
    await ctx.startSessionDirect(20);
    const state = await ctx.getState();
    assert.equal(state.block.active, true);
    assert.deepEqual(state.domains, expectedDomains(migrated, [CUSTOM]), "effective domains of the migrated groups");
    for (const domain of ["facebook.com", "youtube.com", CUSTOM]) assert.ok(state.domains.includes(domain), `${domain} is blocked`);
    for (const domain of ["linkedin.com", "pinterest.com", "cnn.com", "amazon.com"]) {
      assert.ok(!state.domains.includes(domain), `${domain} is not blocked`);
    }

    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("facebook.com", "/"));
    await ctx.gotoBlocked(page, ctx.site("www.youtube.com", "/watch?v=1"));
    await ctx.gotoBlocked(page, ctx.site(CUSTOM, "/news"));
    await ctx.gotoSite(page, ctx.site("linkedin.com", "/feed/"));
    await page.close();
  });

  test("the blocked page shows the one migrated goal", { timeout: 30_000 }, async () => {
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, ctx.site("facebook.com", "/watch"));
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });
    const goals = await page.getByTestId("blocked-goals").innerText();
    assert.ok(goals.includes("Ship the beta"), `the migrated goal shows: ${goals}`);
    assert.ok(!goals.includes("Run a 10k"), "later V2 goals are dropped");
    await page.close();
  });

  test("the options page shows the migrated groups", { timeout: 30_000 }, async () => {
    const options = await ctx.openOptions();
    for (const id of PRESET_IDS) {
      await options.getByTestId(`group-${id}`).waitFor({ state: "visible" });
      assert.equal(await isSelected(options.getByTestId(`group-toggle-${id}`)), V2_CATEGORIES[id], `group-toggle-${id}`);
    }
    await options.close();
  });

  test("the lock applies to migrated groups, and saved groups take over", { timeout: 20_000 }, async () => {
    const social = migrated.find((group) => group.id === "social");
    let res = await ctx.saveSettings({ groups: withGroup(migrated, "social", { enabled: false }) });
    assert.deepEqual(res, { ok: false, reason: "lock_group" });
    res = await ctx.saveSettings({ groups: withGroup(migrated, "social", { domains: social.domains.filter((d) => d !== "facebook.com") }) });
    assert.deepEqual(res, { ok: false, reason: "lock_group_site" });

    const withNews = withGroup(migrated, "news", { enabled: true });
    res = await ctx.saveSettings({ groups: withNews });
    assert.equal(res?.ok, true, `enabling a group should succeed, got ${JSON.stringify(res)}`);
    const { settings, domains } = await ctx.getState();
    assert.deepEqual(comparableGroups(settings.groups), comparableGroups(withNews), "stored groups win over the V2 categories");
    assert.ok(domains.includes("cnn.com"), "the news group now blocks");
  });

  test("V2 goals with nothing written give one empty goal", async () => {
    await ctx.setSync({ goals: { items: ["", "", ""], showQuote: true } });
    const { settings } = await ctx.getState();
    assert.deepEqual(settings.goals, { items: [""], showQuote: true });
  });

  test("invalid stored groups are dropped without breaking getState or the pages", { timeout: 30_000 }, async () => {
    await ctx.endSessionDirect();
    const valid = presetGroup("social", { domains: ["facebook.com", "linkedin.com"], enabled: true });
    await ctx.setSync({ groups: [valid, "junk", null, 42, { name: "No id", domains: ["x.com"], enabled: true }] });
    const { settings } = await ctx.getState();
    assert.ok(Array.isArray(settings.groups));
    assert.ok(settings.groups.every((group) => group && typeof group === "object" && typeof group.id === "string"), JSON.stringify(settings.groups));
    assert.deepEqual(comparableGroups(settings.groups.find((group) => group.id === "social")), valid, "the valid group is kept as is");
    assert.equal(settings.groups.length, 1, `only the valid group is kept: ${JSON.stringify(settings.groups)}`);

    const options = await ctx.openOptions();
    await options.getByTestId("group-social").waitFor({ state: "visible" });
    await options.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
