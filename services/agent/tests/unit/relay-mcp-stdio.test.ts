/**
 * Unit tests for the in-sandbox stdio MCP relay shim (F-042): the Daytona tool advertiser for a
 * non-Pi harness (Claude). The shim speaks newline-delimited MCP JSON-RPC over stdio and, on
 * `tools/call`, writes a relay request file the runner-side relay loop executes.
 *
 * These drive the pure handler `handleRelayMcpMessage` directly (no real harness, no real stdio):
 *  - `initialize` answers with serverInfo + tools capability.
 *  - `tools/list` advertises ONLY public metadata (name/description/inputSchema) — never a
 *    callRef/code/auth (the shim only ever receives public specs, so this is structural).
 *  - `tools/call` writes a `<id>.req.json` and resolves from a `<id>.res.json`; ok -> text
 *    content, not-ok -> isError; unknown tool -> JSON-RPC error.
 *
 * Run: pnpm exec vitest run tests/unit/relay-mcp-stdio.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleRelayMcpMessage } from "../../src/tools/relay-mcp-stdio.ts";
import type { PublicToolSpec } from "../../src/tools/public-spec.ts";
import {
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
  sanitizeRelayId,
} from "../../src/tools/relay.ts";

const specs: PublicToolSpec[] = [
  {
    name: "get_weather",
    description: "Get the weather",
    inputSchema: { type: "object", properties: { city: { type: "string" } } },
  },
];

const dirs: string[] = [];
function relayDir(): string {
  const d = mkdtempSync(join(tmpdir(), "agenta-relay-mcp-stdio-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe("relay-mcp-stdio handler", () => {
  it("initialize -> serverInfo + tools capability", async () => {
    const res: any = await handleRelayMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      specs,
      relayDir(),
    );
    assert.equal(res.id, 1);
    assert.equal(res.result.serverInfo.name, "agenta-tools");
    assert.ok(res.result.capabilities.tools);
  });

  it("a notification (no id) returns undefined (no response written)", async () => {
    const res = await handleRelayMcpMessage(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      specs,
      relayDir(),
    );
    assert.equal(res, undefined);
  });

  it("tools/list advertises only public metadata", async () => {
    const res: any = await handleRelayMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      specs,
      relayDir(),
    );
    assert.deepEqual(
      res.result.tools.map((t: any) => t.name),
      ["get_weather"],
    );
    const serialized = JSON.stringify(res);
    // Structural: the shim never has a callRef/code/auth to leak; assert the advertisement shape.
    assert.ok(!serialized.includes("callRef"));
    assert.ok(!serialized.includes("authorization"));
    assert.ok(res.result.tools[0].inputSchema.properties.city);
  });

  it("tools/call writes a relay req and resolves from the runner's res (ok -> text)", async () => {
    const dir = relayDir();
    const callId = "get_weather-9-123";
    // Simulate the runner's relay loop: watch for the req, write a res.
    const pending = handleRelayMcpMessage(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "get_weather", arguments: { city: "Berlin" } },
      },
      specs,
      dir,
    );

    // Poll for the request file the shim writes, then answer it.
    await waitFor(() =>
      readdirSync(dir).some((f) => f.endsWith(RELAY_REQ_SUFFIX)),
    );
    const reqName = readdirSync(dir).find((f) => f.endsWith(RELAY_REQ_SUFFIX))!;
    const req = JSON.parse(readFileSync(join(dir, reqName), "utf-8"));
    assert.equal(req.toolName, "get_weather");
    assert.deepEqual(req.args, { city: "Berlin" });
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    writeFileSync(
      join(dir, `${id}${RELAY_RES_SUFFIX}`),
      JSON.stringify({ ok: true, text: "RELAY-OK city=Berlin" }),
      "utf-8",
    );

    const res: any = await pending;
    assert.equal(res.id, 9);
    assert.equal(res.result.content[0].text, "RELAY-OK city=Berlin");
    assert.ok(!res.result.isError);
    // Use callId only to keep the lint happy about the documented stable-id intent.
    assert.ok(sanitizeRelayId(callId).length > 0);
  });

  it("tools/call maps a not-ok relay result to an MCP isError result", async () => {
    const dir = relayDir();
    const pending = handleRelayMcpMessage(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "get_weather", arguments: {} },
      },
      specs,
      dir,
    );
    await waitFor(() =>
      readdirSync(dir).some((f) => f.endsWith(RELAY_REQ_SUFFIX)),
    );
    const reqName = readdirSync(dir).find((f) => f.endsWith(RELAY_REQ_SUFFIX))!;
    const id = reqName.slice(0, -RELAY_REQ_SUFFIX.length);
    writeFileSync(
      join(dir, `${id}${RELAY_RES_SUFFIX}`),
      JSON.stringify({ ok: false, error: "upstream 500" }),
      "utf-8",
    );
    const res: any = await pending;
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /upstream 500/);
  });

  it("tools/call for an unknown tool -> JSON-RPC error (never writes a req)", async () => {
    const dir = relayDir();
    const res: any = await handleRelayMcpMessage(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "nope", arguments: {} },
      },
      specs,
      dir,
    );
    assert.equal(res.error.code, -32602);
    assert.equal(
      readdirSync(dir).length,
      0,
      "no relay req written for an unknown tool",
    );
  });

  it("an unknown method -> method-not-found error", async () => {
    const res: any = await handleRelayMcpMessage(
      { jsonrpc: "2.0", id: 12, method: "tools/frobnicate" },
      specs,
      relayDir(),
    );
    assert.equal(res.error.code, -32601);
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("waitFor timed out");
}
