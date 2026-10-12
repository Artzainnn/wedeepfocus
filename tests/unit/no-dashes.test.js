// SPEC rule 1: no em dash (U+2014) or en dash (U+2013) in the extension, its strings or these tests.
// The characters are built from code points so this file never contains them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const DASHES = [0x2014, 0x2013].map((code) => String.fromCodePoint(code));
const FOLDERS = ["extension", "i18n", "tests/unit"];

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// "file:line" for every line holding a dash. Binary files (icons) contain NUL bytes and are skipped.
function dashLines(file) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) return [];
  const where = path.relative(root, file);
  return bytes
    .toString("utf8")
    .split("\n")
    .flatMap((line, index) => (DASHES.some((dash) => line.includes(dash)) ? [`${where}:${index + 1}`] : []));
}

describe("no em dash or en dash", () => {
  test("the guard finds both characters and skips binary files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "focus-dashes-"));
    try {
      writeFileSync(path.join(dir, "copy.txt"), `fine\nem ${DASHES[0]} dash\nen ${DASHES[1]} dash\n`);
      writeFileSync(path.join(dir, "icon.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x00]), Buffer.from(DASHES[0])]));
      const found = listFiles(dir).flatMap(dashLines).map((hit) => path.basename(hit));
      assert.deepEqual(found, ["copy.txt:2", "copy.txt:3"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const folder of FOLDERS) {
    test(`${folder}/`, () => {
      const files = listFiles(path.join(root, folder));
      assert.ok(files.length > 0, `${folder}/ has no files`);
      assert.deepEqual(files.flatMap(dashLines), []);
    });
  }
});
