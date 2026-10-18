// Deployment settings of this build. Forking? Change these values (and appName / appShortName in
// i18n/common.json), nothing else. Everything here is public: it ships inside the extension.

// "Buy a dev a coffee" links (Stripe Payment Links or any https page): euros for French, dollars
// for every other language. Leave both empty ("") to hide the link everywhere.
export const COFFEE_URLS = Object.freeze({
  fr: "https://buy.stripe.com/14AdR99cffvz8fA9zZ3Ru00",
  other: "https://buy.stripe.com/9B66oHcorcjn7bweUj3Ru01",
});

// Feedback page on the website: opened from the "Feedback" link in the side menu, and by Chrome when
// the extension is uninstalled (with ?from=uninstall). French page for French, the other for every
// other language. Leave both empty ("") to hide the link and open nothing on uninstall.
export const FEEDBACK_URLS = Object.freeze({
  fr: "https://wedeepfocus.com/fr/feedback/",
  other: "https://wedeepfocus.com/feedback/",
});

// Paying to end a session early ("accountability", SPEC 13). Off in the published build: the typed
// sentence is the only way to end early. Turning it on needs your own payment server (landing/api).
export const ACCOUNTABILITY_ENABLED = false;

// That payment server: an https origin, no trailing slash. Unused while ACCOUNTABILITY_ENABLED is false.
export const PAYMENT_API = "https://wedeepfocus.com";
