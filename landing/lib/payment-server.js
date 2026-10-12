// Shared by the payment functions (api/checkout.js, api/verify.js). No npm dependency: Web
// standard Request/Response, Stripe's REST API through fetch. Never log tokens or request
// bodies, only Stripe's status and error codes.

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 8000;
const MAX_BODY_LENGTH = 2048;

export const AMOUNT_MIN = 1, AMOUNT_MAX = 500;
// Random one-time code the extension makes for each payment (lowercase hex).
export const TOKEN_PATTERN = /^[a-f0-9]{32,64}$/;
// Checkout Session ids look like cs_test_a1B2... or cs_live_a1B2...: no slash or dot, safe in a URL path.
export const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,250}$/;

export function preflight(methods) {
  return new Response(null, { status: 204, headers: baseHeaders(methods) });
}

export function json(status, body, methods, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders(methods), "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function methodNotAllowed(methods) {
  return json(405, { error: "method_not_allowed" }, methods, { allow: methods });
}

// The extension calls from its own chrome-extension:// origin, without cookies: any origin is fine.
function baseHeaders(methods) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "7200",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
}

// Configuration from the hosting environment, read on every request. null when missing or unusable.
export function stripeSecretKey() {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  return key || null;
}

export function siteUrl() {
  const site = (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(site);
    return /^https?:$/.test(url.protocol) && !url.search && !url.hash ? site : null;
  } catch {
    return null;
  }
}

// The request body as a JSON object, or null (empty, too long, invalid JSON, not an object).
export async function readJsonObject(request) {
  try {
    const text = await request.text();
    if (!text || text.length > MAX_BODY_LENGTH) return null;
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// GET (no form) or POST (form) to Stripe. Resolves to the parsed answer when Stripe says 2xx,
// else null (Stripe error, network failure, timeout, unreadable answer). Never throws.
export async function callStripe(secretKey, path, form) {
  try {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method: form ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${secretKey}`,
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data && typeof data === "object") return data;
    const error = data?.error ?? {};
    console.error("stripe_error", response.status, error.type ?? "", error.code ?? "", error.request_log_url ?? "");
    return null;
  } catch (error) {
    console.error("stripe_unreachable", error?.name ?? "Error");
    return null;
  }
}
