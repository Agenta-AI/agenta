import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  MCP_DISCOVERY_METHOD,
  parsePiGatewayMcpConfig,
  piMcpToolName,
  registerPiGatewayMcpTools,
  serializePiGatewayMcpConfig,
} from "../../src/extensions/pi-mcp.ts";
import { probeMcpServerHandshake } from "../../src/engines/sandbox_agent/mcp-handshake.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * A stand-in for the gateway's builtin adapter
 * (`api/oss/src/core/gateways/mcps/providers/agenta/adapter.py`): it answers the handshake, then
 * `tools/list` and `tools/call`, and refuses every other method the way that adapter does — the
 * gateway turns its `ValueError` into a non-2xx, not a JSON-RPC error. Written as the narrow set
 * it is, so a client that opens with anything else fails here exactly as it failed in production.
 */
function builtinAdapterFetch(
  options: { onRequest?: (method: string) => void } = {},
) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body));
    options.onRequest?.(payload.method);
    if (payload.id === undefined) return new Response("", { status: 202 });
    const result =
      payload.method === "initialize"
        ? {
            protocolVersion: payload.params?.protocolVersion ?? "2026-07-28",
            capabilities: { tools: {} },
            serverInfo: { name: "agenta-builtin-mcp", version: "0.1.0" },
          }
        : payload.method === "tools/list"
          ? {
              tools: [
                {
                  name: "echo",
                  description: "echo",
                  inputSchema: { type: "object" },
                },
              ],
            }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : undefined;
    if (result === undefined) {
      return new Response(
        `Agenta MCP supports only initialize, tools/list and tools/call`,
        { status: 502 },
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;
}

function oneServerConfig(name = "mock"): string {
  return serializePiGatewayMcpConfig([
    {
      name,
      url: `https://api.example.test/gateways/mcps/custom/${name}`,
      headers: { "X-AG-Credentials": "short-lived-gateway-token" },
      policy: { tools: { mode: "all" } },
    },
  ]);
}

/** A Pi instance that keeps its registry across turns, the way a pooled session's does. */
function fakePi() {
  const tools: any[] = [];
  return {
    tools,
    registerTool: (tool: any) => tools.push(tool),
    getAllTools: () => tools.map((tool) => ({ name: tool.name })),
  };
}

/**
 * A gate that approves everything, for the cases that are about discovery, naming and transport
 * rather than about policy. The policy cases below pass their own.
 */
const allowAll = async () => ({ allowed: true, reason: "" });

describe("Pi gateway MCP extension", () => {
  it("discovers and calls a gateway-backed HTTP MCP tool without naming an upstream", async () => {
    const requests: Array<{ method?: string; headers: Headers }> = [];
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const payload = JSON.parse(String(init?.body));
      const headers = new Headers(init?.headers);
      requests.push({ method: payload.method, headers });
      const result =
        payload.method === "tools/list"
          ? {
              tools: [
                {
                  name: "echo",
                  description: "echo",
                  inputSchema: { type: "object" },
                },
              ],
            }
          : payload.method === "tools/call"
            ? {
                content: [
                  { type: "text", text: payload.params.arguments.marker },
                ],
              }
            : {
                resultType: "complete",
                supportedVersions: ["2026-07-28"],
                capabilities: { tools: {} },
              };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
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
    await registerPiGatewayMcpTools(
      { registerTool: (tool) => registered.push(tool) },
      raw,
      () => {},
      allowAll,
    );
    assert.equal(registered.length, 1);
    assert.equal(registered[0].name, "mcp__mock__echo");
    const value = await registered[0].execute("call-1", {
      marker: "WP34-ECHO",
    });
    assert.match(value.content[0].text, /WP34-ECHO/);
    // OR56. This asserted `server/discover`, the method this client used to open with. That
    // string was the defect: it is optional for clients under the 2026-07-28 revision and no
    // server here is obliged to answer it, while `initialize` is what the runner's probe, the
    // runner's own MCP server and the gateway's builtin adapter all speak.
    assert.ok(
      requests.some((request) => request.method === MCP_DISCOVERY_METHOD),
    );
    assert.ok(requests.some((request) => request.method === "tools/list"));
    assert.ok(requests.some((request) => request.method === "tools/call"));
    assert.ok(
      requests.every(
        (request) =>
          request.headers.get("x-ag-credentials") ===
          "short-lived-gateway-token",
      ),
    );
    assert.ok(
      requests.every(
        (request) =>
          request.headers.get("mcp-protocol-version") === "2026-07-28",
      ),
    );
  });

  it("rejects malformed config and makes server/tool names collision-resistant", () => {
    assert.throws(
      () => parsePiGatewayMcpConfig('{"version":2}'),
      /invalid Pi gateway MCP configuration/,
    );
    assert.equal(
      piMcpToolName("my-server", "echo.tool"),
      "mcp__my_server__echo_tool",
    );
  });

  it("does not replace an existing Pi or Agenta tool", async () => {
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const payload = JSON.parse(String(init?.body));
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : {
              resultType: "complete",
              supportedVersions: ["2026-07-28"],
              capabilities: { tools: {} },
            };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
        { status: 200 },
      );
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
            registerTool: () =>
              assert.fail("must not replace an existing tool"),
            getAllTools: () => [{ name: "mcp__mock__echo" }, { name: "read" }],
          },
          raw,
          () => {},
          allowAll,
        ),
      /MCP tool name collision/,
    );
  });
  it("keeps the turn alive when a server fails its handshake, naming it in the log", async () => {
    // OR32. Pi used to let the refusal escape `before_agent_start` and kill the whole turn: the
    // person saw a generic run failure and never the server name. One broken server must cost
    // only its own tools, exactly as it does on the ACP harnesses.
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).includes("/broken")) {
        return new Response("not implemented", { status: 501 });
      }
      const result = {
        tools: [{ name: "echo", inputSchema: { type: "object" } }],
      };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
      });
    }) as typeof fetch;
    const raw = serializePiGatewayMcpConfig([
      {
        name: "broken",
        url: "https://api.example.test/gateways/mcps/custom/broken",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
      {
        name: "healthy",
        url: "https://api.example.test/gateways/mcps/custom/healthy",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
    ]);
    const registered: string[] = [];
    const logs: string[] = [];
    await registerPiGatewayMcpTools(
      {
        registerTool: (tool: any) => registered.push(tool.name),
        getAllTools: () => [],
      },
      raw,
      (message) => logs.push(message),
      allowAll,
    );

    assert.deepEqual(registered, ["mcp__healthy__echo"]);
    assert.ok(
      logs.some((line) =>
        line.startsWith(
          "[mcp] warn: server 'broken' failed its handshake: status=501",
        ),
      ),
      logs.join("\n"),
    );
    assert.ok(
      logs.some((line) => line.includes("from 1/2 server(s)")),
      logs.join("\n"),
    );
  });

  it("opens discovery with the one method the gateway's builtin adapter answers", async () => {
    // OR56. Three components each named a different method for the same step: this client sent
    // `server/discover`, the runner's handshake probe sent `initialize`, and the builtin adapter
    // answered neither — it accepted only `tools/list` and `tools/call`. A server that satisfied
    // one client refused the next. `initialize` is the specification's handshake and the method
    // the two harness clients we do not control (Claude Code, Codex) open with, so it is the one
    // string all of them use. This drives the client and the probe against the same adapter
    // stand-in: before the fix the client's first call was refused and it registered nothing.
    const methods: string[] = [];
    globalThis.fetch = builtinAdapterFetch({
      onRequest: (method) => methods.push(method),
    });

    const registered: any[] = [];
    await registerPiGatewayMcpTools(
      { registerTool: (tool) => registered.push(tool), getAllTools: () => [] },
      oneServerConfig(),
      () => {},
      allowAll,
    );

    assert.equal(MCP_DISCOVERY_METHOD, "initialize");
    assert.equal(methods[0], MCP_DISCOVERY_METHOD);
    assert.deepEqual(
      registered.map((tool) => tool.name),
      ["mcp__mock__echo"],
    );

    // The same adapter stand-in, driven by the runner's own handshake probe: one lifecycle means
    // the probe's verdict is evidence about the client that follows it, not about a third method.
    const probeMethods: string[] = [];
    const failure = await probeMcpServerHandshake(
      {
        name: "mock",
        connection: {
          type: "http",
          url: "https://api.example.test/gateways/mcps/custom/mock",
          credentials: [
            {
              binding: { kind: "header", name: "X-AG-Credentials" },
              value: "short-lived-gateway-token",
              usage: "opaque_http",
            },
          ],
        },
      },
      {
        fetchImpl: (async (url: string, init: any) => {
          probeMethods.push(JSON.parse(String(init.body)).method);
          return builtinAdapterFetch()(url, init) as any;
        }) as any,
      },
    );
    assert.equal(failure, undefined);
    assert.deepEqual(probeMethods, [MCP_DISCOVERY_METHOD]);
  });

  it("keeps a pooled session's MCP tools on its second turn", async () => {
    // OR59. `before_agent_start` runs once per turn and a pooled session runs many turns through
    // one Pi instance. The collision guard was seeded from `pi.getAllTools()`, which on turn two
    // already holds turn one's gateway tools, so the session collided with itself and the tools
    // went missing for the rest of the session. Re-registering what this module itself put there
    // is a no-op; only a name someone else owns is a collision.
    globalThis.fetch = builtinAdapterFetch();
    const pi = fakePi();
    const raw = oneServerConfig();
    const logs: string[] = [];

    await registerPiGatewayMcpTools(
      pi,
      raw,
      (message) => logs.push(message),
      allowAll,
    );
    assert.deepEqual(
      pi.tools.map((tool) => tool.name),
      ["mcp__mock__echo"],
      "first turn registers the server's tool",
    );

    await registerPiGatewayMcpTools(
      pi,
      raw,
      (message) => logs.push(message),
      allowAll,
    );
    assert.deepEqual(
      pi.tools.map((tool) => tool.name),
      ["mcp__mock__echo"],
      "second turn keeps it, exactly once",
    );
    assert.ok(
      !logs.some((line) => line.includes("collision")),
      logs.join("\n"),
    );

    // Present is not enough: the tool the second turn hands the model must still run.
    const value: any = await pi.tools[0].execute("call-1", {});
    assert.match(value.content[0].text, /ok/);
  });

  it("reports a genuine collision instead of leaving the turn unexplained", async () => {
    // OR59's other half. A name Pi already holds that this module did not register is a real
    // defect, and it must cost only its own tool: the other server's tools still register, the
    // log names the offending tool, and the caller still sees the failure.
    globalThis.fetch = builtinAdapterFetch();
    const raw = serializePiGatewayMcpConfig([
      {
        name: "shadow",
        url: "https://api.example.test/gateways/mcps/custom/shadow",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
      {
        name: "healthy",
        url: "https://api.example.test/gateways/mcps/custom/healthy",
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: { tools: { mode: "all" } },
      },
    ]);
    const registered: string[] = [];
    const logs: string[] = [];

    await assert.rejects(
      () =>
        registerPiGatewayMcpTools(
          {
            registerTool: (tool: any) => registered.push(tool.name),
            getAllTools: () => [{ name: "mcp__shadow__echo" }],
          },
          raw,
          (message) => logs.push(message),
          allowAll,
        ),
      /MCP tool name collision: mcp__shadow__echo/,
    );
    assert.deepEqual(registered, ["mcp__healthy__echo"]);
    assert.ok(
      logs.some(
        (line) =>
          line.startsWith("[mcp] error:") && line.includes("mcp__shadow__echo"),
      ),
      logs.join("\n"),
    );
  });
});

/**
 * OR79 / OR80. Pi used to register every MCP tool with an `execute` that called the upstream
 * directly, so `MCPPolicy.permission` was dead configuration on this harness in both directions:
 * an `ask` server ran unattended and a `deny` server ran too. These cases pin the gate.
 */
describe("Pi MCP permissions", () => {
  function configWithPolicy(policy: unknown, name = "mock"): string {
    return serializePiGatewayMcpConfig([
      {
        name,
        url: `https://api.example.test/gateways/mcps/custom/${name}`,
        headers: { "X-AG-Credentials": "short-lived-gateway-token" },
        policy: policy as any,
      },
    ]);
  }

  /** Records what the gate was asked, and answers with a fixed verdict. */
  function recordingGate(allowed: boolean) {
    const seen: any[] = [];
    const gate = async (request: any) => {
      seen.push(request);
      return { allowed, reason: "refused at the approval gate" };
    };
    return { gate, seen };
  }

  it("never registers a tool the policy denies, so the model is not offered it", async () => {
    const calls: string[] = [];
    globalThis.fetch = builtinAdapterFetch({
      onRequest: (method) => calls.push(method),
    });
    const pi = fakePi();

    await registerPiGatewayMcpTools(
      pi,
      configWithPolicy({ tools: { mode: "all" }, permission: "deny" }),
      () => {},
      allowAll,
    );

    assert.deepEqual(pi.tools, []);
    assert.ok(!calls.includes("tools/call"));
  });

  it("refuses an ask tool at the gate without calling the upstream", async () => {
    const calls: string[] = [];
    globalThis.fetch = builtinAdapterFetch({
      onRequest: (method) => calls.push(method),
    });
    const pi = fakePi();
    const { gate, seen } = recordingGate(false);

    await registerPiGatewayMcpTools(
      pi,
      configWithPolicy({ tools: { mode: "all" }, permission: "ask" }),
      () => {},
      gate,
    );
    assert.equal(pi.tools.length, 1);

    const result = await pi.tools[0].execute("call-1", { marker: "X" });

    // The refusal is the tool's own result text, so the model loop continues.
    assert.match(result.content[0].text, /refused at the approval gate/);
    // The one assertion that matters: no upstream side effect from a refused call.
    assert.ok(!calls.includes("tools/call"));
    assert.equal(seen.length, 1);
  });

  it("calls the upstream once the gate allows", async () => {
    const calls: string[] = [];
    globalThis.fetch = builtinAdapterFetch({
      onRequest: (method) => calls.push(method),
    });
    const pi = fakePi();
    const { gate } = recordingGate(true);

    await registerPiGatewayMcpTools(
      pi,
      configWithPolicy({ tools: { mode: "all" }, permission: "ask" }),
      () => {},
      gate,
    );
    await pi.tools[0].execute("call-1", { marker: "X" });

    assert.ok(calls.includes("tools/call"));
  });

  it("hands the gate the server and upstream tool names, not the rendered one", async () => {
    // OR80: `acme-prod`/`echo` renders as `mcp__acme_prod__echo`, which no parse turns back into
    // the names the policy is keyed on. So identity travels; it is not recovered.
    globalThis.fetch = builtinAdapterFetch();
    const pi = fakePi();
    const { gate, seen } = recordingGate(true);

    await registerPiGatewayMcpTools(
      pi,
      configWithPolicy(
        { tools: { mode: "all" }, permission: "ask" },
        "acme-prod",
      ),
      () => {},
      gate,
    );
    await pi.tools[0].execute("call-7", { marker: "X" });

    assert.equal(pi.tools[0].name, "mcp__acme_prod__echo");
    assert.equal(seen[0].mcpServer, "acme-prod");
    assert.equal(seen[0].mcpTool, "echo");
    assert.equal(seen[0].toolName, "mcp__acme_prod__echo");
    assert.equal(seen[0].toolCallId, "call-7");
  });

  it("drops a per-tool deny while keeping the rest of the server's tools", async () => {
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? {
              tools: [
                { name: "echo", inputSchema: { type: "object" } },
                { name: "purge", inputSchema: { type: "object" } },
              ],
            }
          : { protocolVersion: "2026-07-28", capabilities: { tools: {} } };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const pi = fakePi();

    await registerPiGatewayMcpTools(
      pi,
      configWithPolicy({
        tools: { mode: "all" },
        permission: "allow",
        toolPermissions: { echo: "allow", purge: "deny" },
        newToolPermission: "ask",
      }),
      () => {},
      allowAll,
    );

    assert.deepEqual(
      pi.tools.map((tool: any) => tool.name),
      ["mcp__mock__echo"],
    );
  });

  it("keeps the first claimant and refuses the second when two render one name", async () => {
    // Whichever registered first would otherwise answer for both, so the model would reach one
    // account's tool believing it had reached the other's. The name stays with its first
    // claimant, the second server's tool is refused, and the registration fails loudly. OR80.
    globalThis.fetch = builtinAdapterFetch();
    const registered: string[] = [];
    const logs: string[] = [];

    await assert.rejects(
      () =>
        registerPiGatewayMcpTools(
          {
            registerTool: (tool: any) => registered.push(tool.name),
            getAllTools: () => [],
          },
          serializePiGatewayMcpConfig([
            {
              name: "acme-prod",
              url: "https://api.example.test/gateways/mcps/custom/a",
              headers: { "X-AG-Credentials": "t" },
              policy: { tools: { mode: "all" } },
            },
            {
              name: "acme.prod",
              url: "https://api.example.test/gateways/mcps/custom/b",
              headers: { "X-AG-Credentials": "t" },
              policy: { tools: { mode: "all" } },
            },
          ]),
          (message) => logs.push(message),
          allowAll,
        ),
      /MCP tool name collision: mcp__acme_prod__echo/,
    );

    assert.deepEqual(registered, ["mcp__acme_prod__echo"]);
    assert.ok(
      logs.some(
        (line) =>
          line.includes("both render tool 'echo' as 'mcp__acme_prod__echo'") &&
          line.includes("it stays with 'acme-prod'"),
      ),
    );
  });
});
