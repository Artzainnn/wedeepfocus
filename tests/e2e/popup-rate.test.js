// The popup's rating card (shared/rating.js): shown once a first block has run to its end, hidden
// during a block, closing it waits two weeks (twice at most), the link opens the store's review page.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { SUITE_TIMEOUT, findRawI18nKeys, isShown, launch, localDayKey, requireExtensionFiles, sleep } from "./helpers.js";
import { REVIEW_URL } from "../../extension/shared/config.js";

const PREFS = "wedeepfocus.rate";

describe("popup rating card", { timeout: SUITE_TIMEOUT }, () => {
  let ctx;

  before(async () => {
    requireExtensionFiles("popup/popup.html", "popup/popup.js", "shared/rating.js");
    ctx = await launch();
  });

  after(async () => {
    await ctx?.close();
  });

  const openPopup = async () => {
    const popup = await ctx.openExtensionPage("popup/popup.html");
    await popup.getByTestId("popup-status").waitFor({ state: "visible" });
    await sleep(400); // the card waits for storage after the first render
    return popup;
  };
  const cardShown = (popup) => isShown(popup.getByTestId("popup-rate"));
  const setPrefs = (value) => ctx.inExtensionPage(([key, v]) => (v === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v))), [PREFS, value]);
  const getPrefs = () => ctx.inExtensionPage((key) => JSON.parse(localStorage.getItem(key)), PREFS);
  const completeOneBlock = () => ctx.setLocal({ history: { days: { [localDayKey()]: { completed: 1, focusMs: 15 * 60_000 } } } });

  test("not asked before any block has run to its end", { timeout: 30_000 }, async () => {
    const popup = await openPopup();
    assert.equal(await cardShown(popup), false);
    await popup.close();
  });

  test("asked after a first completed block, in plain words", { timeout: 30_000 }, async () => {
    await completeOneBlock();
    const popup = await openPopup();
    assert.equal(await cardShown(popup), true);
    assert.match(await popup.getByTestId("popup-rate").innerText(), /Enjoy the app\? Rate it on Chrome Store/);
    assert.deepEqual(await findRawI18nKeys(popup), []);
    await popup.close();
  });

  test("never during a block", { timeout: 30_000 }, async () => {
    await ctx.startSessionDirect(30);
    const popup = await openPopup();
    assert.equal(await cardShown(popup), false);
    await popup.close();
    await ctx.endSessionDirect();
  });

  test('"Not now" waits, and the second one is the last', { timeout: 30_000 }, async () => {
    let popup = await openPopup();
    await popup.getByTestId("popup-rate-later").click();
    assert.equal(await cardShown(popup), false);
    await popup.close();
    const first = await getPrefs();
    assert.equal(first.later, 1);
    assert.ok(first.until > Date.now() + 13 * 86_400_000, "about two weeks");

    popup = await openPopup();
    assert.equal(await cardShown(popup), false, "still waiting");
    await popup.close();

    await setPrefs({ ...first, until: Date.now() - 1000 });
    popup = await openPopup();
    assert.equal(await cardShown(popup), true, "asked again once the wait is over");
    await popup.getByTestId("popup-rate-later").click();
    await popup.close();

    await setPrefs({ ...(await getPrefs()), until: Date.now() - 1000 });
    popup = await openPopup();
    assert.equal(await cardShown(popup), false, "never after the second Not now");
    await popup.close();
  });

  test('"Rate it" opens the store review page and the question stops', { timeout: 30_000 }, async () => {
    await setPrefs(null);
    let popup = await openPopup();
    const [store] = await Promise.all([ctx.context.waitForEvent("page"), popup.getByTestId("popup-rate-open").click()]);
    assert.equal(store.url(), REVIEW_URL);
    await store.close();
    assert.deepEqual(await getPrefs(), { rated: true });
    popup = await openPopup();
    assert.equal(await cardShown(popup), false);
    await popup.close();
  });

  test("no errors in extension pages", () => {
    ctx.assertNoExtensionErrors();
  });
});
