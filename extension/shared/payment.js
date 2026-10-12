// Paying to end a session early (SPEC 13.8). The payment server creates a Stripe Checkout Session for
// the exact amount and later tells whether it is paid for our one-time token. No chrome, no document:
// the blocked page and the background both use it. Network calls never throw and give up after
// PAYMENT_TIMEOUT_MS.

import { COFFEE_URLS, CUSTOM_AMOUNT_MAX, CUSTOM_AMOUNT_MIN, PAYMENT_AMOUNTS, PAYMENT_API, PAYMENT_CURRENCIES } from "./constants.js";

export const PAYMENT_TIMEOUT_MS = 10_000;

const UNAVAILABLE = Object.freeze({ ok: false, reason: "payment_unavailable" });
const TOKEN = /^[0-9a-f]{32,64}$/i;
const MAX_SESSION_ID_LENGTH = 255;

export function isPresetAmount(n) {
  return PAYMENT_AMOUNTS.includes(n);
}

// Numbers only: convert input values first (Number(input.value)).
export function isValidAmount(n) {
  return Number.isInteger(n) && n >= CUSTOM_AMOUNT_MIN && n <= CUSTOM_AMOUNT_MAX;
}

const formatters = new Map();

// "EUR" for French, "USD" for every other language (ISO 4217, as Intl and Stripe expect it).
export function paymentCurrency(locale) {
  return String(locale ?? "").toLowerCase().startsWith("fr") ? PAYMENT_CURRENCIES.fr : PAYMENT_CURRENCIES.other;
}

// The "Buy a dev a coffee" link in the same currency as the payments: euros for French.
// The coffee link for this language, or "" when the build has none (the link is then hidden).
export function coffeeUrl(locale) {
  const url = paymentCurrency(locale) === PAYMENT_CURRENCIES.fr ? COFFEE_URLS.fr : COFFEE_URLS.other;
  return webUrl(url) ?? "";
}

// "5 €" in French (with a no-break space), "$5" in English. "" when the amount is not a number.
export function formatAmount(amount, locale) {
  const value = typeof amount === "string" && amount.trim() !== "" ? Number(amount) : amount;
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return currencyFormatter(locale).format(value);
}

function currencyFormatter(locale) {
  const tag = typeof locale === "string" && locale ? locale.replace(/_/g, "-") : "en";
  let cached = formatters.get(tag);
  if (!cached) {
    // narrowSymbol: "$10" in every English variant (en-GB would say "US$10").
    const options = { style: "currency", currency: paymentCurrency(tag), currencyDisplay: "narrowSymbol", minimumFractionDigits: 0, maximumFractionDigits: 0 };
    try {
      cached = new Intl.NumberFormat(tag, options);
    } catch {
      cached = new Intl.NumberFormat("en", options);
    }
    formatters.set(tag, cached);
  }
  return cached;
}

// One-time code tying a Checkout Session to this payment attempt: 32 hex characters.
export function newPaymentToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// { ok: true, url, sessionId } where `url` is the Stripe page to open, or { ok: false, reason:
// "payment_unavailable" }. The amount and token are checked here first, like the server does.
export async function createCheckout({ amount, token, locale } = {}) {
  if (!isValidAmount(amount) || !isToken(token)) return { ...UNAVAILABLE };
  const data = await requestJson("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, token, locale: serverLocale(locale), currency: paymentCurrency(locale).toLowerCase() }),
  });
  const url = isObject(data) ? checkoutUrl(data.url) : null;
  const sessionId = isObject(data) && isSessionId(data.sessionId) ? data.sessionId : null;
  return url && sessionId ? { ok: true, url, sessionId } : { ...UNAVAILABLE };
}

// { ok: true, paid } or { ok: false, reason: "payment_unavailable" }. A malformed session id or
// token can't belong to a paid session: { ok: true, paid: false } without asking the server.
export async function verifyPayment({ sessionId, token } = {}) {
  if (!isSessionId(sessionId) || !isToken(token)) return { ok: true, paid: false };
  const query = new URLSearchParams({ session_id: sessionId, token });
  const data = await requestJson(`/api/verify?${query}`, { method: "GET" });
  return isObject(data) && typeof data.paid === "boolean" ? { ok: true, paid: data.paid } : { ...UNAVAILABLE };
}

// The parsed JSON body of a 2xx answer, or null (network error, timeout, HTTP error, invalid JSON).
// The timeout covers reading the body too.
async function requestJson(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAYMENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${PAYMENT_API.replace(/\/+$/, "")}${path}`, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function serverLocale(locale) {
  return String(locale ?? "").toLowerCase().startsWith("fr") ? "fr" : "en";
}

function isToken(value) {
  return typeof value === "string" && TOKEN.test(value);
}

function isSessionId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SESSION_ID_LENGTH;
}

// The payment page must be Stripe Checkout (or the payment server itself): even a compromised
// server cannot send people to another site.
function checkoutUrl(value) {
  const url = webUrl(value);
  if (!url) return null;
  const { protocol, hostname, origin } = new URL(url);
  const stripe = protocol === "https:" && hostname === "checkout.stripe.com";
  return stripe || origin === new URL(PAYMENT_API).origin ? url : null;
}

// Only absolute http(s) pages can be opened in a tab.
function webUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
