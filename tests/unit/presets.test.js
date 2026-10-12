import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanGroupName,
  defaultGroups,
  getPreset,
  groupDisplayName,
  isGroupId,
  newGroupId,
  PRESETS,
  presetDomains,
  presetLanguage,
} from "../../extension/shared/presets.js";
import { CATEGORY_IDS, GROUP_ICONS, GROUP_NAME_MAX } from "../../extension/shared/constants.js";
import { normalizeDomain } from "../../extension/shared/domains.js";
import { ICON_NAMES } from "../../extension/shared/icons.js";

describe("PRESETS", () => {
  test("one preset per category, in the same order", () => {
    assert.deepEqual(PRESETS.map((preset) => preset.id), CATEGORY_IDS);
  });

  test("icons exist in icons.js and are group icons", () => {
    assert.deepEqual(PRESETS.map((preset) => preset.icon), ["users", "play", "mail", "news", "cart"]);
    for (const preset of PRESETS) {
      assert.ok(ICON_NAMES.includes(preset.icon), preset.icon);
      assert.ok(GROUP_ICONS.includes(preset.icon), preset.icon);
    }
  });

  test("every domain is already normalized", () => {
    for (const preset of PRESETS) {
      for (const list of Object.values(preset.domains)) {
        for (const domain of list) assert.equal(normalizeDomain(domain), domain);
      }
    }
  });

  test("messaging blocks Gmail only, never google.com", () => {
    const messaging = presetDomains("messaging", "en");
    assert.ok(messaging.includes("mail.google.com"));
    assert.ok(!PRESETS.some((preset) => Object.values(preset.domains).flat().includes("google.com")));
  });

  test("presets are frozen", () => {
    assert.ok(Object.isFrozen(PRESETS));
    assert.ok(Object.isFrozen(PRESETS[0].domains.all));
    assert.throws(() => PRESETS[0].domains.all.push("evil.com"));
  });

  test("no duplicates within a category for either language", () => {
    for (const preset of PRESETS) {
      for (const locale of ["en", "fr"]) {
        const list = presetDomains(preset, locale);
        assert.equal(new Set(list).size, list.length, `${preset.id} ${locale}`);
        assert.ok(list.length >= 5, `${preset.id} ${locale} has at least 5 sites`);
      }
    }
  });
});

describe("presetDomains", () => {
  test("news is fully localized", () => {
    const fr = presetDomains("news", "fr");
    const en = presetDomains("news", "en");
    assert.ok(fr.includes("lemonde.fr") && fr.includes("lequipe.fr"));
    assert.ok(!fr.includes("cnn.com"));
    assert.ok(en.includes("bbc.co.uk") && !en.includes("lemonde.fr"));
  });

  test("shopping combines the shared list with the localized one", () => {
    const fr = presetDomains("shopping", "fr");
    const en = presetDomains("shopping", "en");
    for (const domain of ["amazon.com", "ebay.com"]) assert.ok(fr.includes(domain) && en.includes(domain));
    assert.ok(fr.includes("vinted.fr") && !fr.includes("etsy.com"));
    assert.ok(en.includes("etsy.com") && !en.includes("vinted.fr"));
  });

  test("locale variants map to fr or en", () => {
    assert.deepEqual(presetDomains("news", "fr-CA"), presetDomains("news", "fr"));
    assert.deepEqual(presetDomains("news", "fr_FR"), presetDomains("news", "fr"));
    assert.deepEqual(presetDomains("news", "FR"), presetDomains("news", "fr"));
    assert.deepEqual(presetDomains("news", "de"), presetDomains("news", "en"));
    assert.deepEqual(presetDomains("news", "fry"), presetDomains("news", "en"));
    assert.deepEqual(presetDomains("news", undefined), presetDomains("news", "en"));
    assert.equal(presetLanguage("fr-BE"), "fr");
    assert.equal(presetLanguage("en-GB"), "en");
  });

  test("accepts a preset object or an id", () => {
    assert.deepEqual(presetDomains(getPreset("video"), "en"), presetDomains("video", "en"));
    assert.equal(getPreset("unknown"), null);
  });

  test("unknown presets give an empty list", () => {
    assert.deepEqual(presetDomains("unknown", "en"), []);
    assert.deepEqual(presetDomains(null, "en"), []);
    assert.deepEqual(presetDomains({ id: "x" }, "en"), []);
  });

  test("returns a fresh array every time", () => {
    const list = presetDomains("social", "en");
    list.push("mutated.com");
    assert.ok(!presetDomains("social", "en").includes("mutated.com"));
  });
});

describe("defaultGroups", () => {
  test("the 5 presets in order, social on, with their localized domains", () => {
    for (const locale of ["en", "fr"]) {
      const groups = defaultGroups(locale);
      assert.deepEqual(
        groups,
        PRESETS.map((preset) => ({
          id: preset.id,
          preset: preset.id,
          name: "",
          icon: preset.icon,
          domains: presetDomains(preset, locale),
          enabled: preset.id === "social",
        })),
      );
    }
  });

  test("keys come in the stored order (id, preset, name, icon, domains, enabled)", () => {
    for (const group of defaultGroups("en")) {
      assert.deepEqual(Object.keys(group), ["id", "preset", "name", "icon", "domains", "enabled"]);
    }
  });

  test("news and shopping follow the locale, unknown locales get English", () => {
    const domainsOf = (locale, id) => defaultGroups(locale).find((group) => group.id === id).domains;
    assert.ok(domainsOf("fr", "news").includes("lemonde.fr"));
    assert.ok(domainsOf("en", "news").includes("cnn.com"));
    assert.ok(domainsOf("fr-CA", "shopping").includes("vinted.fr"));
    assert.deepEqual(domainsOf(undefined, "news"), domainsOf("en", "news"));
    assert.deepEqual(domainsOf("de", "shopping"), domainsOf("en", "shopping"));
  });

  test("returns fresh, mutable objects every time", () => {
    const first = defaultGroups("en");
    first[0].enabled = false;
    first[0].domains.push("mutated.com");
    const second = defaultGroups("en");
    assert.equal(second[0].enabled, true);
    assert.ok(!second[0].domains.includes("mutated.com"));
    assert.ok(!presetDomains("social", "en").includes("mutated.com"));
  });

  test("fits far below the 8 KB sync quota in both languages", () => {
    for (const locale of ["en", "fr"]) {
      const bytes = new TextEncoder().encode(`groups${JSON.stringify(defaultGroups(locale))}`).length;
      assert.ok(bytes < 4096, `${locale}: ${bytes} bytes`);
    }
  });
});

describe("groupDisplayName", () => {
  const translate = (key) => `<${key}>`;

  test("the user's name wins", () => {
    assert.equal(groupDisplayName({ id: "social", preset: "social", name: "Doomscroll", icon: "users" }, translate), "Doomscroll");
    assert.equal(groupDisplayName({ id: "g_abc123", name: "Work chat" }, translate), "Work chat");
  });

  test("a preset group without a name shows the localized preset name", () => {
    assert.equal(groupDisplayName({ id: "video", preset: "video", name: "" }, translate), "<category_video>");
    assert.equal(groupDisplayName({ id: "news", preset: "news" }, translate), "<category_news>");
  });

  test("a user group without a name gives an empty string", () => {
    assert.equal(groupDisplayName({ id: "g_abc123", name: "" }, translate), "");
  });

  test("bad input never throws", () => {
    assert.equal(groupDisplayName(null, translate), "");
    assert.equal(groupDisplayName(undefined, translate), "");
    assert.equal(groupDisplayName({ preset: "social", name: 42 }, translate), "<category_social>");
    assert.equal(groupDisplayName({ preset: "social" }, undefined), "");
  });
});

describe("newGroupId", () => {
  test("g_ followed by 8 base36 characters, and a valid group id", () => {
    for (let index = 0; index < 200; index++) {
      const id = newGroupId();
      assert.match(id, /^g_[0-9a-z]{8}$/);
      assert.ok(isGroupId(id), id);
    }
  });

  test("ids do not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newGroupId()));
    assert.equal(ids.size, 1000);
  });

  test("never collides with a preset id", () => {
    for (let index = 0; index < 100; index++) assert.ok(!CATEGORY_IDS.includes(newGroupId()));
  });

  test("falls back to Math.random without crypto.getRandomValues", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    try {
      assert.match(newGroupId(), /^g_[0-9a-z]{8}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", descriptor);
    }
    assert.equal(typeof globalThis.crypto.getRandomValues, "function");
  });
});

describe("isGroupId", () => {
  test("preset ids and generated ids are valid", () => {
    for (const id of [...CATEGORY_IDS, "g_k3j2x9", "g_0123456789", "a", "A-b_9", "x".repeat(64)]) {
      assert.ok(isGroupId(id), id);
    }
  });

  test("anything else is not", () => {
    for (const id of ["", " ", "g k3", "g_é", "<b>", "a\"b", "x".repeat(65), null, undefined, 42, {}, ["social"]]) {
      assert.equal(isGroupId(id), false, JSON.stringify(id));
    }
  });
});

describe("cleanGroupName", () => {
  test("trims and turns control characters into spaces", () => {
    assert.equal(cleanGroupName("  Work chat  "), "Work chat");
    assert.equal(cleanGroupName("Work\nchat"), "Work chat");
    assert.equal(cleanGroupName("\tDeep\u0000work\u007f"), "Deep work");
    assert.equal(cleanGroupName("Café ☕"), "Café ☕");
  });

  test("non strings give an empty name", () => {
    for (const value of [undefined, null, 42, {}, []]) assert.equal(cleanGroupName(value), "");
  });

  test("does not cut long names (the callers apply GROUP_NAME_MAX)", () => {
    const long = "a".repeat(GROUP_NAME_MAX + 5);
    assert.equal(cleanGroupName(long), long);
  });
});
