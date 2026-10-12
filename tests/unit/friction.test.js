import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isComplete,
  isValidPrefix,
  matchedLength,
  normalizeForCompare,
  phraseLength,
  progress,
} from "../../extension/shared/friction.js";

const EN =
  "I am choosing to give up on my goals for now. I am trading the person I want to become for a few minutes of distraction, and I accept that.";
const FR =
  "Je choisis de renoncer à mes objectifs pour l'instant. J'échange la personne que je veux devenir contre quelques minutes de distraction, et je l'accepte.";
const FR_CURLY = FR.replace(/'/g, "’");
// What a French speaker types on a keyboard without accents.
const FR_PLAIN =
  "Je choisis de renoncer a mes objectifs pour l'instant. J'echange la personne que je veux devenir contre quelques minutes de distraction, et je l'accepte.";
// Accented letters written decomposed (base letter + combining mark), as some keyboards produce them.
const FR_DECOMPOSED = FR.normalize("NFD");

describe("normalizeForCompare", () => {
  test("lowercases and collapses whitespace runs", () => {
    assert.equal(normalizeForCompare("Hello   World"), "hello world");
    assert.equal(normalizeForCompare("a\t\n b"), "a b");
  });

  test("keeps one trailing space, drops leading whitespace", () => {
    assert.equal(normalizeForCompare("abc "), "abc ");
    assert.equal(normalizeForCompare("abc   "), "abc ");
    assert.equal(normalizeForCompare("  abc"), "abc");
  });

  test("maps non breaking and narrow spaces to a plain space", () => {
    assert.equal(normalizeForCompare("a b c d"), "a b c d");
  });

  test("maps curly quotes and apostrophes to straight ones", () => {
    assert.equal(normalizeForCompare("l’instant “ok” «oui»"), "l'instant \"ok\" \"oui\"");
  });

  test("strips diacritics, whatever the Unicode form", () => {
    assert.equal(normalizeForCompare("été"), "ete");
    assert.equal(normalizeForCompare("été"), "ete");
    assert.equal(normalizeForCompare("À demain"), "a demain");
    assert.equal(normalizeForCompare("À l'instant, ÇA ÉCHANGE"), "a l'instant, ca echange");
    assert.equal(normalizeForCompare("Noël, maïs, où, côte"), "noel, mais, ou, cote");
    assert.equal(normalizeForCompare("mañana, über, İstanbul"), "manana, uber, istanbul");
  });

  test("typographic dashes and minus signs match a plain hyphen, one for one", () => {
    const dashes = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d];
    for (const code of dashes) {
      const phrase = `plus tard ${String.fromCodePoint(code)} vraiment`;
      assert.equal(normalizeForCompare(phrase), "plus tard - vraiment");
      assert.equal(normalizeForCompare(phrase).length, phrase.length);
      assert.ok(isComplete("plus tard - vraiment", phrase));
      assert.ok(isValidPrefix("plus tard -", phrase));
    }
  });

  test("only combining marks go: letters without a decomposition stay", () => {
    assert.equal(normalizeForCompare("Œuvre, Æther, Ørsted, Łódź"), "œuvre, æther, ørsted, łodz");
  });

  test("removes zero width characters", () => {
    assert.equal(normalizeForCompare("ab​c"), "abc");
    assert.equal(normalizeForCompare("﻿a⁠b"), "ab");
  });

  test("handles null and numbers", () => {
    assert.equal(normalizeForCompare(null), "");
    assert.equal(normalizeForCompare(undefined), "");
    assert.equal(normalizeForCompare(42), "42");
  });
});

describe("isValidPrefix", () => {
  test("empty and partial input are valid", () => {
    assert.equal(isValidPrefix("", EN), true);
    assert.equal(isValidPrefix("I am", EN), true);
    assert.equal(isValidPrefix("i AM choosing", EN), true);
  });

  test("a trailing space right before the next word is valid", () => {
    assert.equal(isValidPrefix("I am ", EN), true);
    assert.equal(isValidPrefix("I am  ", EN), true);
    assert.equal(isValidPrefix("I am ", EN), true);
  });

  test("a typo is rejected", () => {
    assert.equal(isValidPrefix("I an", EN), false);
    assert.equal(isValidPrefix("I am choosing  to", EN), true);
    assert.equal(isValidPrefix("Iam", EN), false);
  });

  test("accents are optional, typed or not, in any Unicode form", () => {
    assert.equal(isValidPrefix("Je choisis de renoncer à", FR), true);
    assert.equal(isValidPrefix("Je choisis de renoncer a", FR), true);
    assert.equal(isValidPrefix("Je choisis de renoncer à", FR), true);
    assert.equal(isValidPrefix("a l'instant", "à l'instant"), true);
    assert.equal(isValidPrefix("A L'INSTANT", "à l'instant"), true);
    assert.equal(isValidPrefix("ECHANGE", "échange"), true);
    assert.equal(isValidPrefix("J'ECHANGE", "J'échange"), true);
    assert.equal(isValidPrefix("J'ÉCHANGE", "J'échange"), true);
    assert.equal(isValidPrefix("Je choisis de renoncer à", FR_DECOMPOSED), true);
  });

  test("an accent typed where the sentence has none is tolerated too", () => {
    assert.equal(isValidPrefix("Jé choisis", FR), true);
    assert.equal(isValidPrefix("I àm", EN), true);
  });

  test("ignoring accents does not hide real typos", () => {
    assert.equal(isValidPrefix("Je choisis de renoncer o", FR), false);
    assert.equal(isValidPrefix("J'achange", "J'échange"), false);
    assert.equal(isValidPrefix("J'échangé", "J'échange"), true);
    assert.equal(isValidPrefix("J'échangex", "J'échange"), false);
  });

  test("curly and straight apostrophes are interchangeable both ways", () => {
    assert.equal(isValidPrefix("Je choisis de renoncer à mes objectifs pour l’instant", FR), true);
    assert.equal(isValidPrefix("Je choisis de renoncer à mes objectifs pour l'instant", FR_CURLY), true);
  });

  test("whitespace after the complete phrase is not a typo, extra characters are", () => {
    assert.equal(isValidPrefix(`${EN} `, EN), true);
    assert.equal(isValidPrefix(`${EN}\n`, EN), true);
    assert.equal(isValidPrefix(`${EN}x`, EN), false);
  });

  test("every prefix of the sentence, typed with or without accents, stays valid", () => {
    for (const typed of [FR, FR_PLAIN, FR_DECOMPOSED]) {
      for (let length = 0; length <= typed.length; length++) {
        assert.equal(isValidPrefix(typed.slice(0, length), FR), true, typed.slice(0, length));
      }
    }
  });
});

describe("isComplete", () => {
  test("exact, case insensitive and trailing whitespace tolerant", () => {
    assert.equal(isComplete(EN, EN), true);
    assert.equal(isComplete(EN.toUpperCase(), EN), true);
    assert.equal(isComplete(`${EN}   `, EN), true);
    assert.equal(isComplete(FR_CURLY, FR), true);
  });

  test("the French sentence typed without accents is complete", () => {
    assert.equal(isComplete(FR_PLAIN, FR), true);
    assert.equal(isComplete(FR_PLAIN.toUpperCase(), FR), true);
    assert.equal(isComplete(FR_DECOMPOSED, FR), true);
    assert.equal(isComplete(FR, FR_PLAIN), true);
  });

  test("incomplete or different text is not complete", () => {
    assert.equal(isComplete(EN.slice(0, -1), EN), false);
    assert.equal(isComplete("", EN), false);
    assert.equal(isComplete(`${EN} more`, EN), false);
    assert.equal(isComplete(FR_PLAIN.slice(0, -1), FR), false);
  });

  test("an empty phrase can never be completed", () => {
    assert.equal(isComplete("", ""), false);
    assert.equal(isComplete("   ", "  "), false);
    assert.equal(isComplete("", "́​"), false);
  });
});

describe("progress", () => {
  test("goes from 0 to 1", () => {
    assert.equal(progress("", EN), 0);
    assert.equal(progress(EN, EN), 1);
    assert.equal(progress(`${EN}  `, EN), 1);
    const half = EN.slice(0, Math.floor(EN.length / 2));
    assert.equal(progress(half, EN), half.length / EN.length);
  });

  test("counts letters typed without their accent", () => {
    assert.equal(progress(FR_PLAIN, FR), 1);
    assert.equal(matchedLength("Je choisis de renoncer a", FR), "Je choisis de renoncer a".length);
  });

  test("stops counting at the first mismatch", () => {
    assert.equal(matchedLength("I am chXosing", EN), "I am ch".length);
    assert.equal(progress("X", EN), 0);
  });

  test("empty phrase gives 0", () => {
    assert.equal(progress("abc", ""), 0);
  });

  test("phraseLength counts normalized characters", () => {
    assert.equal(phraseLength(EN), EN.length);
    assert.equal(phraseLength(FR), FR.length);
    assert.equal(phraseLength(FR_DECOMPOSED), FR.length);
    assert.equal(phraseLength("  a   b  "), 3);
    assert.equal(phraseLength("é"), 1);
  });
});
