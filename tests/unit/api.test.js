import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { api, onStateChange } from "../../extension/shared/api.js";
import { fakeEvent } from "./helpers.js";

const NOT_DELIVERED = "Could not establish connection. Receiving end does not exist.";

// respond(message) returns the response, or { lastError } to simulate a chrome.runtime.lastError.
function installChrome(respond) {
  const state = { sent: [], lastError: undefined };
  const chrome = {
    runtime: {
      get lastError() {
        return state.lastError;
      },
      sendMessage(message, callback) {
        state.sent.push(message);
        const result = respond(message, state.sent.length);
        queueMicrotask(() => {
          if (result && result.lastError) {
            state.lastError = { message: result.lastError };
            callback(undefined);
            state.lastError = undefined;
          } else {
            callback(result);
          }
        });
      },
    },
    storage: { onChanged: fakeEvent() },
    permissions: { onAdded: fakeEvent(), onRemoved: fakeEvent() },
  };
  globalThis.chrome = chrome;
  return { chrome, state };
}

function removeChrome() {
  delete globalThis.chrome;
}

describe("api", () => {
  afterEach(removeChrome);

  test("each method sends { type, ...payload } and resolves with the response", async () => {
    const { state } = installChrome((message) => ({ ok: true, echo: message }));
    const calls = [
      [() => api.getState(), { type: "getState" }],
      [() => api.startSession(20), { type: "startSession", minutes: 20 }],
      [() => api.extendSession(15), { type: "extendSession", minutes: 15 }],
      [() => api.grantPass("x.com"), { type: "grantPass", domain: "x.com" }],
      [() => api.saveSettings({ goals: { items: ["a"], showQuote: true } }), {
        type: "saveSettings",
        patch: { goals: { items: ["a"], showQuote: true } },
      }],
      [() => api.recordStat("resisted"), { type: "recordStat", kind: "resisted" }],
      [() => api.openOptions(), { type: "openOptions" }],
      [() => api.openOnboarding(), { type: "openOnboarding" }],
    ];
    for (const [call, expected] of calls) {
      const response = await call();
      assert.deepEqual(response, { ok: true, echo: expected });
    }
    assert.equal(state.sent.length, calls.length);
  });

  test("extendSession defaults to EXTEND_MINUTES", async () => {
    const { state } = installChrome(() => ({ ok: true }));
    await api.extendSession();
    assert.deepEqual(state.sent[0], { type: "extendSession", minutes: 15 });
  });

  test("the message is sent synchronously, before any await (user gesture flows)", () => {
    const { state } = installChrome(() => ({ ok: true }));
    const pending = api.saveSettings({ sites: {} });
    assert.equal(state.sent.length, 1);
    return pending;
  });

  test("a refusal resolves instead of throwing", async () => {
    installChrome(() => ({ ok: false, reason: "lock_custom" }));
    assert.deepEqual(await api.saveSettings({}), { ok: false, reason: "lock_custom" });
  });

  test("retries when the service worker was not reachable yet", async () => {
    const { state } = installChrome((message, count) => (count < 3 ? { lastError: NOT_DELIVERED } : { ok: true, count }));
    assert.deepEqual(await api.getState(), { ok: true, count: 3 });
    assert.equal(state.sent.length, 3);
  });

  test("gives up after the retries with no_response", async () => {
    const { state } = installChrome(() => ({ lastError: NOT_DELIVERED }));
    const response = await api.getState();
    assert.equal(response.ok, false);
    assert.equal(response.reason, "no_response");
    assert.equal(state.sent.length, 3);
  });

  test("other errors are not retried (the message may have been handled)", async () => {
    const { state } = installChrome(() => ({ lastError: "The message port closed before a response was received." }));
    const response = await api.extendSession(10);
    assert.equal(response.reason, "no_response");
    assert.equal(state.sent.length, 1);
  });

  test("an empty response becomes no_response", async () => {
    installChrome(() => undefined);
    assert.deepEqual(await api.getState(), { ok: false, reason: "no_response" });
  });

  test("a throwing sendMessage becomes no_response", async () => {
    installChrome(() => ({ ok: true }));
    globalThis.chrome.runtime.sendMessage = () => {
      throw new Error("Extension context invalidated.");
    };
    const response = await api.getState();
    assert.equal(response.reason, "no_response");
    assert.match(response.error, /context invalidated/);
  });
});

describe("onStateChange", () => {
  let chrome;

  afterEach(removeChrome);

  beforeEach(() => {
    ({ chrome } = installChrome(() => ({ ok: true })));
  });

  test("debounces storage changes from sync and local", async () => {
    let calls = 0;
    const stop = onStateChange(() => calls++);
    chrome.storage.onChanged.emit({ sites: {} }, "sync");
    chrome.storage.onChanged.emit({ session: {} }, "local");
    chrome.storage.onChanged.emit({ passes: {} }, "local");
    assert.equal(calls, 0);
    await delay(90);
    assert.equal(calls, 1);
    stop();
  });

  test("ignores the session storage area", async () => {
    let calls = 0;
    const stop = onStateChange(() => calls++);
    chrome.storage.onChanged.emit({ enforced: {} }, "session");
    await delay(90);
    assert.equal(calls, 0);
    stop();
  });

  test("fires on host permission changes", async () => {
    let calls = 0;
    const stop = onStateChange(() => calls++);
    chrome.permissions.onAdded.emit({ origins: ["*://x.com/*"] });
    await delay(90);
    chrome.permissions.onRemoved.emit({ origins: ["*://x.com/*"] });
    await delay(90);
    assert.equal(calls, 2);
    stop();
  });

  test("unsubscribe removes every listener and cancels a pending call", async () => {
    let calls = 0;
    const stop = onStateChange(() => calls++);
    chrome.storage.onChanged.emit({ sites: {} }, "sync");
    stop();
    await delay(90);
    assert.equal(calls, 0);
    assert.equal(chrome.storage.onChanged.listeners.size, 0);
    assert.equal(chrome.permissions.onAdded.listeners.size, 0);
    assert.equal(chrome.permissions.onRemoved.listeners.size, 0);
  });

  test("works without the permissions API", async () => {
    delete chrome.permissions;
    let calls = 0;
    const stop = onStateChange(() => calls++);
    chrome.storage.onChanged.emit({ sites: {} }, "sync");
    await delay(90);
    assert.equal(calls, 1);
    stop();
  });
});
