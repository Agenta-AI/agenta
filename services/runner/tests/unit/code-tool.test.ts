/**
 * Unit test for the code-tool sidecar execution gate.
 *
 * Code tools remain part of the public tool interface and can still be advertised to harnesses,
 * but the sidecar must not execute author-supplied snippets locally.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { CODE_TOOL_UNSUPPORTED_MESSAGE, runCodeTool } from "../../src/tools/code.ts";

describe("runCodeTool", () => {
  it("fails with a clear unsupported error instead of executing code", async () => {
    await assert.rejects(
      () =>
        runCodeTool(
          "node",
          "function main() { return { executed: true }; }",
          { MY_TOOL_SECRET: "secret" },
          { input: true },
        ),
      new RegExp(CODE_TOOL_UNSUPPORTED_MESSAGE),
    );
  });
});
