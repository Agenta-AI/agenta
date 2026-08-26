import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  parsePiGatewayMcpConfig,
  piMcpToolName,
  registerPiGatewayMcpTools,
  serializePiGatewayMcpConfig,
} from "../../src/extensions/pi-mcp.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Pi gateway MCP extension", () => {
  it("discovers and calls a gateway-backed HTTP MCP tool without naming an upstream", async () => {
    const requests: Array<{ method?: string; headers: Headers }> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      requests.push({ method: payload.method, headers });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: payload.params.arguments.marker }] }
            : { protocolVersion: "2026-07-28" };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: payload.method === "notifications/initialized" ? 202 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const raw = serializePiGatewayMcpConfig([
      {
        name: "mock",
        url: "https://api.example.test/gateways/mcps/custom/mock",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
    ]);
    const registered: any[] = [];
    await registerPiGatewayMcpTools({ registerTool: (tool) => registered.push(tool) }, raw, () => {});
    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, "mcp__mock__echo");
    const value = await registered[0].execute("call-1", { marker: "WP34-ECHO" });
    assert.match(value.content[0].text, /WP34-ECHO/);
    assert.ok(requests.some((request) => request.method === "initialize"));
    assert.ok(requests.some((request) => request.method === "tools/list"));
    assert.ok(requests.some((request) => request.method === "tools/call"));
    assert.ok(requests.every((request) => request.headers.get("x-ag-credentials") === "short-lived-gateway-token"));
  });

  it("rejects malformed config and makes server/tool names collision-resistant", () => {
    assert.throws(() => parsePiGatewayMcpConfig('{"version":2}'), /invalid Pi gateway MCP configuration/);
    assert.equal(piMcpToolName("my-server", "echo.tool"), "mcp__my_server__echo_tool");
  });

  it("does not replace an existing Pi or Agenta tool", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { protocolVersion: "2026-07-28" };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), { status: 200 });
    }) as typeof fetch;
    const raw = serializePiGatewayMcpConfig([
      {
        name: "mock",
        url: "https://api.example.test/gateways/mcps/custom/mock",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
    ]);
    await assert.rejects(
      () =>
        registerPiGatewayMcpTools(
          {
            registerTool: () => assert.fail("must not replace an existing tool"),
            getAllTools: () => [{ name: "mcp__mock__echo" }, { name: "read" }],
          },
          raw,
          () => {},
        ),
      /MCP tool name collision/,
    );
  });
});
