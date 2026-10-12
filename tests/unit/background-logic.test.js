// Pure helpers of the background worker (extension/background/logic.js): settings patches (groups,
// sites, goals), V2 migration writes, strict snapshot, unlock sentence validation, enforcement
// lists, alarm time and the storage loop guard.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  GOAL_MAX_LENGTH,
  GROUP_ICONS,
  GROUP_NAME_MAX,
  LOOKAHEAD_DAYS,
  MAX_CUSTOM_DOMAINS,
  MAX_GROUP_DOMAINS,
  MAX_GROUPS,
  PHRASE_MAX,
  PHRASE_MIN,
  SETTINGS_KEYS as CONSTANT_KEYS,
} from "../../extension/shared/constants.js";
import { checkChange } from "../../extension/shared/lock.js";
import { defaultGroups, newGroupId } from "../../extension/shared/presets.js";
import { blockState } from "../../extension/shared/schedule.js";
import { mergeSettings } from "../../extension/shared/storage.js";
import {
  ALARM_MIN_DELAY_MS,
  ALARM_SLACK_MS,
  HEARTBEAT_MINUTES,
  SETTINGS_KEYS,
  SYNC_ITEM_QUOTA,
  completeMigration,
  enforcementLists,
  liveStrict,
  localChangeNeedsReconcile,
  nextAlarmTime,
  nextBadgeChange,
  normalizePhrase,
  pickChanged,
  resolveBlock,
  sanitizePatch,
  stableStringify,
  unionDomains,
  validatePhrase,
} from "../../extension/background/logic.js";
import { DAY, MINUTE, at, slot } from "./helpers.js";

// Monday 28 September 2026 (local time).
const monday = (hours, minutes = 0) => at(2026, 9, 28, hours, minutes);
const MORNING = slot([1], "09:00", "12:00");

function userGroup(extra = {}) {
  return { id: "g_work01", name: "Work chat", icon: "chat", domains: ["slack.com"], enabled: true, ...extra };
}

// sanitizePatch on a groups patch: the stored groups, or the refusal.
function saveGroups(groups) {
  const result = sanitizePatch({ groups }, mergeSettings({}, "en"));
  return result.ok ? result.value.groups : result;
}

const INVALID_GROUPS = { ok: false, reason: "invalid_groups" };

describe("SETTINGS_KEYS", () => {
  test("the background writes and resets the same six sync keys as storage.js", () => {
    assert.equal(SETTINGS_KEYS, CONSTANT_KEYS);
    assert.deepEqual(SETTINGS_KEYS, ["groups", "sites", "schedules", "goals", "prefs", "unlock"]);
  });
});

describe("saveSettings patch: groups", () => {
  test("the default groups and a user group are accepted as they are", () => {
    const groups = [...defaultGroups("fr"), userGroup()];
    assert.deepEqual(saveGroups(groups), groups);
  });

  test("an empty list is valid (every group deleted)", () => {
    assert.deepEqual(saveGroups([]), []);
  });

  test("a group made by the options page (New group, then named) is accepted", () => {
    const fresh = { id: newGroupId(), name: "Deep work", icon: "star", domains: [], enabled: true };
    assert.deepEqual(saveGroups([fresh]), [fresh]);
  });

  test("domains are normalized and deduplicated, keeping their order", () => {
    const [group] = saveGroups([userGroup({ domains: ["https://www.Notion.so/page", "slack.com", "NOTION.SO", "app.slack.com"] })]);
    assert.deepEqual(group.domains, ["notion.so", "slack.com", "app.slack.com"]);
  });

  test("names are trimmed, control characters become spaces", () => {
    const [group] = saveGroups([userGroup({ name: "  Work\tchat  " })]);
    assert.equal(group.name, "Work chat");
  });

  test("only known keys are stored, in a fixed order; preset null or empty means none", () => {
    const [user, empty, preset] = saveGroups([
      userGroup({ preset: null, expanded: true, color: "red" }),
      userGroup({ id: "g_other01", preset: "" }),
      { enabled: false, domains: ["youtube.com"], icon: "play", name: "", preset: "video", id: "video" },
    ]);
    assert.deepEqual(Object.keys(user), ["id", "name", "icon", "domains", "enabled"]);
    assert.deepEqual(Object.keys(empty), ["id", "name", "icon", "domains", "enabled"]);
    assert.deepEqual(preset, { id: "video", preset: "video", name: "", icon: "play", domains: ["youtube.com"], enabled: false });
  });

  test("every icon of GROUP_ICONS is accepted", () => {
    const groups = GROUP_ICONS.map((icon, index) => userGroup({ id: `g_icon${index}`, icon }));
    assert.equal(saveGroups(groups).length, GROUP_ICONS.length);
  });

  test("limits: MAX_GROUPS groups, MAX_GROUP_DOMAINS sites, GROUP_NAME_MAX characters", () => {
    const many = (count) => Array.from({ length: count }, (_, index) => userGroup({ id: `g_${index}`, domains: [] }));
    assert.equal(saveGroups(many(MAX_GROUPS)).length, MAX_GROUPS);
    assert.deepEqual(saveGroups(many(MAX_GROUPS + 1)), INVALID_GROUPS);

    const domains = (count) => Array.from({ length: count }, (_, index) => `site${index}.com`);
    assert.equal(saveGroups([userGroup({ domains: domains(MAX_GROUP_DOMAINS) })])[0].domains.length, MAX_GROUP_DOMAINS);
    assert.deepEqual(saveGroups([userGroup({ domains: domains(MAX_GROUP_DOMAINS + 1) })]), INVALID_GROUPS);
    // Duplicates are removed before counting.
    const doubled = [...domains(MAX_GROUP_DOMAINS), ...domains(MAX_GROUP_DOMAINS)];
    assert.equal(saveGroups([userGroup({ domains: doubled })])[0].domains.length, MAX_GROUP_DOMAINS);

    assert.equal(saveGroups([userGroup({ name: "n".repeat(GROUP_NAME_MAX) })])[0].name.length, GROUP_NAME_MAX);
    assert.equal(saveGroups([userGroup({ name: ` ${"n".repeat(GROUP_NAME_MAX)} ` })])[0].name.length, GROUP_NAME_MAX);
    assert.deepEqual(saveGroups([userGroup({ name: "n".repeat(GROUP_NAME_MAX + 1) })]), INVALID_GROUPS);
    // Counted in characters, not UTF-16 units.
    assert.equal(saveGroups([userGroup({ name: "\u{1F3AE}".repeat(GROUP_NAME_MAX) })]).length, 1);
  });

  test("the whole list must fit the 8 KB sync quota", () => {
    const long = (group, index) => `${"x".repeat(40)}-${group}-${index}.com`;
    const heavy = Array.from({ length: 4 }, (_, group) =>
      userGroup({ id: `g_heavy${group}`, domains: Array.from({ length: 60 }, (_, index) => long(group, index)) }));
    assert.ok(JSON.stringify(heavy).length > SYNC_ITEM_QUOTA);
    assert.deepEqual(saveGroups(heavy), INVALID_GROUPS);
  });

  const invalid = {
    "not a list": "social",
    "a list holding a non object": [userGroup(), null],
    "a missing id": [userGroup({ id: undefined })],
    "an empty id": [userGroup({ id: "" })],
    "an id with spaces": [userGroup({ id: "g work" })],
    "an id over 64 characters": [userGroup({ id: `g_${"a".repeat(63)}` })],
    "a duplicated id": [userGroup(), userGroup({ name: "Copy" })],
    "an unknown preset": [userGroup({ preset: "gaming" })],
    "a non string preset": [userGroup({ preset: 1 })],
    "a user group without a name": [userGroup({ name: "" })],
    "a user group whose name is only spaces": [userGroup({ name: "   " })],
    "a user group with no name key": [userGroup({ name: undefined })],
    "a non string name": [userGroup({ name: 42 })],
    "an unknown icon": [userGroup({ icon: "rocket" })],
    "a missing icon": [userGroup({ icon: undefined })],
    "an invalid domain": [userGroup({ domains: ["slack.com", "not a domain"] })],
    "a non string domain": [userGroup({ domains: ["slack.com", 7] })],
    "domains that are not a list": [userGroup({ domains: "slack.com" })],
    "missing domains": [userGroup({ domains: undefined })],
    "enabled as a string": [userGroup({ enabled: "true" })],
    "enabled missing": [userGroup({ enabled: undefined })],
  };

  for (const [name, groups] of Object.entries(invalid)) {
    test(`refused: ${name}`, () => {
      assert.deepEqual(saveGroups(groups), INVALID_GROUPS);
    });
  }

  test("a preset group may keep an empty name (its localized name shows)", () => {
    const [social] = saveGroups([{ ...defaultGroups("en")[0], name: "  " }]);
    assert.equal(social.name, "");
  });

  test("one invalid group refuses the whole patch, other keys included", () => {
    const patch = { goals: { items: ["Ship"], showQuote: true }, groups: [userGroup({ icon: "rocket" })] };
    assert.deepEqual(sanitizePatch(patch, mergeSettings({}, "en")), INVALID_GROUPS);
  });

  test("an unchanged list is not written again, whatever the key order", () => {
    const prev = mergeSettings({ groups: [userGroup()] }, "en");
    const reordered = [{ enabled: true, domains: ["slack.com"], icon: "chat", name: "Work chat", id: "g_work01" }];
    const sanitized = sanitizePatch({ groups: reordered }, prev);
    assert.deepEqual(pickChanged(sanitized.value, prev), {});
  });

  test("what is saved reads back unchanged", () => {
    const groups = saveGroups([...defaultGroups("en"), userGroup({ domains: ["WWW.Slack.com"] })]);
    assert.deepEqual(mergeSettings({ groups }, "fr").groups, groups);
  });
});

describe("saveSettings patch: sites (the user's own list)", () => {
  const prev = mergeSettings({}, "en");

  test("only custom is kept, V2 fields are dropped", () => {
    const patch = { sites: { categories: { social: false }, excluded: ["x.com"], custom: ["https://www.Reddit.com/r/all", "reddit.com"] } };
    assert.deepEqual(sanitizePatch(patch, prev), { ok: true, value: { sites: { custom: ["reddit.com"] } } });
  });

  test("a missing custom list keeps the stored one", () => {
    const stored = mergeSettings({ sites: { custom: ["x.com"] } }, "en");
    assert.deepEqual(sanitizePatch({ sites: {} }, stored), { ok: true, value: { sites: { custom: ["x.com"] } } });
  });

  test("invalid entries, limits and malformed values", () => {
    assert.deepEqual(sanitizePatch({ sites: { custom: ["x.com", "nope"] } }, prev), { ok: false, reason: "invalid_domain" });
    const tooMany = Array.from({ length: MAX_CUSTOM_DOMAINS + 1 }, (_, index) => `s${index}.com`);
    assert.deepEqual(sanitizePatch({ sites: { custom: tooMany } }, prev), { ok: false, reason: "too_many_domains" });
    assert.deepEqual(sanitizePatch({ sites: ["x.com"] }, prev), { ok: false, reason: "invalid_request" });
  });

  test("the popup's Block this site patch is accepted", () => {
    const stored = mergeSettings({ sites: { custom: ["x.com"] } }, "en");
    const patch = { sites: { custom: [...stored.sites.custom, "news.ycombinator.com"] } };
    assert.deepEqual(sanitizePatch(patch, stored).value, { sites: { custom: ["x.com", "news.ycombinator.com"] } });
  });
});

describe("saveSettings patch: goals (one goal)", () => {
  const prev = mergeSettings({}, "en");

  test("exactly one item, cut to GOAL_MAX_LENGTH characters", () => {
    assert.deepEqual(sanitizePatch({ goals: { items: ["Ship the beta"], showQuote: false } }, prev).value, {
      goals: { items: ["Ship the beta"], showQuote: false },
    });
    const long = "g".repeat(GOAL_MAX_LENGTH + 10);
    assert.deepEqual(sanitizePatch({ goals: { items: [long] } }, prev).value.goals.items, ["g".repeat(GOAL_MAX_LENGTH)]);
  });

  test("extra items are ignored, missing ones become empty", () => {
    assert.deepEqual(sanitizePatch({ goals: { items: ["a", "b", "c"] } }, prev).value.goals.items, ["a"]);
    assert.deepEqual(sanitizePatch({ goals: { items: [] } }, prev).value.goals.items, [""]);
    assert.deepEqual(sanitizePatch({ goals: { items: [42] } }, prev).value.goals.items, [""]);
  });

  test("a missing list keeps the stored goal, a missing flag keeps the stored one", () => {
    const stored = mergeSettings({ goals: { items: ["Run"], showQuote: false } }, "en");
    assert.deepEqual(sanitizePatch({ goals: {} }, stored).value.goals, { items: ["Run"], showQuote: false });
  });

  test("a blank goal is stored empty, spaces around a real one are kept (autosave while typing)", () => {
    assert.deepEqual(sanitizePatch({ goals: { items: ["   "] } }, prev).value.goals.items, [""]);
    assert.deepEqual(sanitizePatch({ goals: { items: ["Ship "] } }, prev).value.goals.items, ["Ship "]);
  });
});

describe("completeMigration (V2 settings stored in sync)", () => {
  const legacy = {
    sites: { categories: { social: false, video: true }, excluded: ["youtube.com"], custom: ["x.com"] },
    goals: { items: ["", "Ship", ""], showQuote: true },
  };
  const settings = mergeSettings(legacy, "en");

  test("writing sites also stores the migrated groups (the old fields would be lost otherwise)", () => {
    const changes = { sites: { custom: ["x.com", "y.com"] } };
    assert.deepEqual(completeMigration(changes, legacy, settings), { groups: settings.groups, sites: { custom: ["x.com", "y.com"] } });
    const video = settings.groups.find((group) => group.id === "video");
    assert.equal(video.enabled, true);
    assert.ok(!video.domains.includes("youtube.com"));
  });

  test("writing groups also cleans the old sites fields", () => {
    const groups = settings.groups.map((group) => ({ ...group, enabled: true }));
    assert.deepEqual(completeMigration({ groups }, legacy, settings), { groups, sites: { custom: ["x.com"] } });
  });

  test("other keys, or settings already migrated, are written as they are", () => {
    const goals = { goals: { items: ["Ship"], showQuote: true } };
    assert.equal(completeMigration(goals, legacy, settings), goals);
    const migrated = { ...legacy, groups: settings.groups };
    const sites = { sites: { custom: [] } };
    assert.equal(completeMigration(sites, migrated, mergeSettings(migrated, "en")), sites);
    const fresh = {};
    assert.equal(completeMigration(sites, fresh, mergeSettings(fresh, "en")), sites);
    assert.equal(completeMigration(sites, undefined, mergeSettings(undefined, "en")), sites);
  });

  test("the extra key is the unchanged merged value, so the lock still passes", () => {
    const changes = { sites: { custom: ["x.com", "y.com"] } };
    const written = completeMigration(changes, legacy, settings);
    const view = (value) => ({ groups: value.groups, sites: value.sites, schedules: value.schedules, unlock: value.unlock });
    assert.deepEqual(checkChange(view(settings), view({ ...settings, ...written }), true), { ok: true });
  });

  test("after the write, the settings read back the same", () => {
    const written = completeMigration({ sites: { custom: ["x.com"] } }, legacy, settings);
    const stored = { ...legacy, ...written };
    assert.deepEqual(mergeSettings(stored, "en"), settings);
  });
});

describe("strict snapshot (resolveBlock)", () => {
  test("no snapshot and no block: nothing to store", () => {
    const now = monday(8);
    const result = resolveBlock({ now, schedules: [MORNING], session: null, domains: ["x.com"], strict: null });
    assert.deepEqual(result.block, blockState(now, { schedules: [MORNING], session: null }));
    assert.equal(result.block.active, false);
    assert.equal(result.strict, null);
    assert.deepEqual(result.domains, ["x.com"]);
  });

  test("an active block is snapshotted with its domains and its end", () => {
    const now = monday(10);
    const result = resolveBlock({ now, schedules: [MORNING], session: null, domains: ["reddit.com", "x.com"], strict: null });
    assert.deepEqual(result.block, blockState(now, { schedules: [MORNING] }));
    assert.deepEqual(result.strict, { domains: ["reddit.com", "x.com"], until: monday(12) });
  });

  test("the snapshot written by the previous reconcile changes nothing", () => {
    const input = { schedules: [MORNING], session: null, domains: ["reddit.com", "x.com"] };
    const first = resolveBlock({ ...input, now: monday(10), strict: null });
    const second = resolveBlock({ ...input, now: monday(10, 5), strict: first.strict });
    assert.deepEqual(second.block, blockState(monday(10, 5), { schedules: [MORNING] }));
    assert.deepEqual(second.domains, first.domains);
    assert.deepEqual(second.strict, first.strict);
  });

  test("a schedule removed behind the lock keeps the block and its domains until the snapshot end", () => {
    const strict = { domains: ["reddit.com", "x.com"], until: monday(12) };
    const result = resolveBlock({ now: monday(10, 30), schedules: [], session: null, domains: ["x.com"], strict });
    assert.equal(result.block.active, true);
    assert.equal(result.block.until, monday(12));
    assert.equal(result.block.source, "schedule");
    assert.equal(result.block.nextStart, null);
    assert.deepEqual(result.domains, ["reddit.com", "x.com"]);
    assert.deepEqual(result.strict, strict);
  });

  test("a shortened schedule keeps its original end, start and label", () => {
    const strict = { domains: ["x.com"], until: monday(12) };
    const shortened = { ...MORNING, end: "11:00" };
    const result = resolveBlock({ now: monday(10, 30), schedules: [shortened], session: null, domains: ["x.com"], strict });
    assert.equal(result.block.active, true);
    assert.equal(result.block.source, "schedule");
    assert.equal(result.block.startedAt, monday(9));
    assert.equal(result.block.until, monday(12));
    assert.equal(result.strict.until, monday(12));
  });

  test("a slot starting when the snapshot ends keeps the block continuous", () => {
    const strict = { domains: ["x.com"], until: monday(12) };
    const afternoon = slot([1], "12:00", "13:30");
    const result = resolveBlock({ now: monday(10, 30), schedules: [afternoon], session: null, domains: ["x.com"], strict });
    assert.equal(result.block.active, true);
    assert.equal(result.block.until, monday(13, 30));
    assert.equal(result.strict.until, monday(13, 30));
  });

  test("a session cut short keeps its start and label, the snapshot keeps its end", () => {
    const strict = { domains: ["x.com"], until: monday(10, 45) };
    const session = { startedAt: monday(10), endsAt: monday(10, 20) };
    const result = resolveBlock({ now: monday(10, 10), schedules: [], session, domains: ["x.com"], strict });
    assert.equal(result.block.active, true);
    assert.equal(result.block.source, "session");
    assert.equal(result.block.startedAt, monday(10));
    assert.equal(result.block.until, monday(10, 45));
  });

  test("a block longer than the snapshot wins and moves the snapshot end", () => {
    const strict = { domains: ["x.com"], until: monday(10, 30) };
    const session = { startedAt: monday(10), endsAt: monday(10, 40) };
    const now = monday(10, 10);
    const result = resolveBlock({ now, schedules: [], session, domains: ["x.com"], strict });
    assert.deepEqual(result.block, blockState(now, { schedules: [], session }));
    assert.deepEqual(result.strict, { domains: ["x.com"], until: monday(10, 40) });
  });

  test("domains are the sorted union, a listed parent covers its subdomains, garbage is dropped", () => {
    const strict = {
      domains: ["mail.google.com", "reddit.com", "not a domain", 42, "https://www.Example.org/path", "localhost"],
      until: monday(12),
    };
    const result = resolveBlock({ now: monday(10), schedules: [MORNING], session: null, domains: ["google.com", "x.com"], strict });
    assert.deepEqual(result.domains, ["example.org", "google.com", "reddit.com", "x.com"]);
    assert.deepEqual(result.strict.domains, result.domains);
  });

  test("sites added during the block join the snapshot", () => {
    const strict = { domains: ["x.com"], until: monday(12) };
    const result = resolveBlock({ now: monday(10), schedules: [MORNING], session: null, domains: ["tiktok.com", "x.com"], strict });
    assert.deepEqual(result.strict.domains, ["tiktok.com", "x.com"]);
  });

  test("an expired snapshot is cleared once no block is active", () => {
    const strict = { domains: ["reddit.com"], until: monday(10) };
    for (const now of [monday(10), monday(10, 5)]) {
      const result = resolveBlock({ now, schedules: [], session: null, domains: ["x.com"], strict });
      assert.equal(result.block.active, false);
      assert.equal(result.strict, null);
      assert.deepEqual(result.domains, ["x.com"]);
    }
  });

  test("an expired snapshot never leaks its domains into the next block", () => {
    const strict = { domains: ["reddit.com"], until: monday(9) };
    const session = { startedAt: monday(10), endsAt: monday(10, 30) };
    const result = resolveBlock({ now: monday(10, 5), schedules: [], session, domains: ["x.com"], strict });
    assert.deepEqual(result.domains, ["x.com"]);
    assert.deepEqual(result.strict, { domains: ["x.com"], until: monday(10, 30) });
  });

  test("malformed snapshots are ignored", () => {
    const now = monday(8);
    for (const strict of [undefined, null, "strict", 42, [], {}, { until: "soon" }, { until: Number.NaN }, { domains: ["x.com"] }]) {
      const result = resolveBlock({ now, schedules: [], session: null, domains: ["x.com"], strict });
      assert.equal(result.block.active, false, JSON.stringify(strict));
      assert.equal(result.strict, null);
    }
  });

  test("a snapshot without usable domains still keeps the block", () => {
    const result = resolveBlock({ now: monday(10), schedules: [], session: null, domains: ["x.com"], strict: { domains: "x", until: monday(11) } });
    assert.equal(result.block.active, true);
    assert.deepEqual(result.strict, { domains: ["x.com"], until: monday(11) });
  });

  test("a snapshot end beyond the lookahead is clamped like any block end", () => {
    const now = monday(10);
    const horizon = now + LOOKAHEAD_DAYS * DAY;
    assert.equal(liveStrict({ domains: [], until: now + 30 * DAY }, now).until, horizon);
    const result = resolveBlock({ now, schedules: [], session: null, domains: ["x.com"], strict: { domains: [], until: now + 30 * DAY } });
    assert.equal(result.block.until, horizon);
    assert.equal(result.strict.until, horizon);
  });

  test("liveStrict is null from the end instant on", () => {
    const strict = { domains: ["x.com"], until: monday(12) };
    assert.deepEqual(liveStrict(strict, monday(12) - 1), strict);
    assert.equal(liveStrict(strict, monday(12)), null);
  });
});

describe("unionDomains", () => {
  test("dedupes, sorts and drops subdomains of listed parents", () => {
    assert.deepEqual(
      unionDomains(["x.com", "mail.google.com", "a.b.example.org"], ["google.com", "x.com", "example.org"], null),
      ["example.org", "google.com", "x.com"],
    );
    assert.deepEqual(unionDomains(), []);
  });
});

describe("unlock sentence validation", () => {
  const SENTENCE = "I am choosing my goals over a few minutes of scrolling.";

  test("the sample sentence is within the limits", () => {
    assert.ok(SENTENCE.length >= PHRASE_MIN && SENTENCE.length <= PHRASE_MAX);
  });

  test("empty or blank means the default sentence", () => {
    for (const blank of ["", "   ", "\t \t"]) assert.deepEqual(validatePhrase(blank), { ok: true, value: "" });
  });

  test("surrounding whitespace is trimmed and runs of whitespace collapse to one space", () => {
    const messy = `  I am choosing\tmy goals${String.fromCodePoint(0xa0)}over  a few minutes of scrolling.  `;
    assert.deepEqual(validatePhrase(messy), { ok: true, value: SENTENCE });
    assert.equal(normalizePhrase(messy), SENTENCE);
  });

  test("length limits apply to the normalized sentence", () => {
    assert.equal(validatePhrase("a".repeat(PHRASE_MIN)).ok, true);
    assert.equal(validatePhrase("a".repeat(PHRASE_MAX)).ok, true);
    assert.deepEqual(validatePhrase("a".repeat(PHRASE_MIN - 1)), { ok: false, reason: "invalid_phrase" });
    assert.deepEqual(validatePhrase("a".repeat(PHRASE_MAX + 1)), { ok: false, reason: "invalid_phrase" });
    // 20 words of 1 letter: 39 characters once collapsed, although longer as typed.
    const spaced = Array.from({ length: 20 }, () => "a").join("   ");
    assert.ok(spaced.length > PHRASE_MIN);
    assert.equal(validatePhrase(spaced).ok, false);
  });

  test("line breaks inside the sentence are refused", () => {
    const breaks = ["\n", "\r\n", "\r", String.fromCodePoint(0x2028), String.fromCodePoint(0x2029)];
    for (const lineBreak of breaks) {
      const text = `I am choosing my goals${lineBreak}over a few minutes of scrolling.`;
      assert.deepEqual(validatePhrase(text), { ok: false, reason: "invalid_phrase" }, JSON.stringify(lineBreak));
    }
  });

  test("a line break at the very start or end is trimmed like other whitespace", () => {
    assert.deepEqual(validatePhrase(`\n${SENTENCE}\r\n`), { ok: true, value: SENTENCE });
  });

  test("control characters are refused", () => {
    for (const code of [0x00, 0x07, 0x1b, 0x7f, 0x9f]) {
      const text = `I am choosing my goals${String.fromCodePoint(code)} over a few minutes of scrolling.`;
      assert.equal(validatePhrase(text).ok, false, `U+${code.toString(16)}`);
    }
  });

  test("accents, quotes and punctuation are kept as typed", () => {
    const french = "Je choisis mes objectifs plutôt que quelques minutes de défilement, c'est ça.";
    assert.deepEqual(validatePhrase(french), { ok: true, value: french });
  });

  test("non strings are refused", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      assert.deepEqual(validatePhrase(value), { ok: false, reason: "invalid_phrase" });
    }
  });

  describe("saveSettings patch", () => {
    const prev = { unlock: { phrase: "" } };

    test("a valid sentence is stored normalized", () => {
      assert.deepEqual(sanitizePatch({ unlock: { phrase: `  ${SENTENCE}  ` } }, prev), {
        ok: true,
        value: { unlock: { phrase: SENTENCE, mode: "free", amount: 5 } },
      });
    });

    test("an invalid sentence refuses the whole patch", () => {
      const patch = { goals: { items: ["Ship it"], showQuote: true }, unlock: { phrase: "Too short" } };
      assert.deepEqual(sanitizePatch(patch, prev), { ok: false, reason: "invalid_phrase" });
      assert.deepEqual(sanitizePatch({ unlock: { phrase: null } }, prev), { ok: false, reason: "invalid_phrase" });
    });

    test("an empty sentence resets to the default one", () => {
      assert.deepEqual(sanitizePatch({ unlock: { phrase: " " } }, { unlock: { phrase: SENTENCE } }), {
        ok: true,
        value: { unlock: { phrase: "", mode: "free", amount: 5 } },
      });
    });

    test("a missing phrase keeps the stored one, a malformed unlock value is refused", () => {
      assert.deepEqual(sanitizePatch({ unlock: {} }, { unlock: { phrase: SENTENCE } }), {
        ok: true,
        value: { unlock: { phrase: SENTENCE, mode: "free", amount: 5 } },
      });
      assert.deepEqual(sanitizePatch({ unlock: {} }, {}), { ok: true, value: { unlock: { phrase: "", mode: "free", amount: 5 } } });
      assert.deepEqual(sanitizePatch({ unlock: "phrase" }, prev), { ok: false, reason: "invalid_request" });
    });

    test("an unchanged sentence is not written again", () => {
      const sanitized = sanitizePatch({ unlock: { phrase: `${SENTENCE} ` } }, { unlock: { phrase: SENTENCE } });
      assert.deepEqual(pickChanged(sanitized.value, { unlock: { phrase: SENTENCE, mode: "free", amount: 5 } }), {});
    });
  });
});

describe("enforcementLists", () => {
  const now = monday(10);

  test("nothing is enforced without an active block", () => {
    assert.deepEqual(enforcementLists({ active: false, domains: ["x.com"], granted: ["x.com"], passes: {}, now }), {
      enforced: [],
      redirect: [],
      fallback: [],
      invalid: [],
    });
  });

  test("granted domains are redirected, the others fall back to a block, live passes are skipped", () => {
    const lists = enforcementLists({
      active: true,
      domains: ["facebook.com", "linkedin.com", "reddit.com", "x.com"],
      granted: ["linkedin.com", "reddit.com"],
      passes: { "reddit.com": now + MINUTE, "x.com": now },
      now,
    });
    assert.deepEqual(lists.enforced, ["facebook.com", "linkedin.com", "x.com"]);
    assert.deepEqual(lists.redirect, ["linkedin.com"]);
    assert.deepEqual(lists.fallback, ["facebook.com", "x.com"]);
    assert.deepEqual(lists.invalid, []);
  });

  test("domains that are not normalized are left out and reported", () => {
    const lists = enforcementLists({
      active: true,
      domains: ["Bad Domain", "WWW.X.COM", "x.com", "", "127.0.0.1"],
      granted: [],
      passes: {},
      now,
    });
    assert.deepEqual(lists.enforced, ["x.com"]);
    assert.deepEqual(lists.invalid, ["Bad Domain", "WWW.X.COM", "", "127.0.0.1"]);
  });
});

describe("alarm time", () => {
  const now = monday(10);
  const HEARTBEAT = HEARTBEAT_MINUTES * MINUTE;

  test("nextBadgeChange is the instant the remaining time crosses a whole minute", () => {
    assert.equal(nextBadgeChange(now, now + 25 * MINUTE), now + MINUTE);
    assert.equal(nextBadgeChange(now, now + 24 * MINUTE + 30_000), now + 30_000);
    assert.equal(nextBadgeChange(now, now + 30_000), now + 30_000);
    assert.equal(nextBadgeChange(now, now), null);
    assert.equal(nextBadgeChange(now, null), null);
  });

  test("idle without transitions: the heartbeat", () => {
    assert.equal(nextAlarmTime(now), now + HEARTBEAT);
    assert.equal(nextAlarmTime(now, { transition: now - MINUTE }), now + HEARTBEAT);
  });

  test("the earliest of transition, badge change and heartbeat", () => {
    assert.equal(nextAlarmTime(now, { transition: now + 2 * MINUTE }), now + 2 * MINUTE + ALARM_SLACK_MS);
    assert.equal(nextAlarmTime(now, { transition: now + HEARTBEAT + MINUTE }), now + HEARTBEAT);
    assert.equal(
      nextAlarmTime(now, { transition: now + 2 * MINUTE, until: now + 24 * MINUTE + 30_000 }),
      now + 30_000 + ALARM_SLACK_MS,
    );
    // Snapshot-only end (not a schedule transition): the last badge change is the end itself.
    assert.equal(nextAlarmTime(now, { until: now + 40_000 }), now + 40_000 + ALARM_SLACK_MS);
  });

  test("never sooner than the minimum delay", () => {
    assert.equal(nextAlarmTime(now, { transition: now + 10 }), now + ALARM_MIN_DELAY_MS);
  });
});

describe("storage.onChanged loop guard (local area)", () => {
  test("stats alone never trigger a reconcile", () => {
    assert.equal(localChangeNeedsReconcile({ stats: { oldValue: { blocked: 1 }, newValue: { blocked: 2 } } }), false);
  });

  test("a real change does, an unchanged value does not (whatever the key order)", () => {
    assert.equal(localChangeNeedsReconcile({ passes: { oldValue: {}, newValue: { "x.com": 1 } } }), true);
    assert.equal(
      localChangeNeedsReconcile({ session: { oldValue: { startedAt: 1, endsAt: 2 }, newValue: { endsAt: 2, startedAt: 1 } } }),
      false,
    );
    assert.equal(localChangeNeedsReconcile({ strict: { oldValue: undefined, newValue: null } }), false);
  });

  test("the echo of the worker's own write is ignored, a different value is not", () => {
    const strict = { domains: ["x.com"], until: 5 };
    const selfWrites = new Map([["strict", stableStringify(strict)]]);
    const echo = { strict: { oldValue: null, newValue: { until: 5, domains: ["x.com"] } } };
    assert.equal(localChangeNeedsReconcile(echo, selfWrites), false);
    const tampered = { strict: { oldValue: strict, newValue: null } };
    assert.equal(localChangeNeedsReconcile(tampered, selfWrites), true);
    assert.equal(localChangeNeedsReconcile({ ...echo, stats: { newValue: {} }, session: { newValue: { endsAt: 9 } } }, selfWrites), true);
  });

  test("malformed change sets are ignored", () => {
    assert.equal(localChangeNeedsReconcile(null), false);
    assert.equal(localChangeNeedsReconcile([]), false);
  });
});

describe("stableStringify", () => {
  test("ignores key order and treats undefined as null", () => {
    assert.equal(stableStringify({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: 3 } }), '{"a":{"c":3,"d":[2,{"e":0,"f":1}]},"b":1}');
    assert.equal(stableStringify(undefined), "null");
    assert.equal(stableStringify(null), "null");
  });
});
