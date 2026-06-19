/**
 * Unit tests for buildToolMcpServers (the tool MCP bridge attachment decision).
 *
 * Regression cover for F4: attachment must be decided per tool kind, not on the callback
 * endpoint alone. A `code` tool runs locally in mcp-server.ts and needs no endpoint, so a run
 * whose tools are all `code` must still attach the `agenta-tools` server. Only `callback`-kind
 * tools require AGENTA_TOOL_CALLBACK_ENDPOINT; missing it must degrade those tools, not drop the
 * whole server. `client` tools are browser-fulfilled and never justify attaching the bridge.
 *
 * Run: pnpm exec tsx test/tool-bridge.test.ts
 */
import assert from "node:assert/strict";

import { buildToolMcpServers } from "../src/tools/mcp-bridge.ts";
import type { ResolvedToolSpec, ToolCallbackContext } from "../src/protocol.ts";

/** Look up an env var value by name in the ACP {name,value} list (undefined if absent). */
function envValue(
  env: { name: string; value: string }[],
  name: string,
): string | undefined {
  return env.find((e) => e.name === name)?.value;
}

// code-only specs + NO callback -> one server, with AGENTA_TOOL_SPECS but no endpoint (F4).
{
  const specs: ResolvedToolSpec[] = [
    { name: "adder", kind: "code", runtime: "python", code: "def main(**k): return 1" },
  ];
  const out = buildToolMcpServers(specs, undefined);
  assert.equal(out.length, 1, "code-only run still attaches the server");
  assert.equal(out[0].name, "agenta-tools");
  assert.ok(
    envValue(out[0].env, "AGENTA_TOOL_SPECS") !== undefined,
    "AGENTA_TOOL_SPECS is set",
  );
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
    undefined,
    "no endpoint env for code-only run",
  );
  // The full executable spec list round-trips through AGENTA_TOOL_SPECS.
  assert.deepEqual(JSON.parse(envValue(out[0].env, "AGENTA_TOOL_SPECS")!), specs);
}

// callback specs + a callback with endpoint -> one server carrying endpoint (+ auth).
{
  const specs: ResolvedToolSpec[] = [
    { name: "search", kind: "callback", callRef: "composio.search" },
  ];
  const callback: ToolCallbackContext = {
    endpoint: "https://agenta.example/tools/call",
    authorization: "Bearer tok",
  };
  const out = buildToolMcpServers(specs, callback);
  assert.equal(out.length, 1);
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
    "https://agenta.example/tools/call",
    "endpoint env set for callback tools",
  );
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_AUTH"),
    "Bearer tok",
    "auth env set when provided",
  );
}

// callback spec + endpoint but no authorization -> no AUTH env entry.
{
  const specs: ResolvedToolSpec[] = [
    { name: "search", kind: "callback", callRef: "composio.search" },
  ];
  const out = buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" });
  assert.equal(out.length, 1);
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
    "https://agenta.example/tools/call",
  );
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_AUTH"),
    undefined,
    "no AUTH env when authorization absent",
  );
}

// absent kind defaults to callback (back-compat): endpoint still wired when present.
{
  const specs: ResolvedToolSpec[] = [{ name: "legacy", callRef: "composio.legacy" }];
  const out = buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" });
  assert.equal(out.length, 1, "back-compat (no kind) attaches as a callback tool");
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
    "https://agenta.example/tools/call",
  );
}

// mixed code+callback specs + NO endpoint -> still one server (so code works), endpoint omitted.
{
  const specs: ResolvedToolSpec[] = [
    { name: "adder", kind: "code", runtime: "python", code: "def main(**k): return 1" },
    { name: "search", kind: "callback", callRef: "composio.search" },
  ];
  const out = buildToolMcpServers(specs, undefined);
  assert.notDeepEqual(out, [], "mixed run with no endpoint must not return []");
  assert.equal(out.length, 1, "still attaches the server so the code tool works");
  assert.equal(
    envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
    undefined,
    "endpoint env omitted when missing",
  );
  // Both executable specs are still passed to the bridge.
  assert.deepEqual(JSON.parse(envValue(out[0].env, "AGENTA_TOOL_SPECS")!), specs);
}

// empty specs -> [].
assert.deepEqual(buildToolMcpServers([], undefined), [], "empty specs -> []");

// client-only specs -> [] (no executable tools; the bridge does not advertise client tools).
{
  const specs: ResolvedToolSpec[] = [{ name: "confirm", kind: "client" }];
  assert.deepEqual(
    buildToolMcpServers(specs, undefined),
    [],
    "client-only -> [] (nothing executable here)",
  );
  // Even with an endpoint, client-only stays empty.
  assert.deepEqual(
    buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" }),
    [],
    "client-only -> [] even with an endpoint",
  );
}

// client tools alongside an executable one are dropped from AGENTA_TOOL_SPECS, server attaches.
{
  const specs: ResolvedToolSpec[] = [
    { name: "confirm", kind: "client" },
    { name: "adder", kind: "code", runtime: "python", code: "def main(**k): return 1" },
  ];
  const out = buildToolMcpServers(specs, undefined);
  assert.equal(out.length, 1, "executable spec attaches the server");
  const passed: ResolvedToolSpec[] = JSON.parse(envValue(out[0].env, "AGENTA_TOOL_SPECS")!);
  assert.deepEqual(
    passed.map((s) => s.name),
    ["adder"],
    "client spec excluded from the executable list passed to the bridge",
  );
}

console.log("tool-bridge.test.ts: all assertions passed");
