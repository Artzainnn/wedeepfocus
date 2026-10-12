import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkChange } from "../../extension/shared/lock.js";

const PHRASE = "I close this tab and go back to the thing that actually matters to me today.";

function base() {
  return {
    groups: [
      { id: "social", preset: "social", name: "", icon: "users", domains: ["facebook.com", "linkedin.com", "x.com"], enabled: true },
      { id: "video", preset: "video", name: "", icon: "play", domains: ["youtube.com", "netflix.com"], enabled: false },
      { id: "g_work01", name: "Work chat", icon: "chat", domains: ["slack.com"], enabled: true },
      { id: "g_games1", name: "Games", icon: "game", domains: ["steampowered.com", "chess.com"], enabled: false },
    ],
    sites: { custom: ["example.com", "lequipe.fr"] },
    schedules: [
      { id: "s_a", days: [1, 2, 3, 4, 5], start: "07:00", end: "14:00", enabled: true },
      { id: "s_b", days: [6], start: "22:00", end: "02:00", enabled: false },
    ],
    unlock: { phrase: PHRASE },
  };
}

function edit(mutate, from = base()) {
  const next = structuredClone(from);
  mutate(next);
  return next;
}

function byId(settings, id) {
  return settings.groups.find((group) => group.id === id);
}

const OK = { ok: true };

describe("checkChange when no block is active", () => {
  test("everything is allowed", () => {
    const next = edit((s) => {
      byId(s, "social").enabled = false;
      byId(s, "g_work01").domains = [];
      s.groups = s.groups.filter((group) => group.id !== "g_work01");
      s.sites.custom = [];
      s.schedules = [];
      s.unlock.phrase = "";
    });
    assert.deepEqual(checkChange(base(), next, false), OK);
    assert.deepEqual(checkChange(base(), { groups: [] }, false), OK);
  });
});

describe("checkChange during an active block: allowed changes", () => {
  const allowed = {
    "no change at all": () => {},
    "enabling a preset group": (s) => {
      byId(s, "video").enabled = true;
    },
    "enabling a user group": (s) => {
      byId(s, "g_games1").enabled = true;
    },
    "creating an enabled group": (s) => {
      s.groups.push({ id: "g_new0001", name: "News", icon: "news", domains: ["lemonde.fr"], enabled: true });
    },
    "creating a disabled group": (s) => {
      s.groups.push({ id: "g_new0001", name: "Later", icon: "star", domains: [], enabled: false });
    },
    "adding a site to an enabled group": (s) => {
      byId(s, "social").domains.push("reddit.com");
    },
    "adding a site to a disabled group": (s) => {
      byId(s, "video").domains.push("twitch.tv");
    },
    "renaming a preset group": (s) => {
      byId(s, "social").name = "Doomscrolling";
    },
    "renaming a user group": (s) => {
      byId(s, "g_work01").name = "Slack";
    },
    "changing an icon": (s) => {
      byId(s, "g_work01").icon = "briefcase";
      byId(s, "social").icon = "heart";
    },
    "reordering groups": (s) => {
      s.groups.reverse();
    },
    "reordering the sites of an enabled group": (s) => {
      byId(s, "social").domains.reverse();
    },
    "writing a site of an enabled group differently": (s) => {
      byId(s, "social").domains = ["https://www.Facebook.com/", "LINKEDIN.COM", "x.com"];
    },
    "deleting a disabled group": (s) => {
      s.groups = s.groups.filter((group) => group.id !== "g_games1");
    },
    "deleting a disabled preset group": (s) => {
      s.groups = s.groups.filter((group) => group.id !== "video");
    },
    "removing a site from a disabled group": (s) => {
      byId(s, "g_games1").domains = ["chess.com"];
    },
    "emptying a disabled group": (s) => {
      byId(s, "video").domains = [];
    },
    "enabling a disabled group while removing some of its sites": (s) => {
      const video = byId(s, "video");
      video.enabled = true;
      video.domains = ["youtube.com"];
    },
    "adding a custom site": (s) => {
      s.sites.custom.push("reddit.com");
    },
    "re-adding the same custom site written differently": (s) => {
      s.sites.custom = ["https://www.Example.com/", "LEQUIPE.fr"];
    },
    "adding a new schedule": (s) => {
      s.schedules.push({ id: "s_new", days: [0], start: "10:00", end: "11:00", enabled: true });
    },
    "turning an existing disabled schedule on (it only blocks more)": (s) => {
      s.schedules[1].enabled = true;
    },
    "turning a disabled schedule on by dropping the enabled flag (enabled is the default)": (s) => {
      delete s.schedules[1].enabled;
    },
    "turning a disabled schedule on and adding a new one": (s) => {
      s.schedules[1].enabled = true;
      s.schedules.push({ id: "s_new", days: [2], start: "18:00", end: "19:00", enabled: true });
    },
    "reordering schedules": (s) => {
      s.schedules.reverse();
    },
    "reordering the days of a schedule": (s) => {
      s.schedules[0].days = [5, 4, 3, 2, 1];
    },
    "writing the same time differently": (s) => {
      s.schedules[0].start = "7:00";
    },
    "changing goals and prefs": (s) => {
      s.goals = { items: ["Ship the beta"], showQuote: false };
      s.prefs = { onboarded: true };
    },
    "sending the same unlock sentence again": (s) => {
      s.unlock = { phrase: PHRASE };
    },
    "the same unlock sentence with different spacing (stored trimmed and collapsed)": (s) => {
      s.unlock.phrase = `  ${PHRASE.replace(/ /g, "  ")}\t`;
    },
  };

  for (const [name, mutate] of Object.entries(allowed)) {
    test(name, () => {
      assert.deepEqual(checkChange(base(), edit(mutate), true), OK);
    });
  }

  test("a patch without groups, sites, schedules or unlock keys leaves them unchanged", () => {
    assert.deepEqual(checkChange(base(), { goals: { items: [""], showQuote: true } }, true), OK);
    assert.deepEqual(checkChange(base(), {}, true), OK);
    const withoutUnlock = edit((s) => {
      delete s.unlock;
    });
    assert.deepEqual(checkChange(base(), withoutUnlock, true), OK);
    const withoutGroups = edit((s) => {
      delete s.groups;
    });
    assert.deepEqual(checkChange(base(), withoutGroups, true), OK);
  });

  test("groups are matched by id, not by position", () => {
    const next = edit((s) => {
      s.groups = [byId(s, "g_games1"), byId(s, "g_work01"), byId(s, "video"), byId(s, "social")];
      byId(s, "video").enabled = true;
    });
    assert.deepEqual(checkChange(base(), next, true), OK);
  });

  test("the default sentence stays allowed when neither side has a custom one", () => {
    const prev = edit((s) => {
      s.unlock = { phrase: "" };
    });
    for (const unlock of [{ phrase: "" }, { phrase: "   " }, {}, null]) {
      assert.deepEqual(checkChange(prev, { ...prev, unlock }, true), OK, JSON.stringify(unlock));
    }
  });
});

describe("checkChange during an active block: refused changes", () => {
  const refused = {
    lock_group: {
      "disabling an enabled preset group": (s) => {
        byId(s, "social").enabled = false;
      },
      "disabling an enabled user group": (s) => {
        byId(s, "g_work01").enabled = false;
      },
      "deleting an enabled group": (s) => {
        s.groups = s.groups.filter((group) => group.id !== "g_work01");
      },
      "deleting an enabled preset group": (s) => {
        s.groups = s.groups.filter((group) => group.id !== "social");
      },
      "deleting every group": (s) => {
        s.groups = [];
      },
      "changing the id of an enabled group (deleted, then created)": (s) => {
        byId(s, "g_work01").id = "g_work02";
      },
      "setting enabled to a truthy non boolean": (s) => {
        byId(s, "social").enabled = "yes";
      },
      "dropping the enabled flag of an enabled group": (s) => {
        delete byId(s, "g_work01").enabled;
      },
      "swapping: turning one group off and another on": (s) => {
        byId(s, "social").enabled = false;
        byId(s, "video").enabled = true;
      },
      "deleting an enabled group after copying its sites to the user's own sites": (s) => {
        s.sites.custom.push("slack.com");
        s.groups = s.groups.filter((group) => group.id !== "g_work01");
      },
      "replacing groups with null": (s) => {
        s.groups = null;
      },
      "replacing groups with an object": (s) => {
        s.groups = { social: byId(s, "social") };
      },
    },
    lock_group_site: {
      "removing a site from an enabled preset group": (s) => {
        byId(s, "social").domains = ["facebook.com", "x.com"];
      },
      "removing the only site of an enabled user group": (s) => {
        byId(s, "g_work01").domains = [];
      },
      "replacing a site of an enabled group by another one": (s) => {
        byId(s, "social").domains = ["facebook.com", "linkedin.com", "reddit.com"];
      },
      "moving a site from an enabled group to another enabled group": (s) => {
        byId(s, "social").domains = ["facebook.com", "linkedin.com"];
        byId(s, "g_work01").domains.push("x.com");
      },
      "removing a site while renaming the group": (s) => {
        const work = byId(s, "g_work01");
        work.name = "Renamed";
        work.icon = "briefcase";
        work.domains = [];
      },
      "replacing the sites of an enabled group with a non array": (s) => {
        byId(s, "social").domains = "facebook.com linkedin.com x.com";
      },
    },
    lock_custom: {
      "removing a custom site": (s) => {
        s.sites.custom = ["example.com"];
      },
      "clearing custom sites": (s) => {
        s.sites.custom = [];
      },
      "replacing a custom site by another one": (s) => {
        s.sites.custom = ["example.com", "reddit.com"];
      },
      "moving a custom site into an enabled group": (s) => {
        s.sites.custom = ["example.com"];
        byId(s, "social").domains.push("lequipe.fr");
      },
      "replacing sites with null": (s) => {
        s.sites = null;
      },
    },
    lock_schedule: {
      "deleting a schedule": (s) => {
        s.schedules = [s.schedules[0]];
      },
      "deleting a disabled schedule": (s) => {
        s.schedules = [s.schedules[0]];
      },
      "disabling a schedule": (s) => {
        s.schedules[0].enabled = false;
      },
      "turning a disabled schedule on while changing its times": (s) => {
        s.schedules[1].enabled = true;
        s.schedules[1].end = "01:00";
      },
      "turning a disabled schedule on while changing its days": (s) => {
        s.schedules[1].enabled = true;
        s.schedules[1].days = [5, 6];
      },
      "editing a disabled schedule that stays disabled": (s) => {
        s.schedules[1].start = "21:00";
      },
      "changing the start time": (s) => {
        s.schedules[0].start = "08:00";
      },
      "changing the end time, even to make it longer": (s) => {
        s.schedules[0].end = "18:00";
      },
      "removing a day": (s) => {
        s.schedules[0].days = [1, 2, 3, 4];
      },
      "adding a day": (s) => {
        s.schedules[0].days = [1, 2, 3, 4, 5, 6];
      },
      "changing the id": (s) => {
        s.schedules[0].id = "s_other";
      },
      "clearing all schedules": (s) => {
        s.schedules = [];
      },
    },
    lock_phrase: {
      "changing the unlock sentence": (s) => {
        s.unlock.phrase = "Something completely different that is also long enough to be valid.";
      },
      "making the unlock sentence longer (any change is refused)": (s) => {
        s.unlock.phrase = `${PHRASE} And I mean it, every single time.`;
      },
      "resetting the unlock sentence to the default": (s) => {
        s.unlock.phrase = "";
      },
      "changing only the letter case": (s) => {
        s.unlock.phrase = PHRASE.toUpperCase();
      },
      "removing a word": (s) => {
        s.unlock.phrase = PHRASE.replace(" actually", "");
      },
      "replacing unlock with null": (s) => {
        s.unlock = null;
      },
      "replacing the phrase with a non string": (s) => {
        s.unlock = { phrase: 42 };
      },
    },
  };

  for (const [reason, cases] of Object.entries(refused)) {
    for (const [name, mutate] of Object.entries(cases)) {
      test(`${name} -> ${reason}`, () => {
        assert.deepEqual(checkChange(base(), edit(mutate), true), { ok: false, reason });
      });
    }
  }

  test("setting a custom sentence while the default one is used -> lock_phrase", () => {
    const prev = edit((s) => {
      s.unlock.phrase = "";
    });
    assert.deepEqual(checkChange(prev, base(), true), { ok: false, reason: "lock_phrase" });
  });

  test("the first failing rule is reported (group, group site, custom, schedule, phrase)", () => {
    const everything = edit((s) => {
      s.unlock.phrase = "";
      s.schedules = [];
      s.sites.custom = [];
      byId(s, "social").domains = [];
      byId(s, "g_work01").enabled = false;
    });
    assert.deepEqual(checkChange(base(), everything, true), { ok: false, reason: "lock_group" });
    const fromGroupSite = edit((s) => {
      s.unlock.phrase = "";
      s.schedules = [];
      s.sites.custom = [];
      byId(s, "social").domains = [];
    });
    assert.deepEqual(checkChange(base(), fromGroupSite, true), { ok: false, reason: "lock_group_site" });
    const fromCustom = edit((s) => {
      s.unlock.phrase = "";
      s.schedules = [];
      s.sites.custom = [];
    });
    assert.deepEqual(checkChange(base(), fromCustom, true), { ok: false, reason: "lock_custom" });
    const scheduleAndPhrase = edit((s) => {
      s.unlock.phrase = "";
      s.schedules[0].enabled = false;
    });
    assert.deepEqual(checkChange(base(), scheduleAndPhrase, true), { ok: false, reason: "lock_schedule" });
  });

  test("with a duplicated id, the first group decides (mergeSettings keeps the first one)", () => {
    const disabledFirst = edit((s) => {
      s.groups.unshift({ ...byId(s, "social"), enabled: false });
    });
    assert.deepEqual(checkChange(base(), disabledFirst, true), { ok: false, reason: "lock_group" });
    const disabledCopyAfter = edit((s) => {
      s.groups.push({ ...byId(s, "social"), enabled: false, domains: [] });
    });
    assert.deepEqual(checkChange(base(), disabledCopyAfter, true), OK);
  });

  test("schedules without an id must survive unchanged", () => {
    const prev = { ...base(), schedules: [{ days: [1], start: "07:00", end: "08:00" }] };
    assert.deepEqual(checkChange(prev, { ...prev, schedules: [{ days: [1], start: "07:00", end: "08:00", id: "s_x" }] }, true), OK);
    assert.deepEqual(checkChange(prev, { ...prev, schedules: [] }, true), { ok: false, reason: "lock_schedule" });
  });

  test("a previous state without unlock counts as the default sentence", () => {
    const legacy = edit((s) => {
      delete s.unlock;
    });
    assert.deepEqual(checkChange(legacy, { ...legacy, unlock: { phrase: "" } }, true), OK);
    assert.deepEqual(checkChange(legacy, base(), true), { ok: false, reason: "lock_phrase" });
  });

  test("malformed entries never throw", () => {
    const prev = edit((s) => {
      s.groups.push(null, 42, "social", { enabled: true, domains: "x" });
    });
    assert.deepEqual(checkChange(prev, prev, true), OK);
    assert.deepEqual(checkChange(undefined, undefined, true), OK);
    assert.deepEqual(checkChange(null, { groups: [], sites: { custom: ["x.com"] }, schedules: [] }, true), OK);
    // From nothing, everything is an addition, except the custom sentence replacing the default one.
    assert.deepEqual(checkChange(null, base(), true), { ok: false, reason: "lock_phrase" });
    assert.deepEqual(checkChange(null, { ...base(), unlock: { phrase: "" } }, true), OK);
  });
});
