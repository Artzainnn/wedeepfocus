// When the popup asks for a rating on the store (REVIEW_URL in config.js). Pure module: no chrome,
// no document. Same question for everyone, whatever they think of the extension: no incentive and
// no filtering, as the Chrome Web Store asks. Nothing about the answer leaves the browser.
import { REVIEW_URL } from "./config.js";
import { cleanHistory } from "./stats.js";

// "Not now" waits this long before asking again, and the question stops after the second one.
export const RATE_LATER_DAYS = 14;
export const RATE_MAX_LATER = 2;
const DAY_MS = 86_400_000;

// The store page, or "" when none is set up (or it isn't https).
export function reviewUrl() {
  try {
    const url = new URL(REVIEW_URL);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

// Blocks that ran to their end, all days together (sessions and scheduled slots alike).
export function completedBlocks(history) {
  return Object.values(cleanHistory(history).days).reduce((sum, day) => sum + day.completed, 0);
}

// The stored answer: { rated: true } once the store page was opened, { later, until } after "Not now".
export function cleanRatePrefs(prefs) {
  const source = prefs && typeof prefs === "object" ? prefs : {};
  const later = Number.isInteger(source.later) && source.later > 0 ? source.later : 0;
  const until = Number.isFinite(source.until) && source.until > 0 ? source.until : 0;
  return { rated: source.rated === true, later, until };
}

// Asked when nothing is blocked right now and a first block has run to its end: never in the middle
// of focus, and only to people who have seen the extension work.
export function shouldAskRating({ history, active, prefs, now, url = reviewUrl() }) {
  if (!url || active) return false;
  const answer = cleanRatePrefs(prefs);
  if (answer.rated || answer.later >= RATE_MAX_LATER || now < answer.until) return false;
  return completedBlocks(history) >= 1;
}

export function rateLater(prefs, now) {
  const answer = cleanRatePrefs(prefs);
  return { ...answer, later: answer.later + 1, until: now + RATE_LATER_DAYS * DAY_MS };
}
