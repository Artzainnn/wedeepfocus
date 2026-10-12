// GET /api/verify: paid only when Stripe says paid AND the token matches. Stripe is mocked.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import verify from "../api/verify.js";
import { TEST_ENV, TOKEN, assertCors, captureConsole, fakeStripe, readJson, setEnv, stripeAnswer } from "./helpers.js";

const METHODS = "GET, OPTIONS";
const SESSION = "cs_test_abc12345";
const get = (query) => verify.fetch(new Request(`https://focus.example/api/verify?${new URLSearchParams(query)}`));

describe("GET /api/verify", () => {
  let restoreEnv;
  let stripe;
  let consoleCapture;
  let session;

  beforeEach(() => {
    restoreEnv = setEnv(TEST_ENV);
    consoleCapture = captureConsole();
    session = { id: SESSION, payment_status: "paid", client_reference_id: TOKEN, amount_total: 500, customer_details: { email: "someone@example.com" } };
    stripe = fakeStripe(() => stripeAnswer(200, session));
  });

  afterEach(() => {
    stripe.restore();
    consoleCapture.restore();
    restoreEnv();
  });

  test("paid session with the matching token", async () => {
    const response = await get({ session_id: SESSION, token: TOKEN });
    assert.equal(response.status, 200);
    assertCors(response, METHODS);
    assert.deepEqual(await readJson(response), { paid: true }, "answers only { paid }, nothing else about the session");
    assert.equal(stripe.calls[0].url, `https://api.stripe.com/v1/checkout/sessions/${SESSION}`);
    assert.equal(stripe.calls[0].init.method, "GET");
  });

  test("unpaid session", async () => {
    session.payment_status = "unpaid";
    assert.deepEqual(await readJson(await get({ session_id: SESSION, token: TOKEN })), { paid: false });
  });

  test("paid session created for another token", async () => {
    session.client_reference_id = "f".repeat(32);
    assert.deepEqual(await readJson(await get({ session_id: SESSION, token: TOKEN })), { paid: false });
  });

  test("bad input is refused without calling Stripe", async () => {
    for (const query of [{ session_id: "nope", token: TOKEN }, { session_id: SESSION, token: "xyz" }, { token: TOKEN }, {}]) {
      const response = await get(query);
      assert.equal(response.status, 400, JSON.stringify(query));
    }
    assert.equal(stripe.calls.length, 0);
  });

  test("Stripe unreachable or erroring answers 502", async () => {
    stripe.restore();
    stripe = fakeStripe(() => {
      throw new TypeError("network down");
    });
    assert.equal((await get({ session_id: SESSION, token: TOKEN })).status, 502);
    stripe.restore();
    stripe = fakeStripe(() => stripeAnswer(404, { error: { type: "invalid_request_error" } }));
    assert.equal((await get({ session_id: SESSION, token: TOKEN })).status, 502);
  });

  test("missing secret key answers 500", async () => {
    setEnv({ STRIPE_SECRET_KEY: undefined });
    assert.equal((await get({ session_id: SESSION, token: TOKEN })).status, 500);
  });

  test("preflight, other methods, and no token in logs", async () => {
    const preflight = await verify.fetch(new Request("https://focus.example/api/verify", { method: "OPTIONS" }));
    assert.equal(preflight.status, 204);
    const post = await verify.fetch(new Request("https://focus.example/api/verify", { method: "POST" }));
    assert.equal(post.status, 405);
    await get({ session_id: SESSION, token: TOKEN });
    assert.ok(consoleCapture.lines.every((line) => !line.includes(TOKEN)));
  });
});
