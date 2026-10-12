import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { icon, ICON_NAMES } from "../../extension/shared/icons.js";
import { GROUP_ICONS } from "../../extension/shared/constants.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const REQUIRED = [...new Set([
  "users", "play", "mail", "news", "cart", "lock", "unlock", "clock", "target", "coffee", "settings", "plus", "x",
  "check", "chevron-down", "chevron-up", "trash", "globe", "alert", "shield", "sparkles", "arrow-right", "calendar",
  "phone", "eye-off",
  // Every icon a group can pick (SPEC 12.2).
  ...GROUP_ICONS,
])];

class FakeElement {
  constructor(namespace, tag) {
    this.namespace = namespace;
    this.tag = tag;
    this.attributes = {};
    this.children = [];
  }
  setAttribute(name, value) {
    assert.equal(typeof value, "string", `attribute ${name} must be a string`);
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

describe("icon", () => {
  beforeEach(() => {
    globalThis.document = {
      createElementNS: (namespace, tag) => new FakeElement(namespace, tag),
      createElement: () => {
        throw new Error("icons must use createElementNS");
      },
    };
  });

  afterEach(() => {
    delete globalThis.document;
  });

  test("every required icon exists", () => {
    for (const name of REQUIRED) assert.ok(ICON_NAMES.includes(name), name);
  });

  test("every group icon draws something (icons.js draws all of GROUP_ICONS)", () => {
    for (const name of GROUP_ICONS) assert.ok(icon(name).children.length > 0, name);
  });

  for (const name of REQUIRED) {
    test(`${name} is a stroke SVG built with createElementNS`, () => {
      const svg = icon(name);
      assert.equal(svg.namespace, SVG_NS);
      assert.equal(svg.tag, "svg");
      assert.equal(svg.attributes.viewBox, "0 0 24 24");
      assert.equal(svg.attributes.fill, "none");
      assert.equal(svg.attributes.stroke, "currentColor");
      assert.equal(svg.attributes["stroke-width"], "2");
      assert.equal(svg.attributes["aria-hidden"], "true");
      assert.equal(svg.attributes.class, "icon");
      assert.ok(svg.children.length > 0);
      for (const child of svg.children) {
        assert.equal(child.namespace, SVG_NS);
        assert.ok(["path", "circle", "rect"].includes(child.tag), child.tag);
        if (child.tag === "path") assert.match(child.attributes.d, /^M[\d\s.,MmLlHhVvCcSsAaZz-]+$/);
      }
    });
  }

  test("custom class name", () => {
    assert.equal(icon("lock", "icon icon-lg").attributes.class, "icon icon-lg");
  });

  test("unknown names give an empty SVG instead of throwing", () => {
    const svg = icon("does-not-exist");
    assert.equal(svg.tag, "svg");
    assert.equal(svg.children.length, 0);
  });

  test("each call returns a new element", () => {
    assert.notEqual(icon("x"), icon("x"));
  });
});
