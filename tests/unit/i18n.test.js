import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyI18n, reasonText, t, uiLocale } from "../../extension/shared/i18n.js";

const MESSAGES = {
  hello: "Hello",
  ends_at: "Ends at $1",
  reason_lock_custom: "You can add sites, not remove them.",
  reason_unknown: "Something went wrong.",
  title_key: "Settings",
  placeholder_key: "example.com",
  aria_key: "Close",
};

function installChrome({ uiLanguage = "en-US", uiLocaleMessage = "en_US", throws = false } = {}) {
  const calls = [];
  globalThis.chrome = {
    i18n: {
      getMessage(key, substitutions) {
        calls.push([key, substitutions]);
        if (throws) throw new Error("boom");
        if (key === "@@ui_locale") return uiLocaleMessage;
        const message = MESSAGES[key];
        if (message === undefined) return "";
        return Array.isArray(substitutions) ? message.replace("$1", substitutions[0]) : message;
      },
      getUILanguage() {
        if (throws) throw new Error("boom");
        return uiLanguage;
      },
    },
  };
  return calls;
}

describe("t", () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  test("returns the message", () => {
    installChrome();
    assert.equal(t("hello"), "Hello");
  });

  test("returns the key when the message is missing or the API fails", () => {
    installChrome();
    assert.equal(t("missing_key"), "missing_key");
    installChrome({ throws: true });
    assert.equal(t("hello"), "hello");
  });

  test("converts substitutions to strings and wraps single values", () => {
    const calls = installChrome();
    assert.equal(t("ends_at", ["14:00"]), "Ends at 14:00");
    assert.equal(t("ends_at", 42), "Ends at 42");
    t("ends_at", [3, null]);
    assert.deepEqual(calls.at(-1), ["ends_at", ["3", ""]]);
    t("hello");
    assert.deepEqual(calls.at(-1), ["hello", undefined]);
  });
});

describe("reasonText", () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  test("maps a reason to its reason_ message", () => {
    installChrome();
    assert.equal(reasonText("lock_custom"), "You can add sites, not remove them.");
  });

  test("falls back to reason_unknown", () => {
    installChrome();
    assert.equal(reasonText("something_new"), "Something went wrong.");
    assert.equal(reasonText(undefined), "Something went wrong.");
    assert.equal(reasonText("Bad Reason!"), "Something went wrong.");
  });
});

describe("uiLocale", () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  const cases = [
    ["fr", "fr"],
    ["fr-FR", "fr"],
    ["fr-CA", "fr"],
    ["FR", "fr"],
    ["en-US", "en"],
    ["de", "en"],
    ["", "en"],
  ];
  for (const [language, expected] of cases) {
    test(`${JSON.stringify(language)} -> ${expected}`, () => {
      installChrome({ uiLanguage: language });
      assert.equal(uiLocale(), expected);
    });
  }

  test("falls back to en when the API is unavailable", () => {
    installChrome({ throws: true });
    assert.equal(uiLocale(), "en");
    delete globalThis.chrome;
    assert.equal(uiLocale(), "en");
  });
});

describe("applyI18n", () => {
  afterEach(() => {
    delete globalThis.chrome;
  });

  function element(attributes) {
    const attrs = { ...attributes };
    return {
      textContent: "English fallback",
      attrs,
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      setAttribute: (name, value) => {
        attrs[name] = value;
      },
      matches: (selector) => selector.slice(1, -1) in attrs,
    };
  }

  function fakeDocument(elements) {
    return {
      documentElement: { lang: "" },
      querySelectorAll: (selector) => elements.filter((el) => el.matches(selector)),
    };
  }

  test("fills text, placeholder, title and aria-label, and sets <html lang>", () => {
    installChrome({ uiLocaleMessage: "fr" });
    const text = element({ "data-i18n": "hello" });
    const input = element({ "data-i18n-placeholder": "placeholder_key" });
    const button = element({ "data-i18n-title": "title_key", "data-i18n-aria-label": "aria_key" });
    const empty = element({ "data-i18n": "" });
    const doc = fakeDocument([text, input, button, empty]);

    applyI18n(doc);

    assert.equal(text.textContent, "Hello");
    assert.equal(input.attrs.placeholder, "example.com");
    assert.equal(button.attrs.title, "Settings");
    assert.equal(button.attrs["aria-label"], "Close");
    assert.equal(empty.textContent, "English fallback");
    assert.equal(doc.documentElement.lang, "fr");
  });

  test("works on a subtree, including the root element itself", () => {
    installChrome({ uiLocaleMessage: "en_GB" });
    const child = element({ "data-i18n": "hello" });
    const root = element({ "data-i18n-title": "title_key" });
    root.querySelectorAll = (selector) => [child].filter((el) => el.matches(selector));
    const doc = { documentElement: { lang: "" } };
    root.ownerDocument = doc;

    applyI18n(root);

    assert.equal(child.textContent, "Hello");
    assert.equal(root.attrs.title, "Settings");
    assert.equal(doc.documentElement.lang, "en");
  });

  test("missing keys stay visible as the key", () => {
    installChrome();
    const text = element({ "data-i18n": "not_translated" });
    applyI18n(fakeDocument([text]));
    assert.equal(text.textContent, "not_translated");
  });
});
