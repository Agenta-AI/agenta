/**
 * Cross-language agreement check for CU12: loads the same boundary-address fixture the
 * Python suite asserts (`sdks/python/oss/tests/pytest/unit/golden/ssrf_guard_vectors.json`,
 * labeled from Python's `ipaddress` module — the ground truth) and asserts this guard's
 * verdict against it. A range edited on only one side of the guard flips a vector's label
 * and turns this test red.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/ssrf-guard-vectors.test.ts)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { isBlockedIpLiteral } from "../../src/tools/ssrf-guard.ts";

const here = dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = join(
  here,
  "../../../../sdks/python/oss/tests/pytest/unit/golden/ssrf_guard_vectors.json",
);

interface Vector {
  host: string;
  blocked: boolean;
}

const vectors: Vector[] = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));

describe("isBlockedIpLiteral agrees with the Python-generated vector fixture", () => {
  it(`has a non-trivial vector set (${vectors.length} entries)`, () => {
    assert.ok(vectors.length > 40);
  });

  for (const { host, blocked } of vectors) {
    it(`${host} -> blocked=${blocked}`, () => {
      assert.equal(isBlockedIpLiteral(host), blocked, host);
    });
  }
});
