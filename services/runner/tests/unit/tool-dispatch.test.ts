/**
 * Unit tests for the shared tool-dispatch module (tools/dispatch.ts) and its routing.
 *
 * The kind-dispatch ("branch on spec.kind to execute a resolved tool") lives once in
 * `runResolvedTool`, used by the Pi extension (extensions/agenta.ts) and the MCP server
 * (tools/mcp-server.ts). These tests cover the routing into that function and the file relay:
 *  - runResolvedTool advertises code tools but fails their sidecar execution, and relays `client`.
 *  - relayToolCall reads back the relayed result from the Daytona file relay.
 *
 * No network and no harness: the `code` path now fails before any subprocess; the
 * `callback`/relay paths are exercised through the relay dir.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-dispatch.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { relayToolCall, runResolvedTool } from "../../src/tools/dispatch.ts";
import { RELAY_RES_SUFFIX, sanitizeRelayId } from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const clientSpec: ResolvedToolSpec = { name: "client_tool", kind: "client" };
const requiredClientSpec = {
  name: "request_connection",
  kind: "client",
  input_schema: {
    type: "object",
    properties: { integration: { type: "string" } },
    required: ["integration"],
  },
} as ResolvedToolSpec;
const codeSpec: ResolvedToolSpec = {
  name: "code_tool",
  kind: "code",
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
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

  it("relays a client spec when the Pi extension has a runner relay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-test-"));
    try {
      const toolCallId = "call-client";
      const resPath = join(dir, sanitizeRelayId(toolCallId) + RELAY_RES_SUFFIX);
      writeFileSync(resPath, JSON.stringify({ ok: true, text: '{"connected":true}' }));
      const out = await runResolvedTool(clientSpec, { integration: "slack" }, {
        toolCallId,
        relayDir: dir,
      });
      assert.equal(out, '{"connected":true}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing required args before any relay or callback execution", async () => {
    await assert.rejects(
      () =>
        runResolvedTool(requiredClientSpec, {}, {
          toolCallId: "call-required",
          relayDir: "/tmp/agenta-relay-must-not-be-used",
        }),
      /missing required argument\(s\): integration/,
    );
  });


  it("keeps callback specs on the file relay when relayDir is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-test-"));
    const toolCallId = "call-callback";
    const reqPath = join(dir, sanitizeRelayId(toolCallId) + ".req.json");
    const resPath = join(dir, sanitizeRelayId(toolCallId) + RELAY_RES_SUFFIX);
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("direct /tools/call branch should be unreachable with relayDir");
    }) as typeof fetch;
    try {
      const promise = runResolvedTool(
        {
          name: "test_run",
          kind: "callback",
          callRef: "tools.agenta.test_run",
          contextBindings: {
            "target.workflow_variant_id": "$ctx.workflow.variant.id",
          },
          timeoutMs: 120000,
        },
        { target: { workflow_variant_id: "model-variant" } },
        { toolCallId, relayDir: dir, endpoint: "https://api.example/tools/call" },
      );

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && !existsSync(reqPath)) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(existsSync(reqPath), "relay request was written");
      assert.deepEqual(JSON.parse(readFileSync(reqPath, "utf-8")), {
        toolName: "test_run",
        toolCallId,
        args: { target: { workflow_variant_id: "model-variant" } },
      });
      writeFileSync(resPath, JSON.stringify({ ok: true, text: "relayed" }));

      assert.equal(await promise, "relayed");
      assert.equal(fetchCalls, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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


  it("extends the child relay deadline with timeoutMs", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "agenta-relay-test-"));
    try {
      const toolCallId = "call-slow";
      const resPath = join(dir, sanitizeRelayId(toolCallId) + RELAY_RES_SUFFIX);
      const promise = relayToolCall(dir, "slowTool", toolCallId, {}, 120000);
      setTimeout(() => {
        writeFileSync(resPath, JSON.stringify({ ok: true, text: "slow-ok" }));
      }, 65_000);

      await vi.advanceTimersByTimeAsync(65_500);
      assert.equal(await promise, "slow-ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
