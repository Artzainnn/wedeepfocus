// Feedback page links: language, origin tag, version, and nothing else in the address.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { feedbackUrl } from "../../extension/shared/feedback.js";
import { FEEDBACK_URLS } from "../../extension/shared/config.js";

describe("feedbackUrl", () => {
  test("French gets the French page, every other language the default one", () => {
    assert.ok(feedbackUrl("fr", "menu").startsWith(FEEDBACK_URLS.fr));
    assert.ok(feedbackUrl("fr-CA", "menu").startsWith(FEEDBACK_URLS.fr));
    for (const locale of ["en", "de", "", undefined]) assert.ok(feedbackUrl(locale, "menu").startsWith(FEEDBACK_URLS.other), String(locale));
  });

  test("tags the origin and the version, and only those", () => {
    const url = new URL(feedbackUrl("en", "uninstall", "1.1.0"));
    assert.equal(url.protocol, "https:");
    assert.deepEqual([...url.searchParams.keys()].sort(), ["from", "v"]);
    assert.equal(url.searchParams.get("from"), "uninstall");
    assert.equal(url.searchParams.get("v"), "1.1.0");
    assert.equal(new URL(feedbackUrl("en", "menu")).searchParams.has("v"), false);
  });
});
