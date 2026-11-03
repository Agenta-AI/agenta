"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./lib.cjs");

const { lineChanges, outline } = load("page-text");
const { OPS } = load("ops");

test("lineChanges lists added lines under their unchanged parent, and counts lines that left", () => {
  const before = ["- list:", "  - listitem: a", "  - listitem: b"];
  assert.deepEqual(lineChanges(before, ["- list:", "  - listitem: a", "  - listitem: c", "  - listitem: b"]), {
    lines: ["under: - list:", "  - listitem: c"],
    gone: 0,
  });
  assert.deepEqual(lineChanges(before, ["- list:", "  - listitem: a"]), { lines: [], gone: 1 });
});

test("outline splits a long page into parts with refs, and stops at a list", () => {
  const lines = [
    "- main:",
    '  - region "Orders" [ref=e2]:',
    "    - list [ref=e3]:",
    ...Array.from({ length: 12 }, (_, i) => `      - listitem: Order ${String(i).padStart(2, "0")}`),
    '  - region "Help" [ref=e9]:',
    "    - paragraph: Call us",
  ];
  assert.equal(
    outline(lines, 1234, 200),
    "[Outline of a long page (1,234 chars). Read a part with agenta-browser read <ref>, or act on a control by its role and name.]\n" +
      "- list [ref=e3] (345 chars, 12 items)\n" +
      '- region "Help" [ref=e9] (53 chars)',
  );
});

test("read --interactive outlines the filtered text, not the whole page", async () => {
  const buttons = Array.from({ length: 1000 }, (_, i) => `  - button "Item ${String(i).padStart(4, "0")}" [ref=e${String(i).padStart(4, "0")}]`);
  const prose = Array.from({ length: 1000 }, () => "  - paragraph: Lorem ipsum dolor sit amet");
  const raw = ["- main:", ...buttons.flatMap((b, i) => [b, prose[i]])].join("\n");
  const page = { ariaSnapshot: async () => raw, title: async () => "Shop", url: () => "https://shop.test/" };
  const text = await OPS.read_page(page, { filter: "interactive" });
  // 1000 button lines of 34 chars and 999 newlines: 34,999 chars. The whole page is about 80,000.
  assert.match(text, /^Page: Shop \(https:\/\/shop\.test\/\)\n\[Outline of a long page \(34,999 chars\)/);
  assert.doesNotMatch(text, /paragraph/);
});
