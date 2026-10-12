// Custom unlock sentence (SPEC 11.3, 12.5, 12.7): validated by the background, edited in the
// options page, locked during a block, and required on the blocked page instead of the default.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MINUTE,
  SETTINGS_KEYS,
  SUITE_TIMEOUT,
  findRawI18nKeys,
  isDisabled,
  isShown,
  launch,
  normalizeSpaces,
  requireExtensionFiles,
  sleep,
  stripDiacritics,
  waitFor,
  waitForValue,
} from "./helpers.js";

const PHRASE_MIN = 40;
const PHRASE_MAX = 300;
// Over 60 characters, with typographic apostrophes (U+2019) and an accent.
const CUSTOM_PHRASE = "Okay, I’m taking this little détour on purpose, and I’ll be back to my real work in ten minutes.";
const VALID_PHRASE = "I finish the task in front of me before I open anything else today.";
const TOO_SHORT = "Just five more minutes.";
const AUTOSAVE_WAIT_MS = 1_500; // comfortably longer than the 600 ms options debounce

/** A phrase of exactly `length` characters, no leading, trailing or repeated spaces. */
function phraseOfLength(length) {
  const text = "Stay with the work in front of you. ".repeat(Math.ceil(length / 36) + 1).slice(0, length - 1);
  return `${text}.`;
}

describe("custom unlock sentence", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let defaultPhrase;
  let page;
  let originalUrl;

  before(async () => {
    requireExtensionFiles("options/options.html", "options/options.js", "blocked/blocked.html", "blocked/blocked.js");
    ctx = await launch();
    defaultPhrase = await ctx.defaultPhrase();
  });

  after(async () => {
    await ctx?.close();
  });

  const storedPhrase = async () => (await ctx.getSync("unlock")).unlock?.phrase ?? "";

  async function expectRefused(patch, reason) {
    const before = await ctx.getSync(SETTINGS_KEYS);
    const res = await ctx.saveSettings(patch);
    assert.equal(res?.ok, false, `${JSON.stringify(patch)} should be refused, got ${JSON.stringify(res)}`);
    assert.equal(res.reason, reason, `reason for ${JSON.stringify(patch)}`);
    assert.deepEqual(await ctx.getSync(SETTINGS_KEYS), before, "refused changes are not written");
  }

  async function expectSaved(phrase, expected = phrase) {
    const res = await ctx.saveSettings({ unlock: { phrase } });
    assert.equal(res?.ok, true, `${JSON.stringify(phrase)} should be accepted, got ${JSON.stringify(res)}`);
    assert.equal(await storedPhrase(), expected);
  }

  test("outside a block, sentences that are too short, too long or multi-line are refused", async () => {
    const { settings, block } = await ctx.getState();
    assert.equal(block.active, false);
    assert.deepEqual(settings.unlock, { phrase: "", mode: "free", amount: 5 }, "the default sentence is used until the user sets one");

    const under = phraseOfLength(PHRASE_MIN - 1);
    const over = phraseOfLength(PHRASE_MAX + 1);
    assert.equal(under.length, PHRASE_MIN - 1);
    assert.equal(over.length, PHRASE_MAX + 1);
    for (const phrase of [TOO_SHORT, under, over, "I finish the task in front of me\nbefore I open anything else today."]) {
      await expectRefused({ unlock: { phrase } }, "invalid_phrase");
    }
  });

  test("valid sentences are saved trimmed with their spaces collapsed, and can be reset", async () => {
    await expectSaved(phraseOfLength(PHRASE_MIN));
    await expectSaved(phraseOfLength(PHRASE_MAX));
    await expectSaved(`  ${VALID_PHRASE.replace("in front", "in   front")}  `, VALID_PHRASE);
    await expectSaved("");
    assert.deepEqual((await ctx.getState()).settings.unlock, { phrase: "", mode: "free", amount: 5 });
  });

  test("the options page edits, validates and resets the sentence", { timeout: 60_000 }, async () => {
    const options = await ctx.openOptions();
    await options.getByTestId("options-phrase").waitFor({ state: "visible" });
    const input = options.getByTestId("phrase-input");
    await waitFor(async () => normalizeSpaces(await input.getAttribute("placeholder")) === normalizeSpaces(defaultPhrase), {
      message: "the textarea placeholder to show the default sentence",
    });
    assert.equal(await input.inputValue(), "", "empty while the default sentence is used");
    assert.equal(await isDisabled(input), false, "editable outside a block");

    await input.fill(TOO_SHORT);
    await input.blur();
    await options.getByTestId("phrase-error").waitFor({ state: "visible" });
    await sleep(AUTOSAVE_WAIT_MS);
    assert.equal(await storedPhrase(), "", "an invalid sentence is not saved");

    await input.fill(VALID_PHRASE);
    await waitForValue(storedPhrase, (phrase) => phrase === VALID_PHRASE, {
      message: "the sentence typed in the options page to be saved",
    });
    await waitFor(async () => !(await isShown(options.getByTestId("phrase-error"))), { message: "the error to clear" });

    await options.getByTestId("phrase-reset").click();
    await waitForValue(storedPhrase, (phrase) => phrase === "", { message: "phrase-reset to store an empty phrase" });
    await waitFor(async () => (await input.inputValue()) === "", { message: "the textarea to be emptied by the reset" });
    assert.deepEqual(await findRawI18nKeys(options), [], "no untranslated i18n keys on the options page");
    await options.close();
  });

  test("during a block the sentence can't be changed or reset (lock_phrase)", { timeout: 20_000 }, async () => {
    await ctx.setSync({ unlock: { phrase: CUSTOM_PHRASE } });
    await ctx.startSessionDirect(30);
    assert.equal((await ctx.getState()).block.active, true);

    await expectRefused({ unlock: { phrase: VALID_PHRASE } }, "lock_phrase");
    await expectRefused({ unlock: { phrase: "" } }, "lock_phrase");
    assert.equal(await storedPhrase(), CUSTOM_PHRASE);

    const res = await ctx.saveSettings({ goals: { items: ["Write the report"], showQuote: true } });
    assert.equal(res?.ok, true, `the goal stays editable during a block, got ${JSON.stringify(res)}`);
  });

  test("the options page shows the custom sentence and locks it during a block", { timeout: 30_000 }, async () => {
    const options = await ctx.openOptions();
    await options.getByTestId("options-lock-banner").waitFor({ state: "visible" });
    const input = options.getByTestId("phrase-input");
    await waitFor(async () => (await input.inputValue()) === CUSTOM_PHRASE, {
      message: "the textarea to be prefilled with the custom sentence",
    });
    await waitFor(() => isDisabled(input), { message: "the sentence textarea to be disabled during the block" });
    const reset = options.getByTestId("phrase-reset");
    assert.ok(!(await isShown(reset)) || (await isDisabled(reset)), "reset is hidden or disabled during a block");
    await options.close();
  });

  test("the blocked page asks for the custom sentence instead of the default one", { timeout: 30_000 }, async () => {
    originalUrl = ctx.site("linkedin.com", "/feed/?from=custom-phrase");
    page = await ctx.newPage();
    await ctx.gotoBlocked(page, originalUrl);
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });
    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });

    const phrase = page.getByTestId("friction-phrase");
    await waitFor(async () => normalizeSpaces(await phrase.textContent()) === normalizeSpaces(CUSTOM_PHRASE), {
      message: () => "friction-phrase to show the custom sentence",
    });

    // The default sentence is not accepted anymore: its first letter is already a typo.
    assert.notEqual(defaultPhrase[0].toLowerCase(), CUSTOM_PHRASE[0].toLowerCase());
    const input = page.getByTestId("friction-input");
    await input.click();
    await page.keyboard.type(defaultPhrase[0]);
    assert.equal(await input.inputValue(), "", "the default sentence is rejected");
    await page.getByTestId("friction-error").waitFor({ state: "visible" });
  });

  test("typing it without accents and with a straight apostrophe ends the session", { timeout: 60_000 }, async () => {
    const typed = stripDiacritics(CUSTOM_PHRASE).replace(/’/g, "'");
    assert.ok(!/[é’]/.test(typed), "typed without the accent or the typographic apostrophe");
    const input = page.getByTestId("friction-input");
    await input.click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed);
    assert.equal(await input.inputValue(), typed, "no character was rejected");

    const unlock = page.getByTestId("friction-unlock");
    await waitFor(async () => !(await isDisabled(unlock)), { message: "the unlock button to be enabled" });
    await unlock.click();
    // The sentence ends the whole session (SPEC 13), then Continue opens the site.
    await page.getByTestId("friction-ended").waitFor({ state: "visible" });
    await page.getByTestId("blocked-continue").click();
    await ctx.expectSiteLoaded(page, originalUrl);
    assert.equal((await ctx.getState()).block.active, false, "the session is over");
    await page.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
