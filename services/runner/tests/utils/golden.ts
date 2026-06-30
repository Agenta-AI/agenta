/**
 * Load the shared cross-language wire fixtures.
 *
 * These JSON files are the single anchor for the `/run` contract. The Python producer asserts
 * them in `sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py`; the TS consumer
 * asserts the same files here. Read in place via `node:fs` (no copy, no bundler import) so the
 * two sides can never drift against different copies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// services/agent/tests/utils -> repo root -> the shared Python golden fixtures.
export const GOLDEN_DIR = join(
  here,
  "../../../../sdks/python/oss/tests/pytest/unit/agents/golden",
);

export function loadGolden(name: string): unknown {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, name), "utf-8"));
}
