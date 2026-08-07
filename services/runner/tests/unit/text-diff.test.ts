/**
 * The unified diff on the approval card (slice S3b).
 *
 * Contract: `workspace-import.md` section 8.4.
 *
 * The diff is the substance of a single-text approval: the human approves "this exact old text
 * becomes this exact new text". The display cap is a DISPLAY cap only — the changed-line counts
 * stay exact above it, because a truncated card that also truncated its counts would imply a
 * partial approval.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/text-diff.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { unifiedDiff } from "../../src/tools/text-diff.ts";

describe("the unified diff", () => {
  it("shows a one-line change with its context", () => {
    const diff = unifiedDiff("a\nb\nc\n", "a\nB\nc\n");
    assert.equal(diff.addedLines, 1);
    assert.equal(diff.removedLines, 1);
    assert.match(diff.text, /^@@ /m);
    assert.match(diff.text, /^-b$/m);
    assert.match(diff.text, /^\+B$/m);
    assert.match(diff.text, /^ a$/m);
  });

  it("reports no change as no change", () => {
    const diff = unifiedDiff("same\n", "same\n");
    assert.equal(diff.addedLines, 0);
    assert.equal(diff.removedLines, 0);
    assert.equal(diff.text, "");
  });

  it("handles an empty old side (every line is an addition)", () => {
    const diff = unifiedDiff("", "one\ntwo\n");
    assert.equal(diff.addedLines, 2);
    assert.equal(diff.removedLines, 0);
  });

  it("keeps the counts exact when the rendered diff is truncated", () => {
    const oldText = Array.from({ length: 500 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const newText = Array.from({ length: 500 }, (_, i) => `LINE ${i}`).join(
      "\n",
    );
    const diff = unifiedDiff(oldText, newText, { maxLines: 400 });

    assert.equal(diff.truncated, true);
    assert.ok(diff.text.split("\n").length <= 400, "the display is capped");
    assert.equal(diff.addedLines, 500, "the counts cover the WHOLE diff");
    assert.equal(diff.removedLines, 500);
  });

  it("only diffs the changed region of a large document", () => {
    // A common prefix and suffix are trimmed before any alignment, which is what keeps an
    // ordinary edit inside a long instructions file cheap.
    const head = Array.from({ length: 5000 }, (_, i) => `k ${i}`).join("\n");
    const diff = unifiedDiff(`${head}\nold tail\n`, `${head}\nnew tail\n`);
    assert.equal(diff.addedLines, 1);
    assert.equal(diff.removedLines, 1);
    assert.equal(diff.coarse, false);
    assert.ok(
      diff.text.split("\n").length < 20,
      "only the changed region renders",
    );
  });

  it("degrades to a whole-block replacement rather than aligning an enormous change", () => {
    const oldText = Array.from({ length: 2500 }, (_, i) => `a ${i}`).join("\n");
    const newText = Array.from({ length: 2500 }, (_, i) => `b ${i}`).join("\n");
    const diff = unifiedDiff(oldText, newText);
    assert.equal(diff.coarse, true);
    assert.equal(diff.addedLines, 2500);
    assert.equal(diff.removedLines, 2500);
  });
});
