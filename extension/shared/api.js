// Thin wrappers around chrome.runtime.sendMessage to the background service worker.
// Every call resolves (never rejects): failures come back as { ok: false, reason }.

import { EXTEND_MINUTES } from "./constants.js";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 150;
// Only retried when the message was never delivered (service worker still starting), so no action runs twice.
const NOT_DELIVERED = /Receiving end does not exist|Could not establish connection/i;

function send(type, payload = {}) {
  return attempt({ ...payload, type }, 0);
}

function attempt(message, tries) {
  return new Promise((resolve) => {
    const fail = (error) => {
      if (tries < MAX_RETRIES && NOT_DELIVERED.test(error)) {
        setTimeout(() => attempt(message, tries + 1).then(resolve), RETRY_DELAY_MS * (tries + 1));
      } else {
        resolve({ ok: false, reason: "no_response", error });
      }
    };
    try {
      // Called synchronously so a popup handler can send, then request a permission, in the same gesture.
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) fail(String(lastError.message ?? lastError));
        else if (response && typeof response === "object") resolve(response);
        else resolve({ ok: false, reason: "no_response" });
      });
    } catch (error) {
      fail(String(error?.message ?? error));
    }
  });
}

export const api = {
  getState: () => send("getState"),
  startSession: (minutes) => send("startSession", { minutes }),
  extendSession: (minutes = EXTEND_MINUTES) => send("extendSession", { minutes }),
  // No page offers passes since V4; kept for compatibility.
  grantPass: (domain) => send("grantPass", { domain }),
  // { method: "sentence" } or { method: "paid", sessionId, token }. A bare method string works too.
  endSession: (payload) => send("endSession", typeof payload === "string" ? { method: payload } : payload),
  saveSettings: (patch) => send("saveSettings", { patch }),
  recordStat: (kind) => send("recordStat", { kind }),
  resetAll: () => send("resetAll"),
  openOptions: () => send("openOptions"),
  openOnboarding: () => send("openOnboarding"),
};

// Fires (debounced 50 ms) on storage changes in sync/local, and on host permission changes
// (they change `granted` / `missing` without touching storage). The callback receives nothing.
export function onStateChange(cb) {
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      cb();
    }, 50);
  };
  const storageListener = (changes, area) => {
    if (area === "sync" || area === "local") schedule();
  };
  chrome.storage.onChanged.addListener(storageListener);
  const permissions = chrome.permissions;
  permissions?.onAdded?.addListener(schedule);
  permissions?.onRemoved?.addListener(schedule);

  return () => {
    clearTimeout(timer);
    chrome.storage.onChanged.removeListener(storageListener);
    permissions?.onAdded?.removeListener(schedule);
    permissions?.onRemoved?.removeListener(schedule);
  };
}
