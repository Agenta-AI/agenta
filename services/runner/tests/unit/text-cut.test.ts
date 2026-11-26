import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { headCut, tailCut } from "../../src/text-cut.ts";
import { isWellFormed } from "../utils/well-formed.ts";

// "𝗰" is one character and two UTF-16 code units (a surrogate pair).
const BOLD_C = "𝗰";

describe("headCut", () => {
  it("drops a pair the cut would split instead of leaving its high half", () => {
    const text = `${"a".repeat(3)}${BOLD_C}bc`;
    const cut = headCut(text, 4);
    assert.equal(cut, "aaa");
    assert.ok(isWellFormed(cut));
  });

  it("keeps a pair that ends exactly at the cut", () => {
    assert.equal(headCut(`aa${BOLD_C}bc`, 4), `aa${BOLD_C}`);
  });

  it("returns short text unchanged", () => {
    assert.equal(headCut(`a${BOLD_C}`, 10), `a${BOLD_C}`);
  });
});

describe("tailCut", () => {
  it("drops a pair the cut would split instead of leaving its low half", () => {
    const text = `ab${BOLD_C}${"z".repeat(3)}`;
    const cut = tailCut(text, 4);
    assert.equal(cut, "zzz");
    assert.ok(isWellFormed(cut));
  });

  it("keeps a pair that starts exactly at the cut", () => {
    assert.equal(tailCut(`ab${BOLD_C}zz`, 4), `${BOLD_C}zz`);
  });

  it("returns short text unchanged", () => {
    assert.equal(tailCut(`${BOLD_C}a`, 10), `${BOLD_C}a`);
  });
});
