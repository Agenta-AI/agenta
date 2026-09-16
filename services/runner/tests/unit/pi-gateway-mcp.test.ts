import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import {
  MCP_DISCOVERY_METHOD,
  MCP_PROTOCOL_VERSION,
  PI_MCP_REQUEST_TIMEOUT_MS,
  parsePiGatewayMcpConfig,
  piGatewayMcpServersFromWire,
  piMcpToolName,
  readMcpResponseJson,
  registerPiGatewayMcpTools,
  serializePiGatewayMcpConfig,
} from "../../src/extensions/pi-mcp.ts";
import { probeMcpServerHandshake } from "../../src/engines/sandbox_agent/mcp-handshake.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // One case drives the clock; restore it here so a failed assertion cannot leak fake timers
  // into the next test.
  vi.useRealTimers();
});

/**
 * A stand-in for the gateway's builtin adapter
 * (`api/oss/src/core/gateways/mcps/providers/agenta/adapter.py`): it answers the handshake, then
 * `tools/list` and `tools/call`, and refuses every other method the way that adapter does — the
 * gateway turns its `ValueError` into a non-2xx, not a JSON-RPC error. Written as the narrow set
 * it is, so a client that opens with anything else fails here exactly as it failed in production.
 */
/**
 * The revision this stand-in ANSWERS, deliberately older than the one the client offers, so every
 * case using it exercises the downgrade rather than an echo (D64).
 */
const BUILTIN_NEGOTIATED_VERSION = "2025-03-26";

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
            protocolVersion: BUILTIN_NEGOTIATED_VERSION,
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

/**
 * A promise that settles either way, plus a bounded wait for it. A request the client should have
 * abandoned never settles on its own here, so without the bound the test would hang instead of
 * failing; `raceSettled` turns "never abandoned" into a fast, readable failure.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function raceSettled(work: Promise<unknown>): Promise<"settled" | "hung"> {
  const outcome = await Promise.race([
    work.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 250)),
  ]);
  return outcome;
}

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
        payload.method === "initialize"
          ? {
              // Answered, and answered OLDER than the client offered, so what follows tests the
              // negotiated value rather than the client's own fallback (D64).
              protocolVersion: BUILTIN_NEGOTIATED_VERSION,
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
              ? {
                  content: [
                    { type: "text", text: payload.params.arguments.marker },
                  ],
                }
              : {
                  resultType: "complete",
                  supportedVersions: [BUILTIN_NEGOTIATED_VERSION],
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
    // Not on `initialize`, which negotiates the version, and the agreed one on everything after.
    // This stand-in negotiates DOWN, so the value asserted here is one the client never offered:
    // a client echoing its own constant would pass against a server that echoed back and fail
    // here, which is the whole point of the case (D64).
    assert.notEqual(BUILTIN_NEGOTIATED_VERSION, MCP_PROTOCOL_VERSION);
    assert.ok(
      requests.every((request) =>
        request.method === MCP_DISCOVERY_METHOD
          ? request.headers.get("mcp-protocol-version") === null
          : request.headers.get("mcp-protocol-version") === BUILTIN_NEGOTIATED_VERSION,
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

describe("the Pi MCP client bounds its own requests (CR10)", () => {
  it("passes the turn's abort signal through to the upstream tool call", async () => {
    // Pi hands the signal in the third positional slot; it used to be ignored, so a cancelled
    // turn still sat waiting on the upstream.
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = (async (_url: string, init: any) => {
      signals.push(init?.signal);
      const payload = JSON.parse(String(init?.body));
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : { protocolVersion: "2026-07-28", capabilities: { tools: {} } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);
    const turnSignal = new AbortController().signal;
    await pi.tools[0].execute("call-1", { marker: "X" }, turnSignal);

    // Every request carries a signal, and none of them is the raw turn signal: the client
    // composes it with its own timeout so either can abort the request.
    assert.ok(signals.length > 0);
    assert.ok(signals.every((signal) => signal instanceof AbortSignal));
    assert.ok(signals.every((signal) => signal !== turnSignal));
  });

  it("aborts the upstream call when the turn is already cancelled", async () => {
    // Methods that actually completed a round trip, so the assertion can say what did NOT.
    const completed: string[] = [];
    globalThis.fetch = (async (_url: string, init: any) => {
      const payload = JSON.parse(String(init?.body));
      if (init?.signal?.aborted) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      completed.push(payload.method ?? "?");
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { protocolVersion: "2026-07-28", capabilities: { tools: {} } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(() =>
      pi.tools[0].execute("call-1", { marker: "X" }, controller.signal),
    );
    // Registration completed its handshake earlier; the cancelled call never reached the server.
    assert.ok(completed.includes("tools/list"));
    assert.ok(!completed.includes("tools/call"));
  });

  it("abandons a server that never answers, with no signal from the caller", async () => {
    // The client's own timeout is the only thing that can end this wait: no caller signal is
    // supplied, and the server never replies. Discovery runs before the turn's first token, so an
    // unbounded request here stalls the turn rather than failing it.
    const aborts: AbortSignal[] = [];
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const signal = init?.signal as AbortSignal;
      aborts.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    const logs: string[] = [];
    vi.useFakeTimers();
    const registration = registerPiGatewayMcpTools(
      pi,
      oneServerConfig(),
      (message) => logs.push(message),
      allowAll,
    );
    // Flushes the microtasks that issue the request, then moves the clock to the bound.
    await vi.advanceTimersByTimeAsync(PI_MCP_REQUEST_TIMEOUT_MS);
    vi.useRealTimers();

    assert.equal(
      await raceSettled(registration),
      "settled",
      "the request outlived the client's own timeout",
    );
    assert.equal(aborts.length, 1);
    assert.equal(aborts[0].aborted, true);
    assert.deepEqual(pi.tools, []);
    assert.ok(
      logs.some((line) => line.includes("failed its handshake")),
      "and the operator is told which server it was",
    );
  });

  it("aborts a call already in flight when the caller's signal fires", async () => {
    // The signal is NOT aborted when the call starts. An already-aborted signal is served by the
    // cheap `signal.aborted` check, so only a mid-flight abort exercises the listener.
    const inFlight = deferred<AbortSignal>();
    globalThis.fetch = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      const payload = JSON.parse(String(init?.body));
      const signal = init?.signal as AbortSignal;
      if (payload.method === "tools/call") {
        inFlight.resolve(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      }
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { protocolVersion: "2026-07-28", capabilities: { tools: {} } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);

    const controller = new AbortController();
    const call = pi.tools[0].execute("call-1", { marker: "X" }, controller.signal);
    // Swallowed here; the assertion below is on how the call ends, not on the rejection reaching
    // an unhandled-rejection handler first.
    const settled = call.then(
      () => "resolved",
      () => "rejected",
    );
    const upstream = await inFlight.promise;
    assert.equal(upstream.aborted, false, "still running when the turn is cancelled");

    controller.abort();

    assert.equal(
      await raceSettled(settled),
      "settled",
      "the caller's abort never reached the in-flight request",
    );
    assert.equal(await settled, "rejected");
    assert.equal(upstream.aborted, true);
  });
});

describe("a configured header cannot replace a protocol header (M19)", () => {
  it("keeps Accept, Content-Type and MCP-Protocol-Version whatever the config says", async () => {
    // `validateUserMcpServers` reserves none of the three, so a config is free to name them.
    // Spread after the protocol headers they replaced them, and `initialize` then failed in a way
    // that reads as a gateway bug rather than as the configuration it is.
    const seen: Record<string, string>[] = [];
    globalThis.fetch = (async (_url: string, init: any) => {
      seen.push(Object.fromEntries(Object.entries(init?.headers ?? {})));
      const payload = JSON.parse(String(init?.body));
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { protocolVersion: "2026-07-28", capabilities: { tools: {} } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const raw = serializePiGatewayMcpConfig([
      {
        name: "mock",
        url: "https://api.example.test/gateways/mcps/custom/mock",
        headers: {
          "X-AG-Credentials": "short-lived-gateway-token",
          // Exact-case attempts at all three.
          Accept: "text/plain",
          "Content-Type": "text/plain",
          "MCP-Protocol-Version": "1999-01-01",
          // And the lowercase duplicates `fetch` would otherwise fold into one value.
          accept: "text/plain",
          "mcp-protocol-version": "1999-01-01",
          // The session the client itself opens is not the config's to set either.
          "Mcp-Session-Id": "forged",
        },
        policy: { tools: { mode: "all" } },
      },
    ]);

    await registerPiGatewayMcpTools(fakePi(), raw, () => {}, allowAll);

    assert.ok(seen.length > 0);
    for (const headers of seen) {
      assert.equal(headers.Accept, "application/json, text/event-stream");
      assert.equal(headers["Content-Type"], "application/json");
      // Present only once initialize has agreed one, and never the configured value.
      assert.ok(
        headers["MCP-Protocol-Version"] === undefined ||
          headers["MCP-Protocol-Version"] === "2026-07-28",
      );
      // No lowercase twin survives to be folded in beside the real one.
      assert.equal(headers.accept, undefined);
      assert.equal(headers["mcp-protocol-version"], undefined);
      assert.equal(headers["Mcp-Session-Id"], undefined);
      // The credential the runner supplied is untouched.
      assert.equal(headers["X-AG-Credentials"], "short-lived-gateway-token");
    }
  });
});

describe("the Pi MCP client's own SSRF posture (CR9)", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("never follows a redirect on a credentialed request", async () => {
    // Every request this client makes carries the gateway credential, so a 302 would hand it to
    // a host nothing validated — the same gap the handshake probe closed.
    const inits: any[] = [];
    globalThis.fetch = (async (_url: string, init: any) => {
      inits.push(init);
      return new Response("", {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    }) as unknown as typeof fetch;

    const logs: string[] = [];
    await registerPiGatewayMcpTools(fakePi(), oneServerConfig(), (m) => logs.push(m), allowAll);

    assert.ok(inits.length > 0);
    assert.ok(inits.every((init) => init.redirect === "manual"));
    // And the redirect is reported as a failed handshake rather than chased.
    assert.ok(logs.some((line) => line.includes("failed its handshake")));
  });

  it("refuses a gateway-shaped URL on someone else's origin", () => {
    // The path check says the URL LOOKS like a gateway route; it does not say whose.
    process.env.AGENTA_API_URL = "https://agenta.example.test/api";
    process.env.AGENTA_API_INTERNAL_URL = "http://api:8000";

    assert.throws(
      () =>
        piGatewayMcpServersFromWire([
          {
            name: "evil",
            connection: {
              type: "http",
              url: "https://attacker.example.net/gateways/mcps/custom/evil",
              credentials: [
                {
                  binding: { kind: "header", name: "X-AG-Credentials" },
                  value: "short-lived-gateway-token",
                  usage: "opaque_http",
                },
              ],
            },
            policy: { tools: { mode: "all" } },
          },
        ]),
      /must be a route on this deployment's API/,
    );
  });

  it("accepts both the internal hop and the public base", () => {
    process.env.AGENTA_API_URL = "https://agenta.example.test/api";
    process.env.AGENTA_API_INTERNAL_URL = "http://api:8000";

    for (const url of [
      "http://api:8000/gateways/mcps/custom/ok",
      "https://agenta.example.test/api/gateways/mcps/custom/ok",
    ]) {
      const servers = piGatewayMcpServersFromWire([
        {
          name: "ok",
          connection: {
            type: "http",
            url,
            credentials: [
              {
                binding: { kind: "header", name: "X-AG-Credentials" },
                value: "short-lived-gateway-token",
                usage: "opaque_http",
              },
            ],
          },
          policy: { tools: { mode: "all" } },
        },
      ]);
      assert.equal(servers[0].url, url);
    }
  });

  it("keeps the path check alone when no API base is configured", () => {
    // A real self-hosted shape. Refusing every MCP server there would be a worse failure than
    // the narrower check, so the origin rule arms itself only when it can be decided.
    delete process.env.AGENTA_API_URL;
    delete process.env.AGENTA_API_INTERNAL_URL;

    const servers = piGatewayMcpServersFromWire([
      {
        name: "ok",
        connection: {
          type: "http",
          url: "https://anywhere.example.test/gateways/mcps/custom/ok",
          credentials: [
            {
              binding: { kind: "header", name: "X-AG-Credentials" },
              value: "short-lived-gateway-token",
              usage: "opaque_http",
            },
          ],
        },
        policy: { tools: { mode: "all" } },
      },
    ]);
    assert.equal(servers.length, 1);
  });
});

describe("the protocol version is negotiated, not asserted", () => {
  /** Every request the client made, in order, as (method, header) pairs. */
  function recordingFetch(
    seen: Array<{ method?: string; version?: string }>,
    serverVersion = "2025-11-25",
  ) {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;
      const version = Object.entries(headers ?? {}).find(
        ([name]) => name.toLowerCase() === "mcp-protocol-version",
      )?.[1];
      seen.push({ method: payload.method, ...(version ? { version } : {}) });
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : { protocolVersion: serverVersion, capabilities: { tools: {} } };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
  }

  it("sends no MCP-Protocol-Version on initialize, then the version the server chose", async () => {
    // A server that enforces the transport rule answers `initialize` with 400 when the header is
    // present, because the client cannot know the version before the server names it. Real
    // upstreams do enforce it; the mock adapter does not, which is why only a live server caught
    // this.
    const seen: Array<{ method?: string; version?: string }> = [];
    globalThis.fetch = recordingFetch(seen);

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);
    await pi.tools[0].execute("call-1", { marker: "X" });

    const initialize = seen.find((entry) => entry.method === MCP_DISCOVERY_METHOD);
    assert.ok(initialize, "the client opened with initialize");
    assert.equal(
      initialize.version,
      undefined,
      "initialize must carry no negotiated version",
    );

    const afterInitialize = seen.slice(seen.indexOf(initialize) + 1);
    assert.ok(afterInitialize.length > 0, "there are later requests to check");
    for (const entry of afterInitialize) {
      assert.equal(
        entry.version,
        "2025-11-25",
        `${entry.method} must carry the version the server chose`,
      );
    }
  });

  it("falls back to the client's own version when the server names none", async () => {
    const seen: Array<{ method?: string; version?: string }> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const headers = init?.headers as Record<string, string>;
      const version = Object.entries(headers ?? {}).find(
        ([name]) => name.toLowerCase() === "mcp-protocol-version",
      )?.[1];
      seen.push({ method: payload.method, ...(version ? { version } : {}) });
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : { capabilities: { tools: {} } };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);

    const toolsList = seen.find((entry) => entry.method === "tools/list");
    assert.equal(toolsList?.version, MCP_PROTOCOL_VERSION);
  });
});

describe("a real upstream's answers, as they actually arrive", () => {
  /**
   * Linear frames every reply as SSE and opens the event with `event: message`, then the data
   * line. It also negotiates DOWN, answering 2025-11-25 to a client that asked for 2026-07-28.
   * Both are ordinary, conforming server behaviour, and both used to break the client on its
   * first request.
   */
  function sseServer(
    options: {
      version?: string;
      seen?: { method: string; meta: unknown }[];
    } = {},
  ) {
    const version = options.version ?? "2025-11-25";
    return (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      options.seen?.push({
        method: payload.method,
        meta: payload.params?._meta,
      });
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : { protocolVersion: version, capabilities: { tools: {} } };
      // The event line first, exactly as it comes off the wire.
      const frame = `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: payload.id,
        result,
      })}\n\n`;
      return new Response(frame, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;
  }

  it("reads an SSE frame whose first line is the event, not the data", async () => {
    // Testing only the first character called every one of this server's answers invalid JSON,
    // so `discover()` threw on its first request and the server was dropped as a failed
    // handshake: no tool from it was ever registered.
    globalThis.fetch = sseServer();

    const pi = fakePi();
    const logs: string[] = [];
    await registerPiGatewayMcpTools(
      pi,
      oneServerConfig(),
      (message) => logs.push(message),
      allowAll,
    );

    assert.deepEqual(
      pi.tools.map((tool: any) => tool.name),
      ["mcp__mock__echo"],
      `the server's tools must register; log: ${logs.join(" | ")}`,
    );
  });

  it("sends no _meta envelope on any request (OR91)", async () => {
    // `_meta` is optional in every MCP revision and nothing on either side of this client reads
    // one back, but a server that receives one validates the whole envelope against the revision
    // in force. A real upstream answered every post-initialize request carrying
    // `_meta: {"io.modelcontextprotocol/protocolVersion": ...}` with -32602, naming a key this
    // client had never sent; the identical requests without `_meta` succeeded. Stamping the
    // NEGOTIATED revision rather than the client's own constant was still stamping an envelope,
    // so it only moved the refusal — the envelope itself had to go.
    const seen: { method: string; meta: unknown }[] = [];
    globalThis.fetch = sseServer({ version: "2025-11-25", seen });

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);
    await pi.tools[0].execute("call-1", { marker: "X" });

    assert.ok(
      seen.some((request) => request.method === "tools/list"),
      "the handshake must have run, or this asserts nothing",
    );
    const stamped = seen.filter((request) => request.meta !== undefined);
    assert.deepEqual(
      stamped,
      [],
      `no request may carry _meta, got ${stamped.map((r) => r.method).join(", ")}`,
    );
  });

  it("still sends the caller's own params, having dropped the envelope", async () => {
    // The envelope was spread in alongside the caller's params, so removing it is exactly the
    // kind of edit that takes the arguments with it and leaves every tool call empty.
    const seen: { method: string; meta: unknown }[] = [];
    const bodies: any[] = [];
    const inner = sseServer({ seen });
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return inner(url, init);
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);
    await pi.tools[0].execute("call-1", { marker: "X" });

    const call = bodies.find((body) => body.method === "tools/call");
    assert.ok(call, "the tool call must reach the upstream");
    assert.equal(call.params.name, "echo");
    assert.deepEqual(call.params.arguments, { marker: "X" });
  });
});


// D63. The transport lets a server send notifications before the response to a request, and both
// independent reviewers found this by executing it: joining every `data:` line produced two JSON
// documents separated by a newline, which parses as nothing, so `discover()` threw and the whole
// server was dropped as a failed handshake. The browser client
// (`web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts`) already read the stream frame by
// frame; this is the same wire and the two clients must agree about it.

describe("the shared SSE reader takes the frame that answers the request (D63)", () => {
  const notification = (method: string) =>
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method, params: {} })}\n\n`;
  const answer = (id: number, result: unknown) =>
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`;

  it("skips a notification sent before the result", () => {
    const body = notification("notifications/message") + answer(4, { tools: [] });

    const parsed = JSON.parse(readMcpResponseJson(body, 4));

    assert.equal(parsed.id, 4);
    assert.deepEqual(parsed.result, { tools: [] });
  });

  it("skips a notification sent after the result, which taking the last frame would not", () => {
    // The mock sends its notification first. A reader that simply took the last frame would pass
    // every cell here and still fail against a server that sends one afterwards, which the
    // transport equally permits.
    const body = answer(5, { tools: [{ name: "echo" }] }) + notification("notifications/progress");

    const parsed = JSON.parse(readMcpResponseJson(body, 5));

    assert.equal(parsed.id, 5);
  });

  it("picks this request's answer when another request's shares the stream", () => {
    const body = answer(1, { first: true }) + answer(2, { second: true });

    assert.deepEqual(JSON.parse(readMcpResponseJson(body, 1)).result, { first: true });
    assert.deepEqual(JSON.parse(readMcpResponseJson(body, 2)).result, { second: true });
  });

  it("takes the last answering frame when the caller numbered nothing, as the probe does", () => {
    const body = notification("notifications/message") + answer(9, { tools: [] });

    assert.equal(JSON.parse(readMcpResponseJson(body)).id, 9);
  });

  it("reads a JSON-RPC error frame, not only a result", () => {
    const body =
      notification("notifications/message") +
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32602, message: "no" },
      })}\n\n`;

    assert.equal(JSON.parse(readMcpResponseJson(body, 3)).error.message, "no");
  });

  it("still reads a plain JSON body and a single event, unchanged", () => {
    assert.deepEqual(JSON.parse(readMcpResponseJson('{"jsonrpc":"2.0","id":1,"result":{}}', 1)), {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
    assert.deepEqual(JSON.parse(readMcpResponseJson(answer(1, { ok: true }), 1)).result, {
      ok: true,
    });
  });

  it("returns the body whole when no frame answers, so the parse error names it", () => {
    // Otherwise an unreadable body and a body carrying only notifications would reach the caller
    // as the same silence, and the message an operator reads would name neither.
    assert.equal(readMcpResponseJson("not json at all", 1), "not json at all");
  });
});

describe("a server that sends a notification before its tool list (D63)", () => {
  it("registers its tools instead of being dropped as a failed handshake", async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} } };
      const body =
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", data: "working" },
        })}\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: payload.id, result })}\n\n`;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    const logs: string[] = [];
    await registerPiGatewayMcpTools(pi, oneServerConfig(), (m) => logs.push(m), allowAll);

    assert.deepEqual(
      pi.tools.map((tool: any) => tool.name),
      ["mcp__mock__echo"],
      `the server's tools must register; log: ${logs.join(" | ")}`,
    );

    const out = await pi.tools[0].execute("call-1", { marker: "X" });
    assert.ok(JSON.stringify(out).includes("ok"), `the call must return the result: ${JSON.stringify(out)}`);
  });
});

// D64. One product shipped three MCP clients naming two revisions: this one said 2026-07-28 while
// the browser client and the backend probe said 2025-06-18. A server was therefore told three
// different things about the wire by one product, and a mock whose strictness was derived from one
// client certified nothing about the other two.

describe("the revision this client offers (D64)", () => {
  it("is the one the browser client and the backend probe also offer", () => {
    // Kept in step by hand across three languages, so the value is asserted here rather than
    // left to a reader to notice. The other two are
    // `web/packages/agenta-entities/src/mcpEndpoint/core/mcpRpc.ts` (MCP_PROTOCOL_VERSION) and
    // `api/oss/src/core/gateways/mcps/probe.py` (_PROTOCOL_VERSION).
    assert.equal(MCP_PROTOCOL_VERSION, "2025-06-18");
  });

  it("is what initialize offers, while later requests carry what the server answered", async () => {
    const offered: (string | undefined)[] = [];
    const headers: (string | null)[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      offered.push(payload.params?.protocolVersion);
      headers.push(new Headers(init?.headers).get("mcp-protocol-version"));
      if (payload.id === undefined) return new Response("", { status: 202 });
      const result =
        payload.method === "tools/list"
          ? { tools: [{ name: "echo", inputSchema: { type: "object" } }] }
          : payload.method === "tools/call"
            ? { content: [{ type: "text", text: "ok" }] }
            : { protocolVersion: BUILTIN_NEGOTIATED_VERSION, capabilities: { tools: {} } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const pi = fakePi();
    await registerPiGatewayMcpTools(pi, oneServerConfig(), () => {}, allowAll);

    // The offer is ours and rides the handshake body only.
    assert.equal(offered[0], MCP_PROTOCOL_VERSION);
    assert.equal(headers[0], null);
    // Everything after carries the server's answer, which is not what we offered.
    assert.ok(headers.slice(1).length > 0, "there are later requests to check");
    assert.ok(
      headers.slice(1).every((value) => value === BUILTIN_NEGOTIATED_VERSION),
      `later requests must carry the negotiated revision, got ${headers.slice(1).join(", ")}`,
    );
  });
});
