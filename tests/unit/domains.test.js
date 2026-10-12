import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  domainsForOrigins,
  effectiveDomains,
  findBlockingDomain,
  hostMatches,
  normalizeDomain,
  originPatterns,
} from "../../extension/shared/domains.js";
import { defaultGroups, presetDomains } from "../../extension/shared/presets.js";
import { mergeSettings } from "../../extension/shared/storage.js";

function group(id, domains, enabled = true) {
  return { id, name: id, icon: "star", domains, enabled };
}

function settings({ groups = [], custom = [] } = {}) {
  return { groups, sites: { custom } };
}

describe("normalizeDomain", () => {
  const valid = {
    "https://www.LinkedIn.com/feed": "linkedin.com",
    "linkedin.com": "linkedin.com",
    "LINKEDIN.COM": "linkedin.com",
    "http://user:pass@sub.example.co.uk:8080/path?q=1#top": "sub.example.co.uk",
    "example.com.": "example.com",
    "www.example.com": "example.com",
    "WWW.Example.COM/": "example.com",
    "www2.example.com": "www2.example.com",
    "www.com": "www.com",
    "m.youtube.com": "m.youtube.com",
    "  reddit.com/r/all  ": "reddit.com",
    "*.reddit.com": "reddit.com",
    ".reddit.com": "reddit.com",
    "//reddit.com/x": "reddit.com",
    "ftp://files.example.org": "files.example.org",
    "HTTPS://Mail.Google.com/mail/u/0/#inbox": "mail.google.com",
    "example.com?x=1": "example.com",
    "example.com#hash": "example.com",
    "example.com:443": "example.com",
    "münchen.de": "xn--mnchen-3ya.de",
    "https://www.bücher.de/": "xn--bcher-kva.de",
    "xn--mnchen-3ya.de": "xn--mnchen-3ya.de",
    "例え.jp": "xn--r8jz45g.jp",
    "EXAMPLE\u3002COM": "example.com",
    "my_blog.example.com": "my_blog.example.com",
    "bsky.app": "bsky.app",
    "news.ycombinator.com": "news.ycombinator.com",
    "https://www.google.com/search?q=hello world": "google.com",
    "evil.com/@linkedin.com": "evil.com",
    "linkedin.com\\feed": "linkedin.com",
    "user@linkedin.com": "linkedin.com",
  };

  for (const [input, expected] of Object.entries(valid)) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(normalizeDomain(input), expected);
    });
  }

  const invalid = [
    "",
    "   ",
    null,
    undefined,
    42,
    {},
    "linkedin",
    "localhost",
    "localhost:3000",
    "http://localhost/",
    "app.localhost",
    "127.0.0.1",
    "http://192.168.1.1/admin",
    "0x7f.1",
    "1.2.3",
    "[::1]",
    "http://[2001:db8::1]/",
    "exa mple.com",
    "exa\tmple.com",
    "www. example.com/path",
    "linkedin .com",
    "http://",
    "https://",
    "example..com",
    "-example.com",
    "example-.com",
    "example.c",
    "example.123",
    `${"a".repeat(64)}.com`,
    `${"a.".repeat(1100)}com`,
    "javascript:alert(1)",
    "chrome://extensions",
    "file:///Users/me/file.html",
    "about:blank",
    "*",
    "*.com",
    "example.com:abc",
    "exa*mple.com",
    "exa!mple.com",
  ];

  for (const input of invalid) {
    test(`rejects ${JSON.stringify(input)?.slice(0, 40)}`, () => {
      assert.equal(normalizeDomain(input), null);
    });
  }
});

describe("hostMatches", () => {
  test("exact host and subdomains match", () => {
    assert.equal(hostMatches("linkedin.com", "linkedin.com"), true);
    assert.equal(hostMatches("www.linkedin.com", "linkedin.com"), true);
    assert.equal(hostMatches("a.b.linkedin.com", "linkedin.com"), true);
  });

  test("lookalike hosts do not match", () => {
    assert.equal(hostMatches("notlinkedin.com", "linkedin.com"), false);
    assert.equal(hostMatches("linkedin.com.evil.com", "linkedin.com"), false);
    assert.equal(hostMatches("linkedin.co", "linkedin.com"), false);
    assert.equal(hostMatches("google.com", "mail.google.com"), false);
  });

  test("tolerates uppercase and a trailing dot on the host", () => {
    assert.equal(hostMatches("WWW.LinkedIn.com", "linkedin.com"), true);
    assert.equal(hostMatches("linkedin.com.", "linkedin.com"), true);
  });

  test("bad input never matches", () => {
    assert.equal(hostMatches("linkedin.com", ""), false);
    assert.equal(hostMatches(null, "linkedin.com"), false);
    assert.equal(hostMatches("linkedin.com", undefined), false);
  });
});

describe("findBlockingDomain", () => {
  const list = ["google.com", "mail.google.com", "linkedin.com"];

  test("returns the most specific match", () => {
    assert.equal(findBlockingDomain("mail.google.com", list), "mail.google.com");
    assert.equal(findBlockingDomain("inbox.mail.google.com", list), "mail.google.com");
    assert.equal(findBlockingDomain("docs.google.com", list), "google.com");
    assert.equal(findBlockingDomain("fr.linkedin.com", list), "linkedin.com");
  });

  test("returns null without a match", () => {
    assert.equal(findBlockingDomain("example.org", list), null);
    assert.equal(findBlockingDomain("example.org", []), null);
    assert.equal(findBlockingDomain("example.org", undefined), null);
  });
});

describe("effectiveDomains", () => {
  test("default settings block the social group, sorted", () => {
    const result = effectiveDomains(mergeSettings({}, "en"));
    assert.deepEqual(result, [...presetDomains("social", "en")].sort());
    assert.ok(result.includes("linkedin.com"));
  });

  test("union of the enabled groups and the user's own sites", () => {
    const result = effectiveDomains(settings({
      groups: [group("g_work", ["slack.com", "notion.so"]), group("g_fun", ["twitch.tv"])],
      custom: ["reddit.com"],
    }));
    assert.deepEqual(result, ["notion.so", "reddit.com", "slack.com", "twitch.tv"]);
  });

  test("disabled groups are left out", () => {
    const result = effectiveDomains(settings({
      groups: [group("g_on", ["slack.com"]), group("g_off", ["twitch.tv"], false)],
    }));
    assert.deepEqual(result, ["slack.com"]);
  });

  test("only enabled: true counts", () => {
    const groups = [
      { ...group("a", ["a.com"]), enabled: "true" },
      { ...group("b", ["b.com"]), enabled: 1 },
      { ...group("c", ["c.com"]), enabled: undefined },
      group("d", ["d.com"]),
    ];
    assert.deepEqual(effectiveDomains(settings({ groups })), ["d.com"]);
  });

  test("a site in several groups or also in custom appears once", () => {
    const result = effectiveDomains(settings({
      groups: [group("a", ["x.com", "y.com"]), group("b", ["y.com", "x.com"])],
      custom: ["x.com", "https://www.Y.com/feed"],
    }));
    assert.deepEqual(result, ["x.com", "y.com"]);
  });

  test("a site of a disabled group still counts when it is one of the user's own sites", () => {
    const result = effectiveDomains(settings({ groups: [group("a", ["x.com"], false)], custom: ["x.com"] }));
    assert.deepEqual(result, ["x.com"]);
  });

  test("domains are normalized, deduplicated and invalid ones dropped", () => {
    const result = effectiveDomains(settings({
      groups: [group("a", ["https://www.Example.com/x", "not a domain", 12, null])],
      custom: ["example.com", "localhost", "news.ycombinator.com"],
    }));
    assert.deepEqual(result, ["example.com", "news.ycombinator.com"]);
  });

  test("a subdomain is dropped when its parent is in the list, even from another group", () => {
    const messaging = { ...defaultGroups("en")[2], enabled: true };
    const result = effectiveDomains(settings({ groups: [messaging], custom: ["google.com"] }));
    assert.ok(result.includes("google.com"));
    assert.ok(!result.includes("mail.google.com"));
    const nested = effectiveDomains(settings({ groups: [group("a", ["a.b.example.com"]), group("b", ["example.com"])], custom: ["b.example.com"] }));
    assert.deepEqual(nested, ["example.com"]);
  });

  test("a disabled parent does not hide an enabled subdomain", () => {
    const result = effectiveDomains(settings({ groups: [group("a", ["google.com"], false), group("b", ["mail.google.com"])] }));
    assert.deepEqual(result, ["mail.google.com"]);
  });

  test("sibling subdomains are both kept", () => {
    const result = effectiveDomains(settings({ custom: ["outlook.live.com", "outlook.office.com", "live.org"] }));
    assert.deepEqual(result, ["live.org", "outlook.live.com", "outlook.office.com"]);
  });

  test("preset groups carry their locale domains, no locale parameter needed", () => {
    const withNews = (locale) => defaultGroups(locale).map((entry) => ({ ...entry, enabled: entry.id === "news" }));
    const fr = effectiveDomains(settings({ groups: withNews("fr") }));
    const en = effectiveDomains(settings({ groups: withNews("en") }));
    assert.ok(fr.includes("lemonde.fr") && !fr.includes("cnn.com"));
    assert.ok(en.includes("cnn.com") && !en.includes("lemonde.fr"));
  });

  test("result is sorted and unique", () => {
    const groups = defaultGroups("fr").map((entry) => ({ ...entry, enabled: true }));
    const result = effectiveDomains(settings({ groups, custom: ["zzz.com", "aaa.com", "x.com"] }));
    assert.deepEqual(result, [...new Set(result)].sort());
  });

  test("the full settings object works as well as { groups, sites }", () => {
    const full = mergeSettings({ groups: [group("a", ["x.com"])], sites: { custom: ["y.com"] }, goals: { items: ["Ship"] } }, "en");
    assert.deepEqual(effectiveDomains(full), ["x.com", "y.com"]);
    assert.deepEqual(effectiveDomains({ groups: full.groups, sites: full.sites }), ["x.com", "y.com"]);
  });

  test("missing or malformed input gives an empty list", () => {
    assert.deepEqual(effectiveDomains(null), []);
    assert.deepEqual(effectiveDomains(undefined), []);
    assert.deepEqual(effectiveDomains({}), []);
    assert.deepEqual(effectiveDomains({ groups: "x", sites: null }), []);
    assert.deepEqual(effectiveDomains({ groups: [null, 42, { enabled: true }, { enabled: true, domains: "x.com" }], sites: { custom: {} } }), []);
  });

  test("V2 sites (categories, excluded) count only once mergeSettings migrated them to groups", () => {
    const legacy = { sites: { categories: { social: true }, excluded: ["linkedin.com"], custom: [] } };
    assert.deepEqual(effectiveDomains(legacy), []);
    const migrated = effectiveDomains(mergeSettings(legacy, "en"));
    assert.deepEqual(migrated, presetDomains("social", "en").filter((domain) => domain !== "linkedin.com").sort());
  });
});

describe("originPatterns", () => {
  test("apex and subdomain patterns for each domain", () => {
    assert.deepEqual(originPatterns(["linkedin.com", "x.com"]), [
      "*://linkedin.com/*",
      "*://*.linkedin.com/*",
      "*://x.com/*",
      "*://*.x.com/*",
    ]);
  });

  test("deduplicates and ignores bad entries", () => {
    assert.deepEqual(originPatterns(["x.com", "x.com", "", null]), ["*://x.com/*", "*://*.x.com/*"]);
    assert.deepEqual(originPatterns([]), []);
    assert.deepEqual(originPatterns(undefined), []);
  });
});

describe("domainsForOrigins", () => {
  const domains = ["facebook.com", "linkedin.com", "mail.google.com"];

  test("all hosts patterns cover everything", () => {
    assert.deepEqual(domainsForOrigins(["*://*/*"], domains), domains);
    assert.deepEqual(domainsForOrigins(["<all_urls>"], domains), domains);
    assert.deepEqual(domainsForOrigins(["http://*/*", "https://*/*"], domains), domains);
  });

  test("one scheme alone is not full coverage", () => {
    assert.deepEqual(domainsForOrigins(["https://*/*"], domains), []);
    assert.deepEqual(domainsForOrigins(["https://*.linkedin.com/*"], domains), []);
  });

  test("the exact pair requested by originPatterns covers only that domain", () => {
    assert.deepEqual(domainsForOrigins(originPatterns(["linkedin.com"]), domains), ["linkedin.com"]);
  });

  test("round trip: patterns for a list cover the whole list", () => {
    assert.deepEqual(domainsForOrigins(originPatterns(domains), domains), domains);
  });

  test("apex only is not enough, a wildcard subdomain pattern also covers the apex", () => {
    assert.deepEqual(domainsForOrigins(["*://linkedin.com/*"], domains), []);
    assert.deepEqual(domainsForOrigins(["*://*.linkedin.com/*"], domains), ["linkedin.com"]);
  });

  test("a parent domain pattern covers a subdomain entry", () => {
    assert.deepEqual(domainsForOrigins(["*://*.google.com/*"], domains), ["mail.google.com"]);
    assert.deepEqual(domainsForOrigins(["*://google.com/*", "*://*.google.com/*"], domains), ["mail.google.com"]);
  });

  test("a subdomain pattern does not cover its parent", () => {
    assert.deepEqual(domainsForOrigins(originPatterns(["mail.google.com"]), ["google.com"]), []);
  });

  test("patterns tied to a specific port do not count, any port does", () => {
    assert.deepEqual(domainsForOrigins(["*://*.linkedin.com:8080/*"], domains), []);
    assert.deepEqual(domainsForOrigins(["*://*.linkedin.com:*/*"], domains), ["linkedin.com"]);
  });

  test("ignores garbage and non web schemes", () => {
    assert.deepEqual(domainsForOrigins(["file:///*", "chrome://*/*", "nonsense", 42, null], domains), []);
    assert.deepEqual(domainsForOrigins(undefined, domains), []);
    assert.deepEqual(domainsForOrigins(["*://*/*"], undefined), []);
  });

  test("keeps the order of the domains argument", () => {
    const list = ["x.com", "a.com", "m.com"];
    assert.deepEqual(domainsForOrigins(["*://*/*"], list), list);
  });

  test("pattern hosts are compared case insensitively", () => {
    assert.deepEqual(domainsForOrigins(["*://*.LinkedIn.com/*"], domains), ["linkedin.com"]);
  });
});
