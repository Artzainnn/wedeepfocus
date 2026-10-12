// shared/payment.js (SPEC 13.8): amounts, display, one-time tokens and the two payment server calls,
// with globalThis.fetch mocked.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_AMOUNT_MAX, CUSTOM_AMOUNT_MIN, PAYMENT_AMOUNTS, PAYMENT_API } from "../../extension/shared/constants.js";
import {
  PAYMENT_TIMEOUT_MS,
  createCheckout,
  formatAmount,
  isPresetAmount,
  isValidAmount,
  newPaymentToken,
  verifyPayment,
} from "../../extension/shared/payment.js";

const NBSP = String.fromCodePoint(0xa0);
const TOKEN = "0123456789abcdef0123456789abcdef";
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_a1";
const UNAVAILABLE = { ok: false, reason: "payment_unavailable" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Replaces fetch for one test. `respond(url, init)` returns (or rejects with) what fetch would.
function mockFetch(t, respond) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  });
  return calls;
}

// A fetch that only settles when its request is aborted.
function hangingFetch(t) {
  const state = { aborted: false };
  mockFetch(t, (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      state.aborted = true;
      reject(init.signal.reason);
    });
  }));
  return state;
}

// Captures setTimeout / clearTimeout for one test so a timeout can be fired by hand.
function fakeTimers(t) {
  const pending = new Map();
  let nextId = 1;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    pending.set(nextId, { callback, delay });
    return nextId++;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => pending.delete(id));
  return {
    delays: () => [...pending.values()].map((timer) => timer.delay),
    fireAll() {
      for (const [id, timer] of [...pending]) {
        pending.delete(id);
        timer.callback();
      }
    },
  };
}

describe("amounts", () => {
  test("isPresetAmount: only the four preset numbers", () => {
    for (const amount of PAYMENT_AMOUNTS) assert.equal(isPresetAmount(amount), true, String(amount));
    for (const amount of [1, 3, 7, 50, 500, 0, -5, 2.5, "5", null, undefined, Number.NaN]) {
      assert.equal(isPresetAmount(amount), false, String(amount));
    }
  });

  test("isValidAmount: whole numbers from CUSTOM_AMOUNT_MIN to CUSTOM_AMOUNT_MAX", () => {
    for (const amount of [CUSTOM_AMOUNT_MIN, 2, 7, 37, 499, CUSTOM_AMOUNT_MAX, ...PAYMENT_AMOUNTS]) {
      assert.equal(isValidAmount(amount), true, String(amount));
    }
    const invalid = [0, -1, CUSTOM_AMOUNT_MAX + 1, 2.5, 0.99, Number.NaN, Infinity, "5", "", null, undefined, true, [5], { amount: 5 }];
    for (const amount of invalid) assert.equal(isValidAmount(amount), false, JSON.stringify(amount));
  });
});

describe("formatAmount", () => {
  test("French puts the euro sign after, with a no-break space; English before", () => {
    assert.equal(formatAmount(5, "fr"), `5${NBSP}€`);
    assert.equal(formatAmount(500, "fr"), `500${NBSP}€`);
    assert.equal(formatAmount(5, "en"), "$5");
    assert.equal(formatAmount(20, "en"), "$20");
  });

  test("regional tags, Chrome style tags and missing or invalid locales", () => {
    for (const locale of ["fr-FR", "fr_FR", "fr-CA"]) assert.equal(formatAmount(10, locale), `10${NBSP}€`, locale);
    for (const locale of ["en-US", "en_GB", undefined, null, "", "not a locale!"]) {
      assert.equal(formatAmount(10, locale), "$10", String(locale));
    }
  });

  test("never shows decimals", () => {
    assert.equal(formatAmount(2, "en"), "$2");
    assert.doesNotMatch(formatAmount(37, "fr"), /[.,]/);
  });

  test("numeric strings are shown, anything else gives an empty string", () => {
    assert.equal(formatAmount("10", "en"), "$10");
    for (const amount of [Number.NaN, Infinity, null, undefined, "", "  ", "abc", {}, []]) {
      assert.equal(formatAmount(amount, "en"), "", JSON.stringify(amount));
    }
  });
});

describe("newPaymentToken", () => {
  test("32 lowercase hex characters, different every time", () => {
    const tokens = Array.from({ length: 100 }, () => newPaymentToken());
    for (const token of tokens) assert.match(token, /^[0-9a-f]{32}$/);
    assert.equal(new Set(tokens).size, tokens.length);
  });
});

describe("createCheckout", () => {
  test("posts the amount, the token and the language, and returns the Stripe page and session id", async (t) => {
    const calls = mockFetch(t, () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }));
    const result = await createCheckout({ amount: 5, token: TOKEN, locale: "fr" });
    assert.deepEqual(result, { ok: true, url: STRIPE_URL, sessionId: "cs_test_a1" });
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, `${PAYMENT_API}/api/checkout`);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { amount: 5, token: TOKEN, locale: "fr", currency: "eur" });
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  });

  test("custom amounts and fresh tokens are sent as they are", async (t) => {
    const calls = mockFetch(t, () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }));
    const token = newPaymentToken();
    assert.equal((await createCheckout({ amount: 37, token, locale: "en" })).ok, true);
    assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 37, token, locale: "en", currency: "usd" });
  });

  test("the language sent is fr or en", async (t) => {
    const calls = mockFetch(t, () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }));
    const locales = { fr: "fr", "fr-FR": "fr", fr_CA: "fr", FR: "fr", en: "en", "en-GB": "en", de: "en", "": "en" };
    for (const [locale, sent] of Object.entries(locales)) {
      await createCheckout({ amount: 5, token: TOKEN, locale });
      assert.equal(JSON.parse(calls.at(-1).init.body).locale, sent, locale);
    }
    await createCheckout({ amount: 5, token: TOKEN });
    assert.equal(JSON.parse(calls.at(-1).init.body).locale, "en");
  });

  test("an invalid amount or token is refused without calling the server", async (t) => {
    const calls = mockFetch(t, () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }));
    for (const amount of [0, CUSTOM_AMOUNT_MAX + 1, 2.5, "5", null, undefined]) {
      assert.deepEqual(await createCheckout({ amount, token: TOKEN, locale: "en" }), UNAVAILABLE, JSON.stringify(amount));
    }
    for (const token of [undefined, "", "abc", `${TOKEN.slice(1)}g`, "a".repeat(65), 42]) {
      assert.deepEqual(await createCheckout({ amount: 5, token, locale: "en" }), UNAVAILABLE, JSON.stringify(token));
    }
    assert.deepEqual(await createCheckout(), UNAVAILABLE);
    assert.equal(calls.length, 0);
  });

  test("HTTP errors, malformed JSON and unexpected answers mean payment_unavailable", async (t) => {
    const answers = [
      () => json({ error: "invalid amount" }, 400),
      () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }, 500),
      () => new Response("<html>Bad gateway</html>", { status: 200 }),
      () => new Response("", { status: 200 }),
      () => json(null),
      () => json([STRIPE_URL, "cs_test_a1"]),
      () => json({ url: STRIPE_URL }),
      () => json({ sessionId: "cs_test_a1" }),
      () => json({ url: STRIPE_URL, sessionId: "" }),
      () => json({ url: STRIPE_URL, sessionId: 7 }),
      () => json({ url: STRIPE_URL, sessionId: "x".repeat(256) }),
      () => json({ url: "javascript:alert(1)", sessionId: "cs_test_a1" }),
      () => json({ url: "/checkout", sessionId: "cs_test_a1" }),
      () => json({ url: 42, sessionId: "cs_test_a1" }),
    ];
    let answer;
    mockFetch(t, () => answer());
    for (const [index, respond] of answers.entries()) {
      answer = respond;
      assert.deepEqual(await createCheckout({ amount: 5, token: TOKEN, locale: "en" }), UNAVAILABLE, `answer ${index}`);
    }
  });

  test("a network error never throws", async (t) => {
    mockFetch(t, () => Promise.reject(new TypeError("Failed to fetch")));
    assert.deepEqual(await createCheckout({ amount: 5, token: TOKEN, locale: "en" }), UNAVAILABLE);
    t.mock.method(globalThis, "fetch", () => {
      throw new TypeError("fetch is not available");
    });
    assert.deepEqual(await createCheckout({ amount: 5, token: TOKEN, locale: "en" }), UNAVAILABLE);
  });

  test("a server that never answers is abandoned after PAYMENT_TIMEOUT_MS (10 s)", async (t) => {
    assert.equal(PAYMENT_TIMEOUT_MS, 10_000);
    const timers = fakeTimers(t);
    const fetchState = hangingFetch(t);
    const pending = createCheckout({ amount: 5, token: TOKEN, locale: "en" });
    assert.deepEqual(timers.delays(), [PAYMENT_TIMEOUT_MS]);
    timers.fireAll();
    assert.deepEqual(await pending, UNAVAILABLE);
    assert.equal(fetchState.aborted, true);
  });

  test("the timeout is cleared once the server answered", async (t) => {
    const timers = fakeTimers(t);
    mockFetch(t, () => json({ url: STRIPE_URL, sessionId: "cs_test_a1" }));
    assert.equal((await createCheckout({ amount: 5, token: TOKEN, locale: "en" })).ok, true);
    assert.deepEqual(timers.delays(), []);
  });
});

describe("verifyPayment", () => {
  test("asks the server about this session and token, and returns paid", async (t) => {
    const calls = mockFetch(t, () => json({ paid: true }));
    assert.deepEqual(await verifyPayment({ sessionId: "cs_test_a1", token: TOKEN }), { ok: true, paid: true });
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, `${PAYMENT_API}/api/verify?session_id=cs_test_a1&token=${TOKEN}`);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  });

  test("an unpaid session is an answer, not an error", async (t) => {
    mockFetch(t, () => json({ paid: false }));
    assert.deepEqual(await verifyPayment({ sessionId: "cs_test_a1", token: TOKEN }), { ok: true, paid: false });
  });

  test("the session id is URL encoded", async (t) => {
    const calls = mockFetch(t, () => json({ paid: false }));
    await verifyPayment({ sessionId: "cs_test_a/b?c&d=e", token: TOKEN });
    const query = new URL(calls[0].url).searchParams;
    assert.equal(query.get("session_id"), "cs_test_a/b?c&d=e");
    assert.equal(query.get("token"), TOKEN);
  });

  test("HTTP errors, malformed JSON and unexpected answers mean payment_unavailable", async (t) => {
    const answers = [
      () => json({ paid: true }, 500),
      () => json({ error: "missing token" }, 400),
      () => json({ paid: true }, 404),
      () => new Response("{ paid: true", { status: 200 }),
      () => json({}),
      () => json({ paid: "yes" }),
      () => json({ paid: 1 }),
      () => json(null),
      () => json([true]),
    ];
    let answer;
    mockFetch(t, () => answer());
    for (const [index, respond] of answers.entries()) {
      answer = respond;
      assert.deepEqual(await verifyPayment({ sessionId: "cs_test_a1", token: TOKEN }), UNAVAILABLE, `answer ${index}`);
    }
  });

  test("a network error never throws", async (t) => {
    mockFetch(t, () => Promise.reject(new TypeError("Failed to fetch")));
    assert.deepEqual(await verifyPayment({ sessionId: "cs_test_a1", token: TOKEN }), UNAVAILABLE);
  });

  test("a server that never answers is abandoned after PAYMENT_TIMEOUT_MS", async (t) => {
    const timers = fakeTimers(t);
    const fetchState = hangingFetch(t);
    const pending = verifyPayment({ sessionId: "cs_test_a1", token: TOKEN });
    assert.deepEqual(timers.delays(), [PAYMENT_TIMEOUT_MS]);
    timers.fireAll();
    assert.deepEqual(await pending, UNAVAILABLE);
    assert.equal(fetchState.aborted, true);
  });

  test("a malformed session id or token can't be paid: no request", async (t) => {
    const calls = mockFetch(t, () => json({ paid: true }));
    const proofs = [
      {},
      { sessionId: "cs_test_a1" },
      { token: TOKEN },
      { sessionId: "", token: TOKEN },
      { sessionId: 42, token: TOKEN },
      { sessionId: "x".repeat(256), token: TOKEN },
      { sessionId: "cs_test_a1", token: "not hex at all, not even close!!" },
      { sessionId: "cs_test_a1", token: TOKEN.slice(2) },
    ];
    for (const proof of proofs) {
      assert.deepEqual(await verifyPayment(proof), { ok: true, paid: false }, JSON.stringify(proof));
    }
    assert.deepEqual(await verifyPayment(), { ok: true, paid: false });
    assert.equal(calls.length, 0);
  });
});
