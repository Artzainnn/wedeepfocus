// Test helpers for the payment functions: a fake Stripe (globalThis.fetch), env and console capture.
// Never a real Stripe key: everything below is mocked.
import assert from "node:assert/strict";

export const TOKEN = "0123456789abcdef0123456789abcdef";
export const TEST_ENV = { STRIPE_SECRET_KEY: "sk_test_mock_not_a_real_key", SITE_URL: "https://focus.example" };

// Replaces globalThis.fetch. `respond(url, init)` returns a Response (or throws).
export function fakeStripe(respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function stripeAnswer(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Sets env values (undefined deletes); returns a function that puts the previous ones back.
export function setEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => setEnv(previous);
}

export function captureConsole() {
  const lines = [];
  const saved = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    saved[level] = console[level];
    console[level] = (...args) => lines.push(args.map(String).join(" "));
  }
  return { lines, restore: () => Object.assign(console, saved) };
}

export function assertCors(response, methods) {
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-methods"), methods);
  assert.equal(response.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
}

export async function readJson(response) {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  return response.json();
}
