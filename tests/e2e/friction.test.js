// Friction flow on the blocked page (SPEC 12.7): one question ("is it really worth it?"), then
// typing the unlock sentence with paste disabled and typos rejected, which grants a 10 minute
// pass for that site only.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PHRASE,
  HEADED,
  MINUTE,
  SUITE_TIMEOUT,
  isDisabled,
  isShown,
  launch,
  normalizeCopy,
  requireExtensionFiles,
  waitFor,
  waitForValue,
} from "./helpers.js";

describe("friction flow", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;
  let page;
  let originalUrl;
  let phrase;
  let pasteNotice;
  const typedPrefixLength = 12;

  before(async () => {
    requireExtensionFiles("blocked/blocked.html", "blocked/blocked.js");
    ctx = await launch();
    await ctx.startSessionDirect(30);
    originalUrl = ctx.site("linkedin.com", "/in/someone/?from=friction");
    page = await ctx.newPage();
    await ctx.gotoBlocked(page, originalUrl);
    await page.getByTestId("blocked-main").waitFor({ state: "visible" });
  });

  after(async () => {
    await ctx?.close();
  });

  const input = () => page.getByTestId("friction-input");
  const inputValue = () => input().inputValue();

  test("the default sentence is the new V3 sentence", async () => {
    phrase = await ctx.defaultPhrase();
    assert.equal(normalizeCopy(phrase), normalizeCopy(DEFAULT_PHRASE.en), "blocked_friction_phrase (en)");
  });

  test("one question comes before the typing challenge", { timeout: 30_000 }, async () => {
    await page.getByTestId("blocked-need").click();
    await page.getByTestId("friction-step-1").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("blocked-main")), false, "the friction flow replaces the main view");
    const question = normalizeCopy(await page.getByTestId("friction-step-1").innerText());
    assert.ok(question.includes("Is it really worth breaking your focus?"), `step 1 asks the SPEC 12.7 question: ${question}`);
    assert.ok(await isShown(page.getByTestId("friction-back-1")), "the question offers to go back to work");

    await page.getByTestId("friction-next-1").click();
    await page.getByTestId("friction-step-2").waitFor({ state: "visible" });
    assert.equal(await isShown(page.getByTestId("friction-step-1")), false, "one step at a time");
    assert.equal(await isShown(page.getByTestId("friction-step-3")), false, "only two steps (SPEC 12.7)");
    assert.ok(await isShown(input()), "the second step is the typing step");

    const shown = normalizeCopy(await page.getByTestId("friction-phrase").textContent());
    assert.equal(shown, normalizeCopy(phrase));
    const userSelect = await page.getByTestId("friction-phrase").evaluate((el) => getComputedStyle(el).userSelect);
    assert.equal(userSelect, "none", "the phrase can't be selected");

    const attrs = await input().evaluate((el) => ({
      autocomplete: el.getAttribute("autocomplete"),
      spellcheck: el.getAttribute("spellcheck"),
    }));
    assert.deepEqual(attrs, { autocomplete: "off", spellcheck: "false" });
    assert.equal(await isDisabled(page.getByTestId("friction-unlock")), true, "unlock is disabled until the phrase is typed");
  });

  test("pasting or dropping text is refused", { timeout: 30_000 }, async () => {
    await input().click();

    // Real clipboard paste through the keyboard shortcut. Headless Chromium has its own
    // clipboard; a headed run would overwrite the system clipboard, so skip it there.
    const clipboardReady =
      !HEADED &&
      (await page.evaluate((text) => navigator.clipboard.writeText(text).then(() => true), phrase).catch(() => false));
    if (clipboardReady) {
      await page.keyboard.press("ControlOrMeta+V");
      assert.equal(await inputValue(), "", "a clipboard paste must not insert text");
    }

    // Synthetic paste and drop events must be cancelled by the page.
    const cancelled = await input().evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      const drop = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true });
      return { paste: !el.dispatchEvent(paste), drop: !el.dispatchEvent(drop) };
    }, phrase);
    assert.deepEqual(cancelled, { paste: true, drop: true }, "paste and drop events are prevented");

    const error = page.getByTestId("friction-error");
    await error.waitFor({ state: "visible" });
    pasteNotice = (await error.innerText()).trim();
    assert.ok(pasteNotice.length > 0, "a paste attempt explains that pasting is disabled");

    // Inserting many characters at once (autotype tools, IME abuse) is refused too.
    await page.keyboard.insertText(phrase);
    assert.equal(await inputValue(), "", "multi-character insertText must be refused");
    assert.equal(await isDisabled(page.getByTestId("friction-unlock")), true);
  });

  test("a typo is rejected and typing resumes from the last valid character", { timeout: 30_000 }, async () => {
    const prefix = phrase.slice(0, typedPrefixLength);
    await input().click();
    await page.keyboard.type(prefix);
    assert.equal(await inputValue(), prefix);

    const wrong = phrase[typedPrefixLength] === "#" ? "%" : "#";
    await page.keyboard.type(wrong);
    await waitFor(async () => (await inputValue()) === prefix, {
      timeout: 3_000,
      message: "the typo to be removed",
    });
    const error = page.getByTestId("friction-error");
    await error.waitFor({ state: "visible" });
    const typoMessage = (await error.innerText()).trim();
    assert.ok(typoMessage.length > 0);
    assert.notEqual(typoMessage, pasteNotice, "the typo message differs from the paste notice");
  });

  test("typing the whole sentence ends the whole session, then Continue lands on the original URL", { timeout: 60_000 }, async () => {
    await input().click();
    await page.keyboard.press("End");
    await page.keyboard.type(phrase.slice(typedPrefixLength));
    assert.equal(await inputValue(), phrase);

    const unlock = page.getByTestId("friction-unlock");
    await waitFor(async () => !(await isDisabled(unlock)), { message: "the unlock button to be enabled" });
    await unlock.click();
    await page.getByTestId("friction-ended").waitFor({ state: "visible" });
    const state = await ctx.getState();
    assert.equal(state.block.active, false, "the session is over (SPEC 13: the ritual ends the whole session)");
    assert.equal(state.session, null);
    assert.ok(state.suspend && state.suspend.until > Date.now(), "a suspend covers the rest of the ended block");
    assert.deepEqual(await ctx.enforcedDomains(), [], "nothing is blocked anymore");
    await page.getByTestId("blocked-continue").click();
    await ctx.expectSiteLoaded(page, originalUrl);
  });

  test("ending the session unblocks every site, and a new session blocks again", { timeout: 30_000 }, async () => {
    const other = await ctx.newPage();
    await ctx.gotoSite(other, ctx.site("facebook.com", "/"));
    await ctx.startSessionDirect(30);
    assert.equal((await ctx.getState()).block.active, true, "a manual session started after an early end blocks again");
    await ctx.gotoBlocked(other, ctx.site("facebook.com", "/"));
    await other.close();
  });

  test("never mind closes the typing step without unlocking", { timeout: 30_000 }, async () => {
    const other = await ctx.newPage();
    const url = ctx.site("facebook.com", "/marketplace/");
    await ctx.gotoBlocked(other, url);
    await other.getByTestId("blocked-need").click();
    await other.getByTestId("friction-next-1").click();
    await other.getByTestId("friction-step-2").waitFor({ state: "visible" });
    await other.getByTestId("friction-cancel").click();
    // Back to the main view, or away from the blocked page: either way no pass is granted.
    await waitFor(
      async () => other.isClosed() || !other.url().startsWith(ctx.blockedPageUrl) || (await isShown(other.getByTestId("blocked-main"))),
      { message: "friction-cancel to leave the typing step" },
    );
    if (!other.isClosed()) assert.equal(await isShown(other.getByTestId("friction-step-2")), false);
    assert.equal((await ctx.getState()).block.active, true, "never mind keeps the session running");
    if (!other.isClosed()) await other.close();
  });

  test("the friction flow can be abandoned at the question", { timeout: 30_000 }, async () => {
    const other = await ctx.newPage();
    await ctx.gotoBlocked(other, ctx.site("facebook.com", "/groups/"));
    const resistedBefore = (await ctx.getLocal("stats")).stats?.resisted ?? 0;
    await other.getByTestId("blocked-need").click();
    await other.getByTestId("friction-step-1").waitFor({ state: "visible" });
    await other.getByTestId("friction-back-1").click();
    // "No, back to work" behaves like Back to work: the tab leaves the blocked page.
    await waitFor(() => other.isClosed() || !other.url().startsWith(ctx.blockedPageUrl), {
      message: "the tab to leave the blocked page after choosing to go back to work",
    });
    await waitForValue(() => ctx.getLocal("stats"), ({ stats }) => stats?.resisted === resistedBefore + 1, {
      message: "going back to work to count as resisted",
    });
    if (!other.isClosed()) await other.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
