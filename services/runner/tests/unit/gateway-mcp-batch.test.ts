/**
 * A JSON-RPC batch may not carry a `gateway.run` call.
 *
 * The loopback MCP server answers a batch by running every item CONCURRENTLY and then, if any of
 * them paused, aborting the whole request with no body. That is safe for tools that cannot
 * pause. It is not safe for `gateway.run`: when its compiled permission is `ask` it parks at the
 * relay seam, and by then its siblings in the batch have already executed. Their results are
 * discarded with the aborted response, so the model never learns they happened — and the obvious
 * recovery, once the human answers, is to send the whole batch again. Every write in it runs
 * twice.
 *
 * Rejecting the batch is what makes that impossible, and it is what the server already does for
 * client tools, for the same reason. Serializing instead would still leave the items ahead of
 * the gateway call executed and thrown away. `gateway.search` is deliberately still batchable:
 * it cannot pause, and re-running a read costs nothing.
 *
 * Driven through the real HTTP server on loopback, because the preflight is a property of the
 * request handler, not of any function underneath it.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-mcp-batch.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import { startInternalToolMcpServer } from "../../src/tools/tool-mcp-http.ts";
import type { InternalToolMcpServer } from "../../src/tools/tool-mcp-http.ts";
import { localRelayHost, startToolRelay } from "../../src/tools/relay.ts";
import {
  GATEWAY_POLICY,
  RUN_TOOL_SPEC,
  SEARCH_TOOL_SPEC,
  TOOL_CALLBACK,
  buildTestGatewayGate,
  cleanupRelayDirs,
  makeRelayDir,
  stubToolCall,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;
let server: InternalToolMcpServer | undefined;
let stopRelay: (() => Promise<void>) | undefined;

afterEach(async () => {
  globalThis.fetch = realFetch;
  await server?.close();
  server = undefined;
  await stopRelay?.();
  stopRelay = undefined;
  cleanupRelayDirs();
});

const ORDINARY_TOOL = {
  name: "server_tool",
  kind: "callback" as const,
  callRef: "tool.plain",
  permission: "allow" as const,
};

const SPECS = [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC, ORDINARY_TOOL];

/**
 * The server AND a real relay loop on the same directory, so an accepted call is actually
 * answered rather than left waiting on a response file nobody writes. The rejection cases never
 * reach the relay — that is what they assert — but they share the setup so both halves are
 * measured against the same running system.
 */
async function startServer(): Promise<InternalToolMcpServer> {
  const dir = makeRelayDir();
  const harness = buildTestGatewayGate();
  const relay = startToolRelay(
    localRelayHost(),
    dir,
    SPECS,
    TOOL_CALLBACK,
    undefined,
    undefined,
    undefined,
    {
      gatewayPolicy: GATEWAY_POLICY,
      gatewayGate: harness.gate,
      writePausedAnswer: true,
    },
  );
  await relay.ready;
  stopRelay = relay.stop;
  server = await startInternalToolMcpServer(SPECS, dir);
  return server;
}

/** POST a raw JSON-RPC body (single message or batch) to the running server. */
async function post(
  mcp: InternalToolMcpServer,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const response = await realFetch(mcp.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${mcp.authorizationToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : undefined,
  };
}

function call(
  id: number,
  name: string,
  args: unknown,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  };
}

const RUN_ARGS = {
  integration: "github",
  tool: "CREATE_ISSUE",
  arguments: { title: "bug" },
};

describe("a batch containing run_tool is refused before anything executes", () => {
  it("rejects it, and no sibling reaches the provider", async () => {
    const mcp = await startServer();
    // Any callback the siblings would have made shows up here. It must stay empty.
    const calls = stubToolCall({ ok: true });

    const { status, json } = await post(mcp, [
      call(1, ORDINARY_TOOL.name, { a: 1 }),
      call(2, RUN_TOOL_SPEC.name, RUN_ARGS),
      call(3, ORDINARY_TOOL.name, { a: 2 }),
    ]);

    assert.equal(status, 400);
    assert.equal(json.error.code, -32600);
    assert.match(json.error.message, /not supported in a batch/);
    assert.match(json.error.message, /send it on its own/);
    assert.equal(
      calls.bodies.length,
      0,
      "the preflight must run before any sibling executes",
    );
  });

  it("rejects it wherever the gateway call sits in the batch", async () => {
    const mcp = await startServer();
    const calls = stubToolCall({ ok: true });

    for (const batch of [
      [call(1, RUN_TOOL_SPEC.name, RUN_ARGS), call(2, ORDINARY_TOOL.name, {})],
      [call(1, ORDINARY_TOOL.name, {}), call(2, RUN_TOOL_SPEC.name, RUN_ARGS)],
      [call(1, RUN_TOOL_SPEC.name, RUN_ARGS)],
    ]) {
      const { status } = await post(mcp, batch);
      assert.equal(status, 400);
    }
    assert.equal(calls.bodies.length, 0);
  });

  it("names the offending tool so the client can retry it alone", async () => {
    const mcp = await startServer();
    stubToolCall({ ok: true });

    const { json } = await post(mcp, [
      call(1, RUN_TOOL_SPEC.name, RUN_ARGS),
      call(2, ORDINARY_TOOL.name, {}),
    ]);

    assert.match(json.error.message, /run_tool/);
  });
});

describe("what stays batchable", () => {
  it("a batch of search_tools calls is still accepted and runs", async () => {
    const mcp = await startServer();
    const calls = stubToolCall({ results: [] });

    const { status, json } = await post(mcp, [
      call(1, SEARCH_TOOL_SPEC.name, { query: "an issue" }),
      call(2, SEARCH_TOOL_SPEC.name, { query: "a pull request" }),
    ]);

    // `gateway.search` cannot pause, so the batch is answered rather than refused, and both
    // searches really do reach the provider.
    assert.equal(status, 200);
    assert.equal(json.length, 2);
    assert.equal(calls.bodies.length, 2);
  });

  it("a single run_tool call is untouched by the preflight", async () => {
    const mcp = await startServer();
    const calls = stubToolCall({ issue: { number: 12 } });

    // Not a batch: no array, so the preflight never applies. An ALLOWED tool, so it executes
    // rather than parking — the point is that a lone gateway call still works.
    const { status, json } = await post(
      mcp,
      call(1, RUN_TOOL_SPEC.name, {
        integration: "github",
        tool: "GET_ISSUE",
        arguments: { issue: 12 },
      }),
    );

    assert.equal(status, 200);
    assert.equal(json.id, 1);
    assert.equal(json.result.isError, undefined);
    assert.equal(calls.bodies.length, 1);
  });

  it("a batch with no gateway or client call is unaffected", async () => {
    const mcp = await startServer();
    stubToolCall({ ok: true });

    const { status, json } = await post(mcp, [
      call(1, ORDINARY_TOOL.name, { a: 1 }),
      call(2, ORDINARY_TOOL.name, { a: 2 }),
    ]);

    assert.equal(status, 200);
    assert.equal(json.length, 2);
  });
});
