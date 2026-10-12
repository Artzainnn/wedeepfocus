#!/usr/bin/env node
// Packages extension/ into dist/wedeepfocus-v<version>.zip for the Chrome Web Store.
// Runs build-locales (strict) first, checks the package, then zips with the `zip` CLI.
//
// Usage: node scripts/zip.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = path.join(ROOT, "extension");
const DIST_DIR = path.join(ROOT, "dist");
const TEXT_EXT = /\.(js|mjs|html|css|json|md|txt|svg)$/;
const DASHES = [0x2013, 0x2014].map((c) => String.fromCodePoint(c));

function fail(message) {
  console.error(`zip: ${message}`);
  process.exit(1);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function checkPackage(manifest) {
  const problems = [];
  const warnings = [];
  const rel = (f) => path.relative(EXT_DIR, f);

  // Site access is requested per site at runtime (optional_host_permissions). The e2e tests and
  // the screenshot script add host_permissions to a temp copy only; it must never ship.
  if (manifest.host_permissions?.length) {
    problems.push(`manifest.json has host_permissions (${manifest.host_permissions.join(", ")}): remove them, site access is requested at runtime through optional_host_permissions`);
  }

  const referenced = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.web_accessible_resources ?? []).flatMap((r) => r.resources ?? []),
  ].filter(Boolean));
  for (const file of referenced) {
    if (!existsSync(path.join(EXT_DIR, file))) problems.push(`manifest references missing file ${file}`);
  }

  for (const lang of ["en", "fr"]) {
    if (!existsSync(path.join(EXT_DIR, "_locales", lang, "messages.json"))) problems.push(`missing _locales/${lang}/messages.json`);
  }

  for (const file of listFiles(EXT_DIR)) {
    if (!TEXT_EXT.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (DASHES.some((d) => text.includes(d))) problems.push(`${rel(file)} contains an em dash or en dash`);
    if (/buy\.stripe\.com\/PLACEHOLDER/.test(text)) warnings.push(`${rel(file)} still uses the placeholder coffee link`);
    if (/<script[^>]+src=["']https?:|\bfrom\s+["']https?:|\bimport\(\s*["']https?:/i.test(text)) problems.push(`${rel(file)} loads remote code`);
  }
  return { problems, warnings };
}

function main() {
  try {
    execFileSync("zip", ["-v"], { stdio: "ignore" });
  } catch {
    fail("the `zip` command line tool is required (macOS and most Linux distributions ship it)");
  }

  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-locales.mjs"), "--strict"], { stdio: "inherit" });
  } catch {
    fail("build-locales failed, fix the errors above");
  }

  const manifest = JSON.parse(readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) fail(`invalid manifest version "${manifest.version}"`);

  const { problems, warnings } = checkPackage(manifest);
  for (const w of warnings) console.warn(`zip: warning: ${w}`);
  if (problems.length) fail(`package check failed:\n  ${problems.join("\n  ")}`);

  mkdirSync(DIST_DIR, { recursive: true });
  const out = path.join(DIST_DIR, `wedeepfocus-v${manifest.version}.zip`);
  rmSync(out, { force: true });

  // -X drops extra file attributes, -x excludes dotfiles and dot directories at any depth.
  execFileSync("zip", ["-r", "-X", "-q", out, ".", "-x", ".*", "*/.*", "__MACOSX/*"], { cwd: EXT_DIR, stdio: "inherit" });

  const listing = execFileSync("zip", ["-sf", out], { encoding: "utf8" });
  const count = listing.split("\n").filter((l) => /^\s{2}\S/.test(l)).length;
  const kb = (statSync(out).size / 1024).toFixed(1);
  console.log(`zip: ${path.relative(ROOT, out)} (${count} files, ${kb} KB)`);
}

main();
