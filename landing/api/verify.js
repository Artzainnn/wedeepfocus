// GET /api/verify?session_id=cs_...&token=... -> 200 { paid }
// Asks Stripe whether that Checkout Session is paid and was created for this token. Answers
// nothing else about the session.
import {
  SESSION_ID_PATTERN, TOKEN_PATTERN,
  callStripe, json, methodNotAllowed, preflight, stripeSecretKey,
} from "../lib/payment-server.js";

const METHODS = "GET, OPTIONS";

const handler = {
  async fetch(request) {
    if (request.method === "OPTIONS") return preflight(METHODS);
    if (request.method !== "GET") return methodNotAllowed(METHODS);
    const params = new URL(request.url).searchParams;
    const sessionId = params.get("session_id") ?? "";
    const token = params.get("token") ?? "";
    if (!SESSION_ID_PATTERN.test(sessionId) || !TOKEN_PATTERN.test(token)) {
      return json(400, { error: "invalid_request" }, METHODS);
    }
    const secretKey = stripeSecretKey();
    if (!secretKey) return json(500, { error: "server_misconfigured" }, METHODS);
    const session = await callStripe(secretKey, `/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (!session) return json(502, { error: "stripe_error" }, METHODS);
    const paid = session.payment_status === "paid" && session.client_reference_id === token;
    return json(200, { paid }, METHODS);
  },
};

// Vercel accepts either the Web handler object or named HTTP method exports: offer both.
export default handler;
export const GET = (request) => handler.fetch(request);
export const OPTIONS = (request) => handler.fetch(request);
