/**
 * Unit tests for the shared tool-dispatch module (tools/dispatch.ts) and its routing.
 *
 * The kind-dispatch ("branch on spec.kind to execute a resolved tool") used to be duplicated
 * across engines/pi.ts, extensions/agenta.ts, and tools/mcp-server.ts. It now lives once in
 * `runResolvedTool`. These tests cover both the routing into that function and the call-site
 * advertising behavior that stays per-site:
 *  - buildCustomTools (pi.ts) skips `client` specs, builds a tool per `code`/`callback` spec,
 *    and skips a `callback` spec with no callback endpoint.
 *  - runResolvedTool runs a real `code` snippet end-to-end (python) and throws for `client`.
 *
 * No network and no harness: the `code` path shells out to python3 (available locally); the
 * `callback`/relay paths are not exercised here (they need a live /tools/call or a relay dir).
 *
 * Run: pnpm exec tsx test/tool-dispatch.test.ts
 */
import assert from "node:assert/strict";

import { buildCustomTools } from "../src/engines/pi.ts";
import { runResolvedTool } from "../src/tools/dispatch.ts";
import type { ResolvedToolSpec, ToolCallbackContext } from "../src/protocol.ts";

const callback: ToolCallbackContext = { endpoint: "https://agenta.test/tools/call" };

const clientSpec: ResolvedToolSpec = { name: "client_tool", kind: "client" };
const codeSpec: ResolvedToolSpec = {
  name: "code_tool",
  kind: "code",
  runtime: "python",
  code: 'def main(**kw):\n    return {"echo": kw}\n',
};
const callbackSpec: ResolvedToolSpec = {
  name: "callback_tool",
  kind: "callback",
  callRef: "composio.SOME_ACTION",
};

// --- buildCustomTools routing -----------------------------------------------
{
  const tools = buildCustomTools([clientSpec, codeSpec, callbackSpec], callback);
  const names = tools.map((t) => t.name);

  // `client` is browser-fulfilled, so it is never registered in-process.
  assert.ok(!names.includes("client_tool"), "client spec is skipped");
  // `code` and `callback` each produce exactly one tool with the spec's name.
  assert.ok(names.includes("code_tool"), "code spec produces a tool");
  assert.ok(names.includes("callback_tool"), "callback spec produces a tool");
  assert.equal(tools.length, 2, "only the two executable specs produce tools");
}

// A `callback` spec with no callback endpoint is skipped (logged), but a sibling `code`
// spec still registers (code never needs the endpoint).
{
  const tools = buildCustomTools([codeSpec, callbackSpec], undefined);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("code_tool"), "code spec still registers without an endpoint");
  assert.ok(
    !names.includes("callback_tool"),
    "callback spec is skipped when no callback endpoint",
  );
  assert.equal(tools.length, 1, "only the code spec registers without an endpoint");
}

// --- runResolvedTool: code executes; client throws --------------------------
{
  const text = await runResolvedTool(codeSpec, { greeting: "hi", n: 3 }, {
    toolCallId: "call-1",
  });
  const parsed = JSON.parse(text);
  assert.deepEqual(
    parsed,
    { echo: { greeting: "hi", n: 3 } },
    "code tool runs the snippet and returns its JSON output containing the input",
  );
}

{
  await assert.rejects(
    () => runResolvedTool(clientSpec, {}, { toolCallId: "call-2" }),
    /browser-fulfilled/,
    "client tool throws (never executed in-sandbox)",
  );
}

console.log("tool-dispatch.test.ts: all assertions passed");
