import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BLOCK_RULE_ID, FALLBACK_RULE_ID, buildRules } from "../../extension/shared/rules.js";

const BLOCKED = "chrome-extension://abcdefghijklmnop/blocked/blocked.html";

function redirectRule(requestDomains) {
  return {
    id: 1,
    priority: 1,
    action: { type: "redirect", redirect: { regexSubstitution: `${BLOCKED}#\\0` } },
    condition: { regexFilter: "^https?://.*", requestDomains, resourceTypes: ["main_frame"] },
  };
}

function fallbackRule(requestDomains) {
  return {
    id: 2,
    priority: 1,
    action: { type: "block" },
    condition: { requestDomains, resourceTypes: ["main_frame"] },
  };
}

describe("rule ids", () => {
  test("the redirect rule is 1 and the fallback block rule is 2", () => {
    assert.equal(BLOCK_RULE_ID, 1);
    assert.equal(FALLBACK_RULE_ID, 2);
  });
});

describe("buildRules: empty input", () => {
  test("no domains, no rules", () => {
    assert.deepEqual(buildRules({ redirect: [], block: [] }, BLOCKED), []);
    assert.deepEqual(buildRules({}, BLOCKED), []);
  });

  test("missing or malformed lists give no rules instead of throwing", () => {
    assert.deepEqual(buildRules(undefined, BLOCKED), []);
    assert.deepEqual(buildRules(null, BLOCKED), []);
    assert.deepEqual(buildRules("linkedin.com", BLOCKED), []);
    assert.deepEqual(buildRules({ redirect: "linkedin.com", block: { x: 1 } }, BLOCKED), []);
  });

  test("the old single list signature is not accepted", () => {
    assert.deepEqual(buildRules(["linkedin.com"], BLOCKED), []);
  });
});

describe("buildRules: redirect rule (host access granted)", () => {
  test("one redirect rule covering every domain", () => {
    assert.deepEqual(buildRules({ redirect: ["linkedin.com", "x.com"], block: [] }, BLOCKED), [
      redirectRule(["linkedin.com", "x.com"]),
    ]);
  });

  test("the block list can be omitted", () => {
    assert.deepEqual(buildRules({ redirect: ["linkedin.com"] }, BLOCKED), [redirectRule(["linkedin.com"])]);
  });

  test("the substitution is the page URL, a hash, then backslash zero", () => {
    const [rule] = buildRules({ redirect: ["linkedin.com"] }, BLOCKED);
    const substitution = rule.action.redirect.regexSubstitution;
    assert.equal(substitution, String.raw`${BLOCKED}#\0`);
    assert.deepEqual([...substitution.slice(-3)], ["#", "\\", "0"]);
  });

  test("the redirect keeps the full original URL in the hash", () => {
    const [rule] = buildRules({ redirect: ["linkedin.com"] }, BLOCKED);
    const original = "https://www.linkedin.com/feed/?trk=nav#section";
    // Chrome's \0 is the whole match, like $& in JavaScript.
    const redirected = original.replace(new RegExp(rule.condition.regexFilter), rule.action.redirect.regexSubstitution.split("\\0").join("$&"));
    assert.equal(redirected, `${BLOCKED}#${original}`);
    assert.equal(new URL(redirected).hash.slice(1), original);
  });

  test("the redirect only applies to http and https navigations", () => {
    const [rule] = buildRules({ redirect: ["linkedin.com"] }, BLOCKED);
    const filter = new RegExp(rule.condition.regexFilter);
    assert.ok(filter.test("http://linkedin.com/"));
    assert.ok(filter.test("https://www.linkedin.com/feed"));
    assert.ok(!filter.test("ws://linkedin.com/socket"));
  });
});

describe("buildRules: fallback block rule (no host access)", () => {
  test("one block rule covering every domain, without redirect or regexFilter", () => {
    assert.deepEqual(buildRules({ redirect: [], block: ["facebook.com", "reddit.com"] }, BLOCKED), [
      fallbackRule(["facebook.com", "reddit.com"]),
    ]);
  });

  test("the redirect list can be omitted", () => {
    assert.deepEqual(buildRules({ block: ["facebook.com"] }, BLOCKED), [fallbackRule(["facebook.com"])]);
  });

  test("the block rule does not depend on the blocked page URL", () => {
    assert.deepEqual(buildRules({ block: ["facebook.com"] }, undefined), [fallbackRule(["facebook.com"])]);
  });
});

describe("buildRules: both rules", () => {
  test("redirect first (id 1), then block (id 2), same priority", () => {
    const rules = buildRules({ redirect: ["linkedin.com"], block: ["facebook.com", "x.com"] }, BLOCKED);
    assert.deepEqual(rules, [redirectRule(["linkedin.com"]), fallbackRule(["facebook.com", "x.com"])]);
    assert.deepEqual(rules.map((rule) => rule.id), [BLOCK_RULE_ID, FALLBACK_RULE_ID]);
    // Equal priority: if a request ever matched both, Chrome would pick the block over the redirect.
    assert.equal(rules[0].priority, rules[1].priority);
  });

  test("rule ids never go beyond the two known ids (callers remove [1, 2])", () => {
    const cases = [
      { redirect: ["a.com"] },
      { block: ["b.com"] },
      { redirect: ["a.com", "c.com"], block: ["b.com", "d.com"] },
    ];
    for (const lists of cases) {
      for (const rule of buildRules(lists, BLOCKED)) assert.ok([BLOCK_RULE_ID, FALLBACK_RULE_ID].includes(rule.id));
    }
  });
});

describe("buildRules: domain validation", () => {
  test("requestDomains are deduplicated copies", () => {
    const redirect = ["x.com", "x.com", "reddit.com"];
    const block = ["facebook.com", "facebook.com"];
    const [redirectPart, blockPart] = buildRules({ redirect, block }, BLOCKED);
    assert.deepEqual(redirectPart.condition.requestDomains, ["x.com", "reddit.com"]);
    assert.deepEqual(blockPart.condition.requestDomains, ["facebook.com"]);
    assert.notEqual(redirectPart.condition.requestDomains, redirect);
    assert.notEqual(blockPart.condition.requestDomains, block);
  });

  test("invalid entries are dropped, since one would make updateDynamicRules reject", () => {
    const junk = ["", null, 42, "not a domain", "localhost", "127.0.0.1", "exa mple.com", "com"];
    const rules = buildRules({ redirect: ["linkedin.com", ...junk], block: [...junk, "facebook.com"] }, BLOCKED);
    assert.deepEqual(rules, [redirectRule(["linkedin.com"]), fallbackRule(["facebook.com"])]);
  });

  test("a list with only invalid entries produces no rule for it", () => {
    assert.deepEqual(buildRules({ redirect: ["", null], block: ["facebook.com"] }, BLOCKED), [fallbackRule(["facebook.com"])]);
    assert.deepEqual(buildRules({ redirect: ["linkedin.com"], block: ["localhost"] }, BLOCKED), [redirectRule(["linkedin.com"])]);
    assert.deepEqual(buildRules({ redirect: [" "], block: ["1.2.3.4"] }, BLOCKED), []);
  });

  test("entries are normalized to the lowercase ASCII host Chrome expects", () => {
    const rules = buildRules(
      { redirect: ["https://www.LinkedIn.com/feed", "linkedin.com"], block: ["exämple.com", "Mail.Google.com"] },
      BLOCKED,
    );
    assert.deepEqual(rules, [redirectRule(["linkedin.com"]), fallbackRule(["xn--exmple-cua.com", "mail.google.com"])]);
  });
});
