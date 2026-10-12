// declarativeNetRequest rule builder. Pure module: no chrome, no document.

import { normalizeDomain } from "./domains.js";

export const BLOCK_RULE_ID = 1;
export const FALLBACK_RULE_ID = 2;

// Rule 1 redirects the domains we have host access to (goals page). Rule 2 blocks the others
// (Chrome's error page): a redirect without host access is silently dropped, a block never is.
// Both share priority 1 so that if a request ever matches both, Chrome applies the block.
// requestDomains also matches subdomains. "\0" in regexSubstitution is the whole matched URL,
// kept in the hash of the blocked page.
export function buildRules(lists, blockedPageUrl) {
  const { redirect, block } = lists && typeof lists === "object" ? lists : {};
  const rules = [];
  const redirectDomains = validDomains(redirect);
  if (redirectDomains.length) {
    rules.push({
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: "redirect", redirect: { regexSubstitution: `${blockedPageUrl}#\\0` } },
      condition: { regexFilter: "^https?://.*", requestDomains: redirectDomains, resourceTypes: ["main_frame"] },
    });
  }
  const blockDomains = validDomains(block);
  if (blockDomains.length) {
    rules.push({
      id: FALLBACK_RULE_ID,
      priority: 1,
      action: { type: "block" },
      condition: { requestDomains: blockDomains, resourceTypes: ["main_frame"] },
    });
  }
  return rules;
}

// One invalid entry makes the whole updateDynamicRules call reject, so only valid,
// normalized, unique domains get through.
function validDomains(list) {
  const domains = Array.isArray(list) ? list.map((entry) => normalizeDomain(entry)) : [];
  return [...new Set(domains.filter(Boolean))];
}
