import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_KEYS,
  getRuntime,
  getSettings,
  mergeRuntime,
  mergeSettings,
  onRuntimeChanged,
  onSettingsChanged,
  setRuntime,
} from "../../extension/shared/storage.js";
import {
  DEFAULT_SETTINGS,
  GROUP_NAME_MAX,
  MAX_GROUP_DOMAINS,
  MAX_GROUPS,
  SETTINGS_KEYS as CONSTANT_KEYS,
} from "../../extension/shared/constants.js";
import { effectiveDomains } from "../../extension/shared/domains.js";
import { localDayKey } from "../../extension/shared/format.js";
import { defaultGroups, presetDomains } from "../../extension/shared/presets.js";
import { at, fakeEvent } from "./helpers.js";

const PHRASE = "I close this tab and go back to the thing that actually matters to me today.";
const DEFAULT_UNLOCK = { phrase: "", mode: "free", amount: 5 };

function defaults(locale = "en") {
  return { groups: defaultGroups(locale), ...structuredClone(DEFAULT_SETTINGS) };
}

function userGroup(extra = {}) {
  return { id: "g_work01", name: "Work chat", icon: "chat", domains: ["slack.com"], enabled: true, ...extra };
}

describe("SETTINGS_KEYS", () => {
  test("lists the six sync keys, groups first and unlock included", () => {
    assert.deepEqual(SETTINGS_KEYS, ["groups", "sites", "schedules", "goals", "prefs", "unlock"]);
    assert.equal(SETTINGS_KEYS, CONSTANT_KEYS);
    assert.deepEqual(Object.keys(mergeSettings({})), SETTINGS_KEYS);
  });
});

describe("mergeSettings", () => {
  test("empty storage gives the default groups for the locale and a mutable copy of the defaults", () => {
    const settings = mergeSettings({}, "en");
    assert.deepEqual(settings, defaults("en"));
    assert.deepEqual(mergeSettings({}, "fr"), defaults("fr"));
    assert.notEqual(settings.sites, DEFAULT_SETTINGS.sites);
    settings.sites.custom.push("x.com");
    settings.prefs.onboarded = true;
    settings.unlock.phrase = PHRASE;
    settings.goals.items[0] = "Ship";
    assert.deepEqual(DEFAULT_SETTINGS.sites.custom, []);
    assert.equal(DEFAULT_SETTINGS.prefs.onboarded, false);
    assert.equal(DEFAULT_SETTINGS.unlock.phrase, "");
    assert.deepEqual(DEFAULT_SETTINGS.goals.items, [""]);
    assert.deepEqual(mergeSettings(undefined), defaults("en"));
    assert.deepEqual(mergeSettings(null, "en"), defaults("en"));
    assert.deepEqual(mergeSettings("junk", "fr"), defaults("fr"));
  });

  test("by default only the social group is enabled", () => {
    assert.deepEqual(effectiveDomains(mergeSettings({}, "en")), [...presetDomains("social", "en")].sort());
  });

  test("the user's own sites keep only strings, V2 fields are dropped", () => {
    assert.deepEqual(mergeSettings({ sites: { custom: ["a.com", 3, null] } }).sites, { custom: ["a.com"] });
    assert.deepEqual(mergeSettings({ sites: { custom: "x.com" } }).sites, { custom: [] });
    assert.deepEqual(mergeSettings({ sites: { categories: { social: true }, excluded: ["x.com"], custom: ["y.com"] } }).sites, {
      custom: ["y.com"],
    });
  });

  test("schedules are copied, prefs merged", () => {
    const stored = { schedules: [{ id: "s_1", days: [1], start: "07:00", end: "08:00", enabled: true }, "junk"], prefs: { onboarded: true } };
    const settings = mergeSettings(stored);
    assert.deepEqual(settings.schedules, [stored.schedules[0]]);
    assert.notEqual(settings.schedules[0], stored.schedules[0]);
    assert.notEqual(settings.schedules[0].days, stored.schedules[0].days);
    assert.deepEqual(settings.prefs, { onboarded: true });
  });

  test("unlock keeps the stored sentence, mode and amount in a fresh object", () => {
    const stored = { unlock: { phrase: PHRASE, mode: "money", amount: 10, extra: true } };
    const settings = mergeSettings(stored);
    assert.deepEqual(settings.unlock, { phrase: PHRASE, mode: "money", amount: 10 });
    assert.notEqual(settings.unlock, stored.unlock);
  });

  test("a missing or malformed unlock means the defaults (default sentence, free, 5)", () => {
    for (const unlock of [undefined, null, "text", [PHRASE], {}, { phrase: 42 }, { phrase: null }, { phrase: "" }]) {
      assert.deepEqual(mergeSettings({ unlock }).unlock, DEFAULT_UNLOCK, JSON.stringify(unlock));
    }
  });

  test("a sentence that could never be typed falls back to the default one", () => {
    for (const phrase of ["   ", "\n\t", "\u200B\u200B", "\u0301\u0300"]) {
      assert.deepEqual(mergeSettings({ unlock: { phrase } }).unlock, DEFAULT_UNLOCK, JSON.stringify(phrase));
    }
  });

  test("V3 stored only the sentence: the mode and amount get their defaults", () => {
    assert.deepEqual(mergeSettings({ unlock: { phrase: PHRASE } }).unlock, { phrase: PHRASE, mode: "free", amount: 5 });
    assert.deepEqual(mergeSettings({ unlock: { phrase: "" } }).unlock, DEFAULT_UNLOCK);
  });

  test("a valid mode and amount are kept, custom amounts included", () => {
    const cases = [["money", 2], ["money", 20], ["money", 37], ["free", 1], ["free", 500]];
    for (const [mode, amount] of cases) {
      assert.deepEqual(mergeSettings({ unlock: { mode, amount } }).unlock, { phrase: "", mode, amount }, `${mode} ${amount}`);
    }
  });

  test("an unknown mode becomes free, an invalid amount becomes 5, independently", () => {
    for (const mode of ["paid", "MONEY", "", null, 1, ["money"]]) {
      assert.deepEqual(mergeSettings({ unlock: { mode, amount: 10 } }).unlock, { phrase: "", mode: "free", amount: 10 }, JSON.stringify(mode));
    }
    for (const amount of [0, 501, 2.5, -5, "10", null, Number.NaN, true]) {
      assert.deepEqual(mergeSettings({ unlock: { mode: "money", amount } }).unlock, { phrase: "", mode: "money", amount: 5 }, JSON.stringify(amount));
    }
  });

  test("unlock keys come in the order saveSettings writes (phrase, mode, amount)", () => {
    const { unlock } = mergeSettings({ unlock: { amount: 10, mode: "money", phrase: PHRASE } });
    assert.deepEqual(Object.keys(unlock), ["phrase", "mode", "amount"]);
  });
});

describe("mergeSettings goals (one goal)", () => {
  test("exactly one string", () => {
    assert.deepEqual(mergeSettings({ goals: { items: ["Ship v1"] } }).goals, { items: ["Ship v1"], showQuote: true });
    assert.deepEqual(mergeSettings({ goals: { items: [], showQuote: false } }).goals, { items: [""], showQuote: false });
    assert.deepEqual(mergeSettings({ goals: { showQuote: "no" } }).goals, { items: [""], showQuote: true });
    assert.deepEqual(mergeSettings({ goals: "junk" }).goals, { items: [""], showQuote: true });
  });

  test("V2 kept three goals: the first non blank one is kept", () => {
    assert.deepEqual(mergeSettings({ goals: { items: ["a", "b", "c"], showQuote: false } }).goals, { items: ["a"], showQuote: false });
    assert.deepEqual(mergeSettings({ goals: { items: ["", "Run a 10k", "Read"] } }).goals.items, ["Run a 10k"]);
    assert.deepEqual(mergeSettings({ goals: { items: ["   ", "", "Write chapter 3"] } }).goals.items, ["Write chapter 3"]);
    assert.deepEqual(mergeSettings({ goals: { items: [1, null, "c"] } }).goals.items, ["c"]);
    assert.deepEqual(mergeSettings({ goals: { items: ["", "", ""] } }).goals.items, [""]);
  });

  test("the goal is kept as typed (the background already trimmed what needed trimming)", () => {
    assert.deepEqual(mergeSettings({ goals: { items: ["Ship the beta "] } }).goals.items, ["Ship the beta "]);
  });
});

describe("mergeSettings groups", () => {
  test("stored groups win over V2 fields and defaults, in their stored order", () => {
    const groups = [userGroup(), { id: "social", preset: "social", name: "", icon: "users", domains: ["x.com"], enabled: false }];
    const settings = mergeSettings({ groups, sites: { categories: { video: true }, excluded: [], custom: [] } }, "fr");
    assert.deepEqual(settings.groups, groups);
    assert.notEqual(settings.groups[0], groups[0]);
    assert.notEqual(settings.groups[0].domains, groups[0].domains);
  });

  test("an empty stored list stays empty (every group was deleted)", () => {
    assert.deepEqual(mergeSettings({ groups: [] }).groups, []);
  });

  test("a stored value that is not a list falls back to migration or defaults", () => {
    assert.deepEqual(mergeSettings({ groups: "junk" }, "fr").groups, defaultGroups("fr"));
    assert.deepEqual(mergeSettings({ groups: { social: true } }, "en").groups, defaultGroups("en"));
    const migrated = mergeSettings({ groups: null, sites: { categories: { social: false, video: true } } }, "en").groups;
    assert.deepEqual(migrated.map((group) => group.enabled), [false, true, false, false, false]);
  });

  test("groups without a valid id are dropped, duplicated ids keep the first one", () => {
    const groups = [
      null,
      "social",
      42,
      userGroup({ id: undefined }),
      userGroup({ id: "" }),
      userGroup({ id: "has space" }),
      userGroup({ id: "x".repeat(65) }),
      userGroup({ name: "First" }),
      userGroup({ name: "Second" }),
    ];
    assert.deepEqual(mergeSettings({ groups }).groups, [userGroup({ name: "First" })]);
  });

  test("everything else is repaired instead of dropped", () => {
    const [group] = mergeSettings({
      groups: [{
        id: "g_messy01",
        preset: "bogus",
        name: `  ${"n".repeat(GROUP_NAME_MAX + 10)}\n`,
        icon: "rocket",
        domains: ["https://www.Slack.com/app", "slack.com", "not a domain", 7, null, "localhost", "Notion.so"],
        enabled: "yes",
        extra: "dropped",
      }],
    }).groups;
    assert.deepEqual(group, {
      id: "g_messy01",
      name: "n".repeat(GROUP_NAME_MAX),
      icon: "star",
      domains: ["slack.com", "notion.so"],
      enabled: false,
    });
  });

  test("a preset group keeps its preset; an unknown icon falls back to the preset icon", () => {
    const [group] = mergeSettings({ groups: [{ id: "video", preset: "video", name: 42, icon: null, domains: "x", enabled: true }] }).groups;
    assert.deepEqual(group, { id: "video", preset: "video", name: "", icon: "play", domains: [], enabled: true });
  });

  test("keys come in the order saveSettings writes (id, preset, name, icon, domains, enabled)", () => {
    const [preset, user] = mergeSettings({
      groups: [
        { enabled: true, domains: [], icon: "users", name: "", preset: "social", id: "social" },
        { enabled: false, domains: [], icon: "star", name: "Mine", id: "g_mine001" },
      ],
    }).groups;
    assert.deepEqual(Object.keys(preset), ["id", "preset", "name", "icon", "domains", "enabled"]);
    assert.deepEqual(Object.keys(user), ["id", "name", "icon", "domains", "enabled"]);
  });

  test("a name made of spaces is empty; a name cut at the limit loses its trailing space", () => {
    const names = mergeSettings({
      groups: [
        userGroup({ id: "g_a", name: "   " }),
        userGroup({ id: "g_b", name: `${"a".repeat(GROUP_NAME_MAX - 1)} tail` }),
      ],
    }).groups.map((group) => group.name);
    assert.deepEqual(names, ["", "a".repeat(GROUP_NAME_MAX - 1)]);
  });

  test("at most MAX_GROUPS groups and MAX_GROUP_DOMAINS sites per group", () => {
    const many = Array.from({ length: MAX_GROUPS + 5 }, (_, index) => userGroup({ id: `g_${index}` }));
    assert.equal(mergeSettings({ groups: many }).groups.length, MAX_GROUPS);
    const domains = Array.from({ length: MAX_GROUP_DOMAINS + 20 }, (_, index) => `site${index}.com`);
    const [group] = mergeSettings({ groups: [userGroup({ domains })] }).groups;
    assert.deepEqual(group.domains, domains.slice(0, MAX_GROUP_DOMAINS));
  });
});

describe("mergeSettings migration from V2 (sites.categories / sites.excluded)", () => {
  const v2 = {
    sites: {
      categories: { social: true, video: true, messaging: false, news: true, shopping: false },
      excluded: ["linkedin.com", "WWW.YouTube.com", "not a domain", 3],
      custom: ["lequipe.fr", "example.com"],
    },
    goals: { items: ["", "Finish the report", "Run"], showQuote: false },
  };

  test("the five presets become groups with the category flags, minus the unchecked sites", () => {
    const settings = mergeSettings(v2, "en");
    const expected = defaultGroups("en").map((group) => ({
      ...group,
      enabled: v2.sites.categories[group.id],
      domains: group.domains.filter((domain) => domain !== "linkedin.com" && domain !== "youtube.com"),
    }));
    assert.deepEqual(settings.groups, expected);
    assert.deepEqual(settings.sites, { custom: ["lequipe.fr", "example.com"] });
    assert.deepEqual(settings.goals, { items: ["Finish the report"], showQuote: false });
  });

  test("migrated groups use the locale's preset lists", () => {
    const news = mergeSettings(v2, "fr").groups.find((group) => group.id === "news");
    assert.ok(news.domains.includes("lemonde.fr") && !news.domains.includes("cnn.com"));
    assert.equal(news.enabled, true);
  });

  test("the blocked domains stay exactly what V2 blocked", () => {
    const blocked = effectiveDomains(mergeSettings(v2, "en"));
    const v2Blocked = new Set([
      ...presetDomains("social", "en"),
      ...presetDomains("video", "en"),
      ...presetDomains("news", "en"),
      "lequipe.fr",
      "example.com",
    ]);
    v2Blocked.delete("linkedin.com");
    v2Blocked.delete("youtube.com");
    assert.deepEqual(blocked, [...v2Blocked].sort());
  });

  test("missing or invalid category flags keep the default (social on, others off)", () => {
    const groups = mergeSettings({ sites: { categories: { video: true, news: "yes", bogus: true } } }, "en").groups;
    assert.deepEqual(groups.map((group) => [group.id, group.enabled]), [
      ["social", true],
      ["video", true],
      ["messaging", false],
      ["news", false],
      ["shopping", false],
    ]);
  });

  test("an excluded list alone still migrates (flags stay the defaults)", () => {
    const groups = mergeSettings({ sites: { excluded: ["x.com"] } }, "en").groups;
    const social = groups.find((group) => group.id === "social");
    assert.equal(social.enabled, true);
    assert.ok(!social.domains.includes("x.com"));
    assert.ok(social.domains.includes("facebook.com"));
  });

  test("V2 custom sites alone mean default groups", () => {
    assert.deepEqual(mergeSettings({ sites: { custom: ["x.com"] } }, "fr").groups, defaultGroups("fr"));
  });

  test("malformed V2 values never throw", () => {
    for (const sites of [{ categories: null, excluded: "x" }, { categories: [], excluded: {} }, { categories: "all" }]) {
      const settings = mergeSettings({ sites }, "en");
      assert.equal(settings.groups.length, 5, JSON.stringify(sites));
      assert.deepEqual(settings.sites, { custom: [] });
    }
  });
});

describe("mergeRuntime", () => {
  const now = at(2026, 9, 27, 15);

  test("defaults", () => {
    assert.deepEqual(mergeRuntime({}, now), {
      session: null,
      passes: {},
      stats: { day: "2026-09-27", blocked: 0, resisted: 0 },
    });
  });

  test("keeps today's stats and resets older ones", () => {
    assert.deepEqual(mergeRuntime({ stats: { day: "2026-09-27", blocked: 3, resisted: 2 } }, now).stats, {
      day: "2026-09-27",
      blocked: 3,
      resisted: 2,
    });
    assert.deepEqual(mergeRuntime({ stats: { day: "2026-09-26", blocked: 9, resisted: 9 } }, now).stats, {
      day: "2026-09-27",
      blocked: 0,
      resisted: 0,
    });
    assert.deepEqual(mergeRuntime({ stats: { day: "2026-09-27", blocked: -1, resisted: "2" } }, now).stats, {
      day: "2026-09-27",
      blocked: 0,
      resisted: 0,
    });
  });

  test("sanitizes session and passes", () => {
    const runtime = mergeRuntime(
      { session: { startedAt: 1, endsAt: 2 }, passes: { "x.com": 5, "y.com": "soon", "z.com": null } },
      now,
    );
    assert.deepEqual(runtime.session, { startedAt: 1, endsAt: 2 });
    assert.deepEqual(runtime.passes, { "x.com": 5 });
    assert.equal(mergeRuntime({ session: { endsAt: "x" } }, now).session, null);
    assert.deepEqual(mergeRuntime({ session: { endsAt: 10 } }, now).session, { startedAt: 10, endsAt: 10 });
  });
});

describe("chrome.storage wrappers", () => {
  let fake;

  beforeEach(() => {
    fake = {
      sync: { sites: { categories: { news: true } }, goals: { items: ["", "Run"] }, unlock: { phrase: PHRASE } },
      syncGets: [],
      local: { session: null, stats: { day: localDayKey(Date.now()), blocked: 1, resisted: 0 } },
      setCalls: [],
      onChanged: fakeEvent(),
    };
    globalThis.chrome = {
      storage: {
        sync: {
          get: async (keys) => {
            fake.syncGets.push(keys);
            return pickKeys(fake.sync, keys);
          },
        },
        local: {
          get: async (keys) => pickKeys(fake.local, keys),
          set: async (patch) => {
            fake.setCalls.push(patch);
          },
        },
        onChanged: fake.onChanged,
      },
    };
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  test("getSettings merges stored values with defaults and migrates V2 values", async () => {
    const settings = await getSettings();
    const enabled = settings.groups.filter((group) => group.enabled).map((group) => group.id);
    assert.deepEqual(enabled, ["social", "news"]);
    assert.deepEqual(settings.sites, { custom: [] });
    assert.deepEqual(settings.goals.items, ["Run"]);
    assert.deepEqual(settings.schedules, []);
    assert.deepEqual(settings.unlock, { phrase: PHRASE, mode: "free", amount: 5 });
  });

  test("getSettings reads every sync key, groups and unlock included", async () => {
    await getSettings();
    assert.deepEqual(fake.syncGets, [SETTINGS_KEYS]);
    assert.ok(fake.syncGets[0].includes("groups"));
    assert.ok(fake.syncGets[0].includes("unlock"));
  });

  test("getSettings builds the default groups in the browser language", async () => {
    fake.sync = {};
    globalThis.chrome.i18n = { getUILanguage: () => "fr-FR" };
    assert.deepEqual((await getSettings()).groups, defaultGroups("fr"));
    globalThis.chrome.i18n = { getUILanguage: () => "en-GB" };
    assert.deepEqual((await getSettings()).groups, defaultGroups("en"));
    delete globalThis.chrome.i18n;
    assert.deepEqual((await getSettings()).groups, defaultGroups("en"));
  });

  test("getRuntime fills defaults", async () => {
    const runtime = await getRuntime();
    assert.equal(runtime.session, null);
    assert.deepEqual(runtime.passes, {});
    assert.equal(runtime.stats.blocked, 1);
  });

  test("setRuntime writes to chrome.storage.local", async () => {
    await setRuntime({ passes: { "x.com": 1 } });
    assert.deepEqual(fake.setCalls, [{ passes: { "x.com": 1 } }]);
  });

  test("change listeners filter by area and can unsubscribe", () => {
    const syncCalls = [];
    const localCalls = [];
    const stopSync = onSettingsChanged((changes) => syncCalls.push(changes));
    const stopLocal = onRuntimeChanged((changes) => localCalls.push(changes));
    fake.onChanged.emit({ sites: {} }, "sync");
    fake.onChanged.emit({ session: {} }, "local");
    fake.onChanged.emit({ enforced: {} }, "session");
    assert.deepEqual(syncCalls, [{ sites: {} }]);
    assert.deepEqual(localCalls, [{ session: {} }]);
    stopSync();
    stopLocal();
    assert.equal(fake.onChanged.listeners.size, 0);
  });
});

function pickKeys(source, keys) {
  const result = {};
  for (const key of keys) if (key in source) result[key] = structuredClone(source[key]);
  return result;
}
