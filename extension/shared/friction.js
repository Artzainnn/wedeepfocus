// Typing challenge comparison helpers. Pure module: no chrome, no document.

const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u02BC`\u00B4]/g;
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const SPECIAL_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const COMBINING_MARKS = /\p{M}/gu;
// Typographic dashes and minus signs, built from code points so this file never contains them.
const DASHES = new RegExp(
  `[${[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xfe58, 0xfe63, 0xff0d]
    .map((code) => String.fromCodePoint(code))
    .join("")}]`,
  "g",
);

// Accents are optional (combining marks are dropped after NFD) and typographic dashes match "-",
// so a pasted custom sentence can be typed on any keyboard. Leading whitespace is dropped;
// trailing whitespace is kept so "abc " stays a valid prefix of "abc def".
export function normalizeForCompare(s) {
  return String(s ?? "")
    .normalize("NFD")
    .toLowerCase()
    .replace(COMBINING_MARKS, "")
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\u2026/g, "...")
    .replace(SPECIAL_SPACES, " ")
    .replace(/\s+/g, " ")
    .replace(/^ /, "");
}

function target(phrase) {
  return normalizeForCompare(phrase).trimEnd();
}

export function isComplete(typed, phrase) {
  const expected = target(phrase);
  return expected.length > 0 && normalizeForCompare(typed).trimEnd() === expected;
}

// Whitespace typed after a finished phrase is not a typo.
export function isValidPrefix(typed, phrase) {
  return target(phrase).startsWith(normalizeForCompare(typed)) || isComplete(typed, phrase);
}

// Number of normalized characters typed correctly from the start (for "42 / 150" counters).
export function matchedLength(typed, phrase) {
  const expected = target(phrase);
  const actual = normalizeForCompare(typed);
  const max = Math.min(expected.length, actual.length);
  let index = 0;
  while (index < max && expected[index] === actual[index]) index++;
  return index;
}

export function phraseLength(phrase) {
  return target(phrase).length;
}

export function progress(typed, phrase) {
  const total = phraseLength(phrase);
  if (total === 0) return 0;
  return Math.min(1, matchedLength(typed, phrase) / total);
}
