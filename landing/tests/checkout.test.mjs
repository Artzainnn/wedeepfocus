// POST /api/checkout: validation, the exact Stripe form, error handling, CORS. Stripe is mocked.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import checkout from "../api/checkout.js";
import { TEST_ENV, TOKEN, assertCors, captureConsole, fakeStripe, readJson, setEnv, stripeAnswer } from "./helpers.js";

const METHODS = "POST, OPTIONS";
const post = (body) =>
  checkout.fetch(new Request("https://focus.example/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

describe("POST /api/checkout", () => {
  let restoreEnv;
  let stripe;
  let consoleCapture;

  beforeEach(() => {
    restoreEnv = setEnv(TEST_ENV);
    consoleCapture = captureConsole();
    stripe = fakeStripe(() => stripeAnswer(200, { id: "cs_test_abc12345", url: "https://checkout.stripe.com/c/pay/cs_test_abc12345" }));
  });

  afterEach(() => {
    stripe.restore();
    consoleCapture.restore();
    restoreEnv();
  });

  test("creates a Checkout Session for the exact amount and returns its url and id", async () => {
    const response = await post({ amount: 7, token: TOKEN, locale: "fr" });
    assert.equal(response.status, 200);
    assertCors(response, METHODS);
    assert.deepEqual(await readJson(response), { url: "https://checkout.stripe.com/c/pay/cs_test_abc12345", sessionId: "cs_test_abc12345" });

    assert.equal(stripe.calls.length, 1);
    const [call] = stripe.calls;
    assert.equal(call.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.authorization, `Bearer ${TEST_ENV.STRIPE_SECRET_KEY}`);
    const form = new URLSearchParams(call.init.body);
    assert.equal(form.get("mode"), "payment");
    assert.equal(form.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(form.get("line_items[0][price_data][unit_amount]"), "700");
    assert.equal(form.get("line_items[0][quantity]"), "1");
    assert.equal(form.get("client_reference_id"), TOKEN);
    assert.equal(form.get("metadata[token]"), TOKEN);
    assert.equal(form.get("success_url"), "https://focus.example/fr/paid/?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(form.get("cancel_url"), "https://focus.example/fr/paid/?canceled=1");
    assert.equal(form.get("locale"), "fr");
    assert.equal(form.get("custom_fields[0][key]"), "message");
    assert.equal(form.get("custom_fields[0][type]"), "text");
    assert.equal(form.get("custom_fields[0][optional]"), "true");
    assert.equal(form.get("custom_fields[0][label][custom]"), "Laisse un message (facultatif)");
    assert.equal(form.get("custom_fields[0][text][maximum_length]"), "255");
  });

  test("English pages have no /fr prefix", async () => {
    await post({ amount: 2, token: TOKEN, locale: "en" });
    const form = new URLSearchParams(stripe.calls[0].init.body);
    assert.equal(form.get("success_url"), "https://focus.example/paid/?session_id={CHECKOUT_SESSION_ID}");
    assert.equal(form.get("line_items[0][price_data][unit_amount]"), "200");
    assert.equal(form.get("line_items[0][price_data][currency]"), "usd", "English pages pay in dollars");
  });

  test("the currency sent by the extension is used, and only eur or usd are accepted", async () => {
    await post({ amount: 5, token: TOKEN, locale: "en", currency: "eur" });
    assert.equal(new URLSearchParams(stripe.calls[0].init.body).get("line_items[0][price_data][currency]"), "eur");
    const response = await post({ amount: 5, token: TOKEN, locale: "en", currency: "gbp" });
    assert.equal(response.status, 400);
    assert.equal(stripe.calls.length, 1, "no Stripe call for an unknown currency");
  });

  test("payments go under the Accountability product when its id is configured", async () => {
    setEnv({ STRIPE_ACCOUNTABILITY_PRODUCT: "prod_TestAccountability1" });
    await post({ amount: 5, token: TOKEN, locale: "fr" });
    const form = new URLSearchParams(stripe.calls[0].init.body);
    assert.equal(form.get("line_items[0][price_data][product]"), "prod_TestAccountability1");
    assert.equal(form.get("line_items[0][price_data][product_data][name]"), null);
    assert.equal(form.get("metadata[kind]"), "accountability");
  });

  test("without a product id, the product is named inline", async () => {
    setEnv({ STRIPE_ACCOUNTABILITY_PRODUCT: undefined });
    await post({ amount: 5, token: TOKEN, locale: "en" });
    const form = new URLSearchParams(stripe.calls[0].init.body);
    assert.equal(form.get("line_items[0][price_data][product]"), null);
    assert.match(form.get("line_items[0][price_data][product_data][name]"), /WeDeepFocus/);
  });

  test("refuses invalid input without calling Stripe", async () => {
    const bad = [
      { amount: 0, token: TOKEN, locale: "en" },
      { amount: 501, token: TOKEN, locale: "en" },
      { amount: 2.5, token: TOKEN, locale: "en" },
      { amount: "5", token: TOKEN, locale: "en" },
      { amount: 5, token: "short", locale: "en" },
      { amount: 5, token: TOKEN.toUpperCase(), locale: "en" },
      { amount: 5, token: TOKEN, locale: "de" },
      [],
      "not json",
    ];
    for (const body of bad) {
      const response = await post(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(await readJson(response), { error: "invalid_request" });
    }
    assert.equal(stripe.calls.length, 0);
  });

  test("a Stripe error becomes a plain 502 without Stripe details", async () => {
    stripe.restore();
    stripe = fakeStripe(() => stripeAnswer(402, { error: { type: "card_error", message: "secret detail" } }));
    const response = await post({ amount: 5, token: TOKEN, locale: "en" });
    assert.equal(response.status, 502);
    assert.deepEqual(await readJson(response), { error: "stripe_error" });
  });

  test("a missing configuration answers 500", async () => {
    setEnv({ STRIPE_SECRET_KEY: undefined });
    const response = await post({ amount: 5, token: TOKEN, locale: "en" });
    assert.equal(response.status, 500);
    assert.equal(stripe.calls.length, 0);
  });

  test("preflight and other methods", async () => {
    const preflight = await checkout.fetch(new Request("https://focus.example/api/checkout", { method: "OPTIONS" }));
    assert.equal(preflight.status, 204);
    assertCors(preflight, METHODS);
    const get = await checkout.fetch(new Request("https://focus.example/api/checkout"));
    assert.equal(get.status, 405);
  });

  test("never logs the token", async () => {
    await post({ amount: 5, token: TOKEN, locale: "en" });
    assert.ok(consoleCapture.lines.every((line) => !line.includes(TOKEN)));
  });
});
