// POST /api/checkout { amount, token, locale } -> 200 { url, sessionId }
// Creates a Stripe Checkout Session for the exact amount the user chose to end a focus session
// early. The token comes back as client_reference_id so api/verify.js can match the payment.
import {
  AMOUNT_MAX, AMOUNT_MIN, TOKEN_PATTERN,
  callStripe, json, methodNotAllowed, preflight, readJsonObject, siteUrl, stripeSecretKey,
} from "../lib/payment-server.js";

const METHODS = "POST, OPTIONS";
// Shown on the Stripe page. "WeDeepFocus" mirrors appName in i18n/common.json.
const PRODUCT_NAME = {
  en: "WeDeepFocus: session ended early",
  fr: "WeDeepFocus : session arrêtée avant la fin",
};
// Optional free-form message shown on the Stripe page (visible to the developer in Stripe).
const MESSAGE_LABEL = {
  en: "Leave a message (optional)",
  fr: "Laisse un message (facultatif)",
};

const handler = {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(METHODS);
    if (request.method !== "POST") return methodNotAllowed(METHODS);
    const input = parseInput(await readJsonObject(request));
    if (!input) return json(400, { error: "invalid_request" }, METHODS);
    const secretKey = stripeSecretKey();
    const site = siteUrl();
    if (!secretKey || !site) return json(500, { error: "server_misconfigured" }, METHODS);
    const session = await callStripe(secretKey, "/checkout/sessions", checkoutForm(input, site));
    if (!isCreatedSession(session)) return json(502, { error: "stripe_error" }, METHODS);
    return json(200, { url: session.url, sessionId: session.id }, METHODS);
  },
};

function parseInput(body) {
  if (!body) return null;
  const { amount, token, locale } = body;
  if (!Number.isInteger(amount) || amount < AMOUNT_MIN || amount > AMOUNT_MAX) return null;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  if (locale !== "en" && locale !== "fr") return null;
  // Euros for French, dollars otherwise (older extension builds send no currency).
  const currency = body.currency ?? (locale === "fr" ? "eur" : "usd");
  if (currency !== "eur" && currency !== "usd") return null;
  return { amount, token, locale, currency };
}

// Payments are grouped under the "WeDeepFocus: Accountability" Stripe product when its id is set
// (STRIPE_ACCOUNTABILITY_PRODUCT in Vercel), else each session names the product inline.
function productFields(locale) {
  const product = (process.env.STRIPE_ACCOUNTABILITY_PRODUCT ?? "").trim();
  return /^prod_[A-Za-z0-9]+$/.test(product)
    ? { "line_items[0][price_data][product]": product }
    : { "line_items[0][price_data][product_data][name]": PRODUCT_NAME[locale] };
}

function checkoutForm({ amount, token, locale, currency }, site) {
  const paidPage = `${site}${locale === "fr" ? "/fr" : ""}/paid/`;
  return new URLSearchParams({
    mode: "payment",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(amount * 100),
    ...productFields(locale),
    "line_items[0][quantity]": "1",
    client_reference_id: token,
    "metadata[token]": token,
    "metadata[kind]": "accountability",
    "custom_fields[0][key]": "message",
    "custom_fields[0][type]": "text",
    "custom_fields[0][optional]": "true",
    "custom_fields[0][label][type]": "custom",
    "custom_fields[0][label][custom]": MESSAGE_LABEL[locale],
    "custom_fields[0][text][maximum_length]": "255",
    // Stripe fills in {CHECKOUT_SESSION_ID} itself.
    success_url: `${paidPage}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${paidPage}?canceled=1`,
    locale,
  });
}

function isCreatedSession(session) {
  return Boolean(session)
    && typeof session.id === "string" && session.id.startsWith("cs_")
    && typeof session.url === "string" && session.url.startsWith("https://");
}

// Vercel accepts either the Web handler object or named HTTP method exports: offer both.
export default handler;
export const POST = (request) => handler.fetch(request);
export const OPTIONS = (request) => handler.fetch(request);
