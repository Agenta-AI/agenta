/**
 * Unit test for the code-tool executor (runCodeTool).
 *
 * Exercises both runtimes end-to-end through real subprocesses: a python tool, node tools
 * written as a bare top-level `function main` (the F2 regression) and as an explicit
 * `module.exports.main`, an async node `main`, the F3 env-isolation guarantee (provider keys
 * do NOT leak in; declared scoped secrets DO), and the non-zero-exit reject path.
 *
 * Run: pnpm exec tsx test/code-tool.test.ts
 */
import assert from "node:assert/strict";

import { runCodeTool } from "../src/tools/code.ts";

// --- Python: bare `def main(**kw)` ------------------------------------------
{
  const code = 'def main(**kw):\n    return {"sum": kw.get("a", 0) + kw.get("b", 0)}\n';
  const out = await runCodeTool("python", code, undefined, { a: 2, b: 3 });
  assert.deepEqual(JSON.parse(out), { sum: 5 }, "python bare main returns the right JSON");
}

// --- Node: bare top-level `function main` (F2 regression) -------------------
{
  const code = "function main(inputs) { return { got: inputs }; }";
  const out = await runCodeTool("node", code, undefined, { hello: "world" });
  assert.deepEqual(
    JSON.parse(out),
    { got: { hello: "world" } },
    "node bare function main executes and echoes the input",
  );
}

// --- Node: explicit `module.exports.main` -----------------------------------
{
  const code = "module.exports.main = function (inputs) { return { via: 'exports', got: inputs }; };";
  const out = await runCodeTool("node", code, undefined, { x: 1 });
  assert.deepEqual(
    JSON.parse(out),
    { via: "exports", got: { x: 1 } },
    "node module.exports.main works",
  );
}

// --- Node: async `main` returning a Promise ---------------------------------
{
  const code =
    "async function main(inputs) { await new Promise((r) => setTimeout(r, 5)); return { doubled: inputs.n * 2 }; }";
  const out = await runCodeTool("node", code, undefined, { n: 21 });
  assert.deepEqual(JSON.parse(out), { doubled: 42 }, "node async main resolves");
}

// --- F3: provider keys do NOT leak; scoped secrets DO -----------------------
{
  const hadKey = "OPENAI_API_KEY" in process.env;
  const prevKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "leak-me-xyz";
  try {
    // The provider key sits in process.env but must not reach the snippet.
    const leakCode = "function main() { return { key: process.env.OPENAI_API_KEY ?? 'absent' }; }";
    const leakOut = await runCodeTool("node", leakCode, undefined, {});
    assert.deepEqual(
      JSON.parse(leakOut),
      { key: "absent" },
      "F3: OPENAI_API_KEY did NOT leak into the snippet env",
    );

    // A secret declared on the tool (passed via the scoped `env` arg) must be visible.
    const scopedCode =
      "function main() { return { secret: process.env.MY_TOOL_SECRET ?? 'absent' }; }";
    const scopedOut = await runCodeTool("node", scopedCode, { MY_TOOL_SECRET: "ok" }, {});
    assert.deepEqual(
      JSON.parse(scopedOut),
      { secret: "ok" },
      "F3: scoped MY_TOOL_SECRET IS visible to the snippet",
    );
  } finally {
    if (hadKey) process.env.OPENAI_API_KEY = prevKey;
    else delete process.env.OPENAI_API_KEY;
  }
}

// --- Non-zero exit / throw rejects ------------------------------------------
{
  const code = "function main() { throw new Error('boom'); }";
  await assert.rejects(
    () => runCodeTool("node", code, undefined, {}),
    /boom|exited/,
    "a throwing snippet rejects",
  );
}

console.log("code-tool.test.ts: all assertions passed");
