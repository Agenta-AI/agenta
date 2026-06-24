/**
 * Unit tests for buildToolMcpServers (the tool MCP bridge attachment decision).
 *
 * Regression cover for F4: attachment must be decided per tool kind, not on the callback
 * endpoint alone. A `code` tool is still advertised through mcp-server.ts and needs no endpoint,
 * so a run whose tools are all `code` must still attach the `agenta-tools` server. Only `callback`-kind
 * tools require AGENTA_TOOL_CALLBACK_ENDPOINT; missing it must degrade those tools, not drop the
 * whole server. `client` tools are browser-fulfilled and never justify attaching the bridge.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-bridge.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { buildToolMcpServers } from "../../src/tools/mcp-bridge.ts";
import type { ResolvedToolSpec, ToolCallbackContext } from "../../src/protocol.ts";

/** Look up an env var value by name in the ACP {name,value} list (undefined if absent). */
function envValue(
  env: { name: string; value: string }[],
  name: string,
): string | undefined {
  return env.find((e) => e.name === name)?.value;
}

const relayDir = "/tmp/agenta-tools";

describe("buildToolMcpServers", () => {
  it("attaches the server for a code-only run, with public specs and relay dir", () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "adder",
        description: "Add numbers",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
        env: { PRIVATE: "secret" },
      },
    ];
    const out = buildToolMcpServers(specs, relayDir);
    assert.equal(out.length, 1, "code-only run still attaches the server");
    assert.equal(out[0].name, "agenta-tools");
    assert.ok(
      envValue(out[0].env, "AGENTA_TOOL_PUBLIC_SPECS") !== undefined,
      "AGENTA_TOOL_PUBLIC_SPECS is set",
    );
    assert.equal(
      envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
      undefined,
      "no endpoint env for code-only run",
    );
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_RELAY_DIR"), relayDir);
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_CALLBACK_AUTH"), undefined);
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_SPECS"), undefined);
    // Only public metadata round-trips; private executor fields stay runner-side.
    assert.deepEqual(JSON.parse(envValue(out[0].env, "AGENTA_TOOL_PUBLIC_SPECS")!), [
      { name: "adder", description: "Add numbers" },
    ]);
  });

  it("never exposes endpoint/auth env to the bridge child (callback + full callback)", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    const callback: ToolCallbackContext = {
      endpoint: "https://agenta.example/tools/call",
      authorization: "Bearer tok",
    };
    const out = buildToolMcpServers(specs, callback, relayDir);
    assert.equal(out.length, 1);
    assert.equal(
      envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
      undefined,
      "endpoint env is never exposed to the bridge",
    );
    assert.equal(
      envValue(out[0].env, "AGENTA_TOOL_CALLBACK_AUTH"),
      undefined,
      "auth env is never exposed to the bridge",
    );
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_RELAY_DIR"), relayDir);
  });

  it("omits AUTH env when authorization is absent (endpoint but no auth)", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    const out = buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" }, relayDir);
    assert.equal(out.length, 1);
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"), undefined);
    assert.equal(
      envValue(out[0].env, "AGENTA_TOOL_CALLBACK_AUTH"),
      undefined,
      "no AUTH env when authorization absent",
    );
  });

  it("treats an absent kind as callback (back-compat)", () => {
    const specs: ResolvedToolSpec[] = [{ name: "legacy", callRef: "composio.legacy" }];
    const out = buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" }, relayDir);
    assert.equal(out.length, 1, "back-compat (no kind) attaches as a callback tool");
    assert.equal(envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"), undefined);
  });

  it("attaches one server for a mixed code+callback run with no endpoint", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "adder", kind: "code", runtime: "python", code: "def main(**k): return 1" },
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    const out = buildToolMcpServers(specs, relayDir);
    assert.notDeepEqual(out, [], "mixed run with no endpoint must not return []");
    assert.equal(out.length, 1, "still attaches the server so the code tool is advertised");
    assert.equal(
      envValue(out[0].env, "AGENTA_TOOL_CALLBACK_ENDPOINT"),
      undefined,
      "endpoint env omitted when missing",
    );
    // Both executable specs are advertised, but only as public metadata.
    assert.deepEqual(JSON.parse(envValue(out[0].env, "AGENTA_TOOL_PUBLIC_SPECS")!), [
      { name: "adder" },
      { name: "search" },
    ]);
  });

  it("returns [] for empty specs", () => {
    assert.deepEqual(buildToolMcpServers([], undefined), [], "empty specs -> []");
  });

  it("returns [] for client-only specs (nothing executable, even with an endpoint)", () => {
    const specs: ResolvedToolSpec[] = [{ name: "confirm", kind: "client" }];
    assert.deepEqual(
      buildToolMcpServers(specs, undefined),
      [],
      "client-only -> [] (nothing executable here)",
    );
    assert.deepEqual(
      buildToolMcpServers(specs, { endpoint: "https://agenta.example/tools/call" }, relayDir),
      [],
      "client-only -> [] even with an endpoint",
    );
  });

  it("drops client tools from the advertised list but still attaches for an executable sibling", () => {
    const specs: ResolvedToolSpec[] = [
      { name: "confirm", kind: "client" },
      { name: "adder", kind: "code", runtime: "python", code: "def main(**k): return 1" },
    ];
    const out = buildToolMcpServers(specs, relayDir);
    assert.equal(out.length, 1, "executable spec attaches the server");
    const passed: ResolvedToolSpec[] = JSON.parse(envValue(out[0].env, "AGENTA_TOOL_PUBLIC_SPECS")!);
    assert.deepEqual(
      passed.map((s) => s.name),
      ["adder"],
      "client spec excluded from the executable list passed to the bridge",
    );
  });
});
