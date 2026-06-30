/**
 * Unit tests for buildToolMcpServers — the INTERNAL gateway-tool MCP channel, RESTORED over an
 * internal loopback HTTP MCP server.
 *
 * PR #4831 disabled this channel as collateral with the USER stdio MCP disable, hard-failing
 * Claude + gateway tools. This restores it: the runner stands up a loopback HTTP MCP endpoint
 * (no runner-host child process) advertising the run's executable tools, and returns a
 * `type: "http"` MCP server entry pointing at it. Execution relays back to the runner where the
 * private spec / callback auth are applied — the channel itself carries only public metadata.
 *
 * These tests assert: an executable run yields one internal http server (no secrets in the
 * advertisement), the no-tools / client-only path stays a no-op, and the served MCP endpoint
 * advertises the public spec and routes a `tools/call` through the relay dir.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/tool-bridge.test.ts)
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

import {
  buildToolMcpServers,
  type ToolMcpServersResult,
} from "../../src/tools/mcp-bridge.ts";
import { RELAY_REQ_SUFFIX, RELAY_RES_SUFFIX } from "../../src/tools/relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";
import type { ClientToolRelay } from "../../src/responder.ts";

const relayDir = "/tmp/agenta-tools";

/** Track every started server so we always release its port. */
const started: ToolMcpServersResult[] = [];
async function build(...args: Parameters<typeof buildToolMcpServers>) {
  const result = await buildToolMcpServers(...args);
  started.push(result);
  return result;
}

afterEach(async () => {
  await Promise.all(started.map((s) => s.close()));
  started.length = 0;
});

/** One JSON-RPC POST to the internal MCP server, returning the parsed JSON response. */
async function rpc(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 202) return undefined;
  return res.json();
}

describe("buildToolMcpServers (internal gateway-tool channel)", () => {
  it("starts one internal http server for an executable callback run, with NO credentials", async () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "search",
        kind: "callback",
        callRef: "composio.search",
        description: "Search the web",
      },
    ];
    const { servers } = await build(specs, relayDir);

    assert.equal(servers.length, 1, "one internal server");
    const server = servers[0];
    assert.equal(
      server.type,
      "http",
      "delivered over the http transport (no host process)",
    );
    assert.equal(server.name, "agenta-tools");
    assert.match(
      server.url,
      /^http:\/\/127\.0\.0\.1:\d+\/mcp$/,
      "loopback url",
    );
    assert.deepEqual(
      server.headers,
      [],
      "no secret header — the channel carries no credential",
    );
    // The advertisement must not leak the private callRef anywhere.
    assert.ok(
      !JSON.stringify(server).includes("composio.search"),
      "the server entry never carries the private callRef",
    );
  });

  it("starts the server for a code run too (executable)", async () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "adder",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
        env: { PRIVATE: "secret" },
      },
    ];
    const { servers } = await build(specs, relayDir);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].type, "http");
    assert.ok(
      !JSON.stringify(servers[0]).includes("secret"),
      "scoped env never crosses to the advertisement",
    );
  });

  it("returns [] for empty specs (no-tools path untouched)", async () => {
    const { servers } = await build([], relayDir);
    assert.deepEqual(servers, [], "empty specs -> []");
  });

  it("returns [] for client-only specs (nothing executable goes through the channel)", async () => {
    const specs: ResolvedToolSpec[] = [{ name: "confirm", kind: "client" }];
    const { servers } = await build(specs, relayDir);
    assert.deepEqual(servers, [], "client-only -> []");
  });

  it("starts the server when an executable spec sits beside a client spec", async () => {
    const specs: ResolvedToolSpec[] = [
      { name: "confirm", kind: "client" },
      {
        name: "adder",
        kind: "code",
        runtime: "python",
        code: "def main(**k): return 1",
      },
    ];
    const { servers } = await build(specs, relayDir);
    assert.equal(servers.length, 1, "one server for the executable spec");
  });

  describe("the served MCP endpoint", () => {
    it("answers initialize / tools/list (public spec only, client filtered)", async () => {
      const specs: ResolvedToolSpec[] = [
        {
          name: "search",
          kind: "callback",
          callRef: "composio.search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
          },
        },
        { name: "confirm", kind: "client" },
      ];
      const { servers } = await build(specs, relayDir);
      const url = servers[0].url;

      const init = await rpc(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      assert.equal(init.result.serverInfo.name, "agenta-tools");
      assert.ok(init.result.capabilities.tools, "advertises tools capability");

      const list = await rpc(url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const tools = list.result.tools;
      assert.equal(
        tools.length,
        1,
        "the client tool is filtered out of the advertisement",
      );
      assert.equal(tools[0].name, "search");
      assert.equal(tools[0].description, "Search the web");
      assert.deepEqual(tools[0].inputSchema, {
        type: "object",
        properties: { q: { type: "string" } },
      });
      // The public advertisement never carries the private callRef.
      assert.ok(
        !JSON.stringify(tools).includes("composio.search"),
        "no callRef in tools/list",
      );
    });

    it("advertises a snake-case input_schema as a NON-empty schema (empty-schema regression)", async () => {
      // Platform-catalog tools carry snake-case `input_schema`. The advertisement used to read
      // only camelCase `s.inputSchema`, so Claude got EMPTY_OBJECT_SCHEMA and no argument schema.
      const specs = [
        {
          name: "commit_revision",
          kind: "callback",
          callRef: "platform.commit_revision",
          input_schema: {
            type: "object",
            required: ["workflow_revision"],
            properties: { workflow_revision: { type: "object" } },
          },
        },
      ] as unknown as ResolvedToolSpec[];
      const { servers } = await build(specs, relayDir);
      const list = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/list",
      });
      const tool = list.result.tools[0];
      assert.equal(tool.name, "commit_revision");
      assert.deepEqual(tool.inputSchema, {
        type: "object",
        required: ["workflow_revision"],
        properties: { workflow_revision: { type: "object" } },
      });
      assert.notDeepEqual(
        tool.inputSchema,
        { type: "object", properties: {} },
        "must not advertise the empty fallback schema",
      );
    });

    it("routes tools/call through the relay dir (server-side execution)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "agenta-tool-relay-"));
      try {
        const specs: ResolvedToolSpec[] = [
          { name: "search", kind: "callback", callRef: "composio.search" },
        ];
        const { servers } = await build(specs, dir);
        const url = servers[0].url;

        // Stand in for the runner relay loop: as soon as the request file appears, write the
        // response file the dispatcher polls for. This is the same file protocol the real
        // `startToolRelay` serves, so a green call proves the channel feeds the relay.
        const token = "relay-proof-marker";
        const watcher = (async () => {
          for (let i = 0; i < 200; i++) {
            const reqFile = readdirSync(dir).find((f) =>
              f.endsWith(RELAY_REQ_SUFFIX),
            );
            if (reqFile) {
              const req = JSON.parse(readFileSync(join(dir, reqFile), "utf-8"));
              // The relay only ever receives the public tool name + args, never the callRef.
              assert.equal(req.toolName, "search");
              assert.deepEqual(req.args, { q: "hi" });
              const id = reqFile.slice(0, -RELAY_REQ_SUFFIX.length);
              writeFileSync(
                join(dir, `${id}${RELAY_RES_SUFFIX}`),
                JSON.stringify({ ok: true, text: token }),
                "utf-8",
              );
              return;
            }
            await new Promise((r) => setTimeout(r, 25));
          }
          throw new Error("relay request file never appeared");
        })();

        const call = await rpc(url, {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "search", arguments: { q: "hi" } },
        });
        await watcher;

        assert.equal(call.result.isError, undefined, "successful call");
        assert.equal(call.result.content[0].type, "text");
        assert.equal(
          call.result.content[0].text,
          token,
          "the relay's response text reaches the caller",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns an MCP error for an unknown tool", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const { servers } = await build(specs, relayDir);
      const out = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nope", arguments: {} },
      });
      assert.equal(out.error.code, -32602);
      assert.match(out.error.message, /unknown tool/);
    });

    it("accepts a notification with no response (202)", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const { servers } = await build(specs, relayDir);
      const out = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      assert.equal(out, undefined, "notification -> 202, no body");
    });
  });

  describe("client tools (Claude delivery)", () => {
    const clientSpec: ResolvedToolSpec = {
      name: "request_connection",
      kind: "client",
      input_schema: {
        type: "object",
        required: ["integration"],
        properties: { integration: { type: "string" } },
      },
    } as unknown as ResolvedToolSpec;

    it("advertises client tools in tools/list when a relay is wired", async () => {
      const relay: ClientToolRelay = { onClientTool: async () => "park" };
      const { servers } = await build(
        [{ name: "search", kind: "callback", callRef: "x" }, clientSpec],
        relayDir,
        { clientToolRelay: relay },
      );
      assert.equal(servers.length, 1, "the server starts even with a client tool present");
      const list = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      const names = list.result.tools.map((t: any) => t.name).sort();
      assert.deepEqual(names, ["request_connection", "search"]);
    });

    it("parks: NO tool result, the request is aborted, and onPark fires exactly once", async () => {
      // The acceptance unit: a parked client tool must produce NO JSON-RPC result for its
      // tools/call (a result would let Claude settle and clobber the pending widget). The handler
      // returns the parked sentinel and the listener destroys the socket, so the client's request
      // is aborted with no body — and onPark is called once (the turn-ender).
      let parkCount = 0;
      let onClientToolCalls = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => {
          onClientToolCalls += 1;
          return "park";
        },
        onPark: () => {
          parkCount += 1;
        },
      };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      await assert.rejects(
        async () => {
          const res = await fetch(servers[0].url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 7,
              method: "tools/call",
              params: {
                name: "request_connection",
                arguments: { integration: "slack" },
              },
            }),
          });
          // No body is ever written for a parked call; reading it must fail (socket destroyed).
          await res.text();
        },
        "the parked tools/call is aborted with no JSON-RPC result",
      );
      assert.equal(onClientToolCalls, 1, "the relay was consulted once");
      assert.equal(parkCount, 1, "onPark fired exactly once");
    });

    it("validates required args in the client branch (a normal MCP error, not a park)", async () => {
      let parkCount = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => "park",
        onPark: () => {
          parkCount += 1;
        },
      };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      const out = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "request_connection", arguments: {} }, // missing `integration`
      });
      assert.equal(out.result.isError, true, "an under-specified call is a tool error");
      assert.match(out.result.content[0].text, /missing required argument\(s\): integration/);
      assert.equal(parkCount, 0, "an under-specified call never parks");
    });

    it("resumes: returns the browser's structured output as MCP content", async () => {
      const relay: ClientToolRelay = {
        onClientTool: async () => ({ output: { connected: true, account: "a" } }),
      };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      const out = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "request_connection",
          arguments: { integration: "slack" },
        },
      });
      assert.equal(out.result.isError, undefined, "a resolved client tool is not an error");
      assert.equal(
        out.result.content[0].text,
        JSON.stringify({ connected: true, account: "a" }),
      );
    });
  });
});
