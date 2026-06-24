/**
 * Unit tests for the shared tool-dispatch module (tools/dispatch.ts) and its routing.
 *
 * The kind-dispatch ("branch on spec.kind to execute a resolved tool") used to be duplicated
 * across engines/pi.ts, extensions/agenta.ts, and tools/mcp-server.ts. It now lives once in
 * `runResolvedTool`. These tests cover both the routing into that function and the call-site
 * advertising behavior that stays per-site:
 *  - buildCustomTools (pi.ts) skips `client` specs, builds a tool per `code`/`callback` spec,
 *    and skips a `callback` spec with no callback endpoint.
 *  - runResolvedTool advertises code tools but fails their sidecar execution, and throws for `client`.
 *
 * No network and no harness: the `code` path now fails before any subprocess; the
 * `callback`/relay paths are not exercised here (they need a live /tools/call or a relay dir).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-dispatch.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCustomTools } from "../../src/engines/pi.ts";
import { relayToolCall, runResolvedTool } from "../../src/tools/dispatch.ts";
import { RELAY_RES_SUFFIX, sanitizeRelayId } from "../../src/tools/relay.ts";
import type { ResolvedToolSpec, ToolCallbackContext } from "../../src/protocol.ts";

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

describe("buildCustomTools routing", () => {
  it("skips client specs and builds one tool per code/callback spec", () => {
    const tools = buildCustomTools([clientSpec, codeSpec, callbackSpec], callback);
    const names = tools.map((t) => t.name);

    // `client` is browser-fulfilled, so it is never registered in-process.
    assert.ok(!names.includes("client_tool"), "client spec is skipped");
    // `code` and `callback` each produce exactly one tool with the spec's name.
    assert.ok(names.includes("code_tool"), "code spec produces a tool");
    assert.ok(names.includes("callback_tool"), "callback spec produces a tool");
    assert.equal(tools.length, 2, "only the two executable specs produce tools");
  });

  it("skips a callback spec with no endpoint but keeps a sibling code spec", () => {
    const tools = buildCustomTools([codeSpec, callbackSpec], undefined);
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("code_tool"), "code spec still registers without an endpoint");
    assert.ok(
      !names.includes("callback_tool"),
      "callback spec is skipped when no callback endpoint",
    );
    assert.equal(tools.length, 1, "only the code spec registers without an endpoint");
  });
});

describe("runResolvedTool", () => {
  it("fails code specs with a clear unsupported error", async () => {
    await assert.rejects(
      () =>
        runResolvedTool(codeSpec, { greeting: "hi", n: 3 }, {
          toolCallId: "call-1",
        }),
      /Code tools are not supported by the sidecar\./,
      "code tools remain advertised but are not executable by the sidecar",
    );
  });

  it("throws for a client spec (never executed in-sandbox)", async () => {
    await assert.rejects(
      () => runResolvedTool(clientSpec, {}, { toolCallId: "call-2" }),
      /browser-fulfilled/,
      "client tool throws (never executed in-sandbox)",
    );
  });
});

// Directly exercises the Daytona file-relay path (the code site of the fixed `callRef` bug):
// pre-write the response file the runner watches for, then call relayToolCall and read it back.
describe("relayToolCall (Daytona file relay)", () => {
  it("returns the relayed text when the response is ok", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-test-"));
    try {
      const toolCallId = "call-ok";
      const resPath = join(dir, sanitizeRelayId(toolCallId) + RELAY_RES_SUFFIX);
      writeFileSync(resPath, JSON.stringify({ ok: true, text: "relayed-ok" }));
      const out = await relayToolCall(dir, "myTool", toolCallId, { a: 1 });
      assert.equal(out, "relayed-ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the tool name on an empty relay error (regression for the callRef bug)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-test-"));
    try {
      const toolCallId = "call-err";
      const resPath = join(dir, sanitizeRelayId(toolCallId) + RELAY_RES_SUFFIX);
      // ok:false with an empty error string forces the fallback message, which referenced the
      // undefined `callRef` before the fix and would have thrown a ReferenceError instead.
      writeFileSync(resPath, JSON.stringify({ ok: false, error: "" }));
      await assert.rejects(
        () => relayToolCall(dir, "myTool", toolCallId, {}),
        /tool relay failed for myTool/,
        "the error message uses toolName, not an undefined callRef",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
