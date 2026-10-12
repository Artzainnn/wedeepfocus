// chrome.i18n helpers. All user-visible strings go through t().

const ATTRIBUTE_TARGETS = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
  ["data-i18n-aria-label", "aria-label"],
];

// Returns the key itself when the message is missing, so gaps are visible instead of blank.
export function t(key, substitutions) {
  let message = "";
  try {
    message = chrome.i18n.getMessage(key, toSubstitutions(substitutions));
  } catch {
    message = "";
  }
  return message || key;
}

function toSubstitutions(substitutions) {
  if (substitutions === undefined || substitutions === null) return undefined;
  const list = Array.isArray(substitutions) ? substitutions : [substitutions];
  return list.map((value) => String(value ?? ""));
}

// Localized text for a background refusal reason ("lock_custom" -> t("reason_lock_custom")).
export function reasonText(reason) {
  const key = `reason_${reason}`;
  const message = typeof reason === "string" && /^[a-z0-9_]+$/.test(reason) ? t(key) : key;
  return message === key ? t("reason_unknown") : message;
}

export function applyI18n(root = document) {
  const scope = root ?? document;
  for (const element of select(scope, "[data-i18n]")) {
    const key = element.getAttribute("data-i18n");
    if (key) element.textContent = t(key);
  }
  for (const [attribute, target] of ATTRIBUTE_TARGETS) {
    for (const element of select(scope, `[${attribute}]`)) {
      const key = element.getAttribute(attribute);
      if (key) element.setAttribute(target, t(key));
    }
  }
  const doc = scope.ownerDocument ?? scope;
  if (doc?.documentElement) {
    doc.documentElement.lang = String(t("@@ui_locale")).toLowerCase().startsWith("fr") ? "fr" : "en";
  }
}

function select(scope, selector) {
  if (typeof scope.querySelectorAll !== "function") return [];
  const elements = [...scope.querySelectorAll(selector)];
  if (typeof scope.matches === "function" && scope.matches(selector)) elements.unshift(scope);
  return elements;
}

export function uiLocale() {
  let language = "";
  try {
    language = chrome.i18n.getUILanguage();
  } catch {
    language = "";
  }
  return String(language).toLowerCase().startsWith("fr") ? "fr" : "en";
}
