// Shared constants. Pure module: no chrome, no document.
// Deployment settings (coffee links, payment server, accountability switch) live in config.js.
export { COFFEE_URLS, ACCOUNTABILITY_ENABLED, PAYMENT_API } from "./config.js";

export const PASS_MINUTES = 10;
export const SESSION_PRESETS = [15, 30, 60];
export const SESSION_MIN = 1, SESSION_MAX = 480, EXTEND_MINUTES = 10;
export const MAX_CUSTOM_DOMAINS = 200;
export const GOAL_MAX_LENGTH = 140;
export const GOAL_COUNT = 1;
export const LOOKAHEAD_DAYS = 8;
// Preset ids, in display order (also the keys of the old V2 sites.categories).
export const CATEGORY_IDS = ["social", "video", "messaging", "news", "shopping"];
export const BADGE_COLOR = "#4f7df0";
// Custom unlock sentence length once trimmed; an empty phrase means the default localized sentence.
export const PHRASE_MIN = 40, PHRASE_MAX = 300;
// "Reset everything" also works during a block: a deliberate escape hatch. Set to false to lock
// it like every other change that weakens a block.
export const RESET_DURING_BLOCK = true;

// Groups of sites (chrome.storage.sync "groups").
export const MAX_GROUPS = 20;
export const MAX_GROUP_DOMAINS = 100;
export const GROUP_NAME_MAX = 30;
export const GROUP_ICONS = Object.freeze([
  "users", "play", "mail", "news", "cart", "chat", "game", "music",
  "briefcase", "heart", "star", "globe", "book", "sparkles", "target", "coffee",
]);
// Icon of a new group, and of a stored group whose icon is unknown.
export const DEFAULT_GROUP_ICON = "star";

// Ending a session early (SPEC 13): "free" means typing the sentence, "money" means paying the
// chosen amount through Stripe, with the sentence still there as the free way out.
export const UNLOCK_MODES = Object.freeze(["free", "money"]);
// Whole amounts in the payment currency (paymentCurrency in payment.js). Any other amount from CUSTOM_AMOUNT_MIN to CUSTOM_AMOUNT_MAX is a custom one.
export const PAYMENT_AMOUNTS = Object.freeze([2, 5, 10, 20]);
// French pages pay in euros, every other language in US dollars.
export const PAYMENT_CURRENCIES = Object.freeze({ fr: "EUR", other: "USD" });
export const DEFAULT_AMOUNT = 5;
export const CUSTOM_AMOUNT_MIN = 1, CUSTOM_AMOUNT_MAX = 500;

// chrome.storage.sync keys, in this order.
export const SETTINGS_KEYS = Object.freeze(["groups", "sites", "schedules", "goals", "prefs", "unlock"]);

// Slot proposed by "Add a time slot" (options) and the onboarding schedule step.
export const DEFAULT_SLOT = deepFreeze({ days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", enabled: true });

// Deep frozen: never mutate it, clone it first (structuredClone or storage.getSettings()).
// No `groups` here: the default groups depend on the locale (presets.defaultGroups(locale)).
export const DEFAULT_SETTINGS = deepFreeze({
  sites: { custom: [] },
  schedules: [],
  goals: { items: [""], showQuote: true },
  prefs: { onboarded: false },
  unlock: { phrase: "", mode: "free", amount: DEFAULT_AMOUNT },
});

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
