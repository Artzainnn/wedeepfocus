// French UI (SPEC sections 1, 8 and 12). Chromium runs with --lang=fr and the temp copy of the
// extension only ships the fr catalog (macOS ignores --lang when choosing extension messages).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  COFFEE_LABEL,
  DEFAULT_PHRASE,
  SUITE_TIMEOUT,
  assertDefaultGroups,
  findRawI18nKeys,
  isDisabled,
  launch,
  normalizeCopy,
  readMessages,
  requireExtensionFiles,
  stripDiacritics,
  waitFor,
  withGroup,
} from "./helpers.js";

const PAGES = [
  { name: "popup", path: "popup/popup.html", ready: "popup-status" },
  { name: "options", path: "options/options.html", ready: "options-groups" },
  { name: "onboarding", path: "onboarding/onboarding.html", ready: "onb-step-1" },
];

const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

describe("French locale", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let fr;
  let en;
  let frenchActive = false;

  before(async () => {
    requireExtensionFiles(...PAGES.map((p) => p.path), "blocked/blocked.html", "blocked/blocked.js");
    ctx = await launch({ locale: "fr" });
    fr = readMessages("fr");
    en = readMessages("en");
  });

  after(async () => {
    await ctx?.close();
  });

  const skipUnlessFrench = (t) => {
    if (!frenchActive) t.skip("French UI could not be forced in this environment");
    return !frenchActive;
  };

  // <html lang> comes from @@ui_locale (Chrome's own UI language, SPEC 5 i18n.js). On macOS
  // that stays the OS language whatever --lang says, so it can only be checked when it is fr.
  async function checkHtmlLang(t, page, name) {
    const { lang, uiLocale } = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      uiLocale: chrome.i18n.getMessage("@@ui_locale"),
    }));
    if (uiLocale.toLowerCase().startsWith("fr")) {
      assert.equal(lang, "fr", `${name} sets <html lang="fr">`);
    } else {
      assert.ok(["en", "fr"].includes(lang), `${name} sets <html lang> to "en" or "fr", got "${lang}"`);
      t.diagnostic(`<html lang> not checked: Chrome UI locale is ${uiLocale} in this environment`);
    }
  }

  test("the extension runs in French", async (t) => {
    const info = await ctx.inExtensionPage(() => ({
      ui: chrome.i18n.getUILanguage(),
      phrase: chrome.i18n.getMessage("blocked_friction_phrase"),
    }));
    if (!info.ui.toLowerCase().startsWith("fr")) {
      t.skip(`asked for fr but chrome.i18n.getUILanguage() is "${info.ui}"`);
      return;
    }
    frenchActive = true;
    assert.equal(info.phrase, fr.blocked_friction_phrase?.message);
    assert.notEqual(fr.blocked_friction_phrase.message, en.blocked_friction_phrase?.message, "the fr phrase is translated");
  });

  test("the V3 French copy: default sentence and coffee label", (t) => {
    if (skipUnlessFrench(t)) return;
    assert.equal(normalizeCopy(fr.blocked_friction_phrase.message), normalizeCopy(DEFAULT_PHRASE.fr), "blocked_friction_phrase (fr)");
    assert.equal(normalizeCopy(fr.common_coffee?.message), normalizeCopy(COFFEE_LABEL.fr), "common_coffee (fr)");
  });

  test("the default groups use the French presets", async (t) => {
    if (skipUnlessFrench(t)) return;
    const state = await ctx.getState();
    assert.equal(state.locale, "fr");
    await assertDefaultGroups(state.settings.groups, "fr");

    const res = await ctx.saveSettings({ groups: withGroup(state.settings.groups, "news", { enabled: true }) });
    assert.equal(res?.ok, true, `enabling the news group should succeed, got ${JSON.stringify(res)}`);
    const { domains } = await ctx.getState();
    assert.ok(domains.includes("lemonde.fr"), `fr news presets expected in ${JSON.stringify(domains)}`);
    assert.ok(!domains.includes("cnn.com"), "en news presets are not used");
  });

  for (const spec of PAGES) {
    test(`the ${spec.name} page is fully translated`, { timeout: 30_000 }, async (t) => {
      if (skipUnlessFrench(t)) return;
      const page = await ctx.openExtensionPage(spec.path);
      await page.getByTestId(spec.ready).waitFor({ state: "visible" });
      await checkHtmlLang(t, page, spec.name);
      assert.deepEqual(await findRawI18nKeys(page), [], "no untranslated i18n keys");

      // Static [data-i18n] elements must not keep their English fallback text.
      const problems = await page.evaluate(
        ({ frMessages, enMessages }) => {
          const out = [];
          for (const el of document.querySelectorAll("[data-i18n]")) {
            const key = el.getAttribute("data-i18n");
            const frText = frMessages[key]?.message;
            const enText = enMessages[key]?.message;
            const shown = el.textContent.replace(/\s+/g, " ").trim();
            if (!frText) out.push(`${key}: missing from the fr catalog`);
            else if (enText && enText !== frText && shown === enText.replace(/\s+/g, " ").trim()) out.push(`${key}: still in English`);
          }
          return out;
        },
        { frMessages: fr, enMessages: en },
      );
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test("the blocked page is in French and the French sentence (accents included) ends the session", { timeout: 60_000 }, async (t) => {
    if (skipUnlessFrench(t)) return;
    await ctx.startSessionDirect(20);
    const url = ctx.site("linkedin.com", "/feed/?lang=fr");
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, url);
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });
    await checkHtmlLang(t, page, "blocked page");
    assert.deepEqual(await findRawI18nKeys(page), []);
    const frTexts = new Set(Object.values(fr).map((m) => normalize(m.message)));
    const backLabel = normalize(await page.getByTestId("blocked-back").innerText());
    assert.ok(frTexts.has(backLabel), `"${backLabel}" should be a French message`);

    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });

    const phrase = fr.blocked_friction_phrase.message;
    assert.equal(normalize(await page.getByTestId("friction-phrase").textContent()), normalize(phrase));
    await page.getByTestId("friction-input").click();
    await page.keyboard.type(phrase);
    assert.equal(await page.getByTestId("friction-input").inputValue(), phrase);

    const unlock = page.getByTestId("friction-unlock");
    await waitFor(async () => !(await isDisabled(unlock)), { message: "the unlock button to be enabled" });
    await unlock.click();
    // The sentence ends the whole session (SPEC 13), then Continue opens the site.
    await page.getByTestId("friction-ended").waitFor({ state: "visible" });
    assert.deepEqual(await findRawI18nKeys(page), []);
    await page.getByTestId("blocked-continue").click();
    await ctx.expectSiteLoaded(page, url);
    await page.close();
  });

  test("the French sentence typed without accents ends the session too", { timeout: 60_000 }, async (t) => {
    if (skipUnlessFrench(t)) return;
    // The test above ended its session: a new one blocks again.
    await ctx.startSessionDirect(20);
    const url = ctx.site("facebook.com", "/?lang=fr");
    const page = await ctx.newPage();
    await ctx.gotoBlocked(page, url);
    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });

    const phrase = fr.blocked_friction_phrase.message;
    const typed = stripDiacritics(phrase);
    assert.notEqual(typed, phrase, "the French sentence has accents to leave out");
    await page.getByTestId("friction-input").click();
    await page.keyboard.type(typed);
    assert.equal(await page.getByTestId("friction-input").inputValue(), typed, "accents are optional (SPEC 11.3)");

    const unlock = page.getByTestId("friction-unlock");
    await waitFor(async () => !(await isDisabled(unlock)), { message: "the unlock button to be enabled" });
    await unlock.click();
    // The sentence ends the whole session (SPEC 13), then Continue opens the site.
    await page.getByTestId("friction-ended").waitFor({ state: "visible" });
    assert.deepEqual(await findRawI18nKeys(page), []);
    await page.getByTestId("blocked-continue").click();
    await ctx.expectSiteLoaded(page, url);
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
