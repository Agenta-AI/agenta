/**
 * Unit tests for buildToolMcpServers — the INTERNAL gateway-tool MCP channel, RESTORED over an
 * internal loopback HTTP MCP server.
 *
 * PR #4831 disabled this channel as collateral with the USER stdio MCP disable, hard-failing
 * Claude + gateway tools. This restores it: the runner stands up a loopback HTTP MCP endpoint
 * (no runner-host child process) advertising the run's executable tools, and returns a
 * `type: "http"` MCP server entry pointing at it. Execution relays back to the runner where the
 * private spec / callback auth are applied. The advertisement carries only public tool metadata
 * plus a per-server bearer token for the loopback endpoint.
 *
 * These tests assert the authenticated endpoint lifecycle, request validation, batch behavior,
 * public tool advertisement, and server-side `tools/call` relay.
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
import {
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
} from "../../src/tools/relay.ts";
import type { ClientToolRelay } from "../../src/tools/client-tool-relay.ts";
import type { ResolvedToolSpec } from "../../src/protocol.ts";

const relayDir = "/tmp/agenta-tools";

/** Track every started server so we always release its port. */
const started: ToolMcpServersResult[] = [];
const authorizationByUrl = new Map<string, string>();
async function build(...args: Parameters<typeof buildToolMcpServers>) {
  const result = await buildToolMcpServers(...args);
  started.push(result);
  for (const server of result.servers) {
    const authorization = server.headers.find(
      (header) => header.name.toLowerCase() === "authorization",
    )?.value;
    if (authorization) authorizationByUrl.set(server.url, authorization);
  }
  return result;
}

afterEach(async () => {
  await Promise.all(started.map((s) => s.close()));
  started.length = 0;
  authorizationByUrl.clear();
});

function authorizationFor(url: string): string {
  const authorization = authorizationByUrl.get(url);
  assert.ok(authorization, `missing advertised Authorization header for ${url}`);
  return authorization;
}

async function postRaw(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: authorizationFor(url),
    },
    body,
  });
}

/** One authenticated JSON-RPC POST, returning the parsed JSON response. */
async function rpc(url: string, body: unknown): Promise<any> {
  const res = await postRaw(url, JSON.stringify(body));
  if (res.status === 202) return undefined;
  return res.json();
}

describe("buildToolMcpServers (internal gateway-tool channel)", () => {
  it("starts one internal http server with a per-server bearer credential", async () => {
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
    assert.equal(server.headers.length, 1);
    assert.equal(server.headers[0].name, "Authorization");
    assert.match(server.headers[0].value, /^Bearer [A-Za-z0-9_-]{43}$/);
    // The advertisement must not leak the private callRef anywhere.
    assert.ok(
      !JSON.stringify(server).includes("composio.search"),
      "the server entry never carries the private callRef",
    );
  });

  it("rotates the bearer token for each server instance", async () => {
    const specs: ResolvedToolSpec[] = [
      { name: "search", kind: "callback", callRef: "composio.search" },
    ];
    const first = await build(specs, relayDir);
    const second = await build(specs, relayDir);

    const firstAuthorization = authorizationFor(first.servers[0].url);
    const secondAuthorization = authorizationFor(second.servers[0].url);
    assert.notEqual(firstAuthorization, secondAuthorization);

    const response = await fetch(first.servers[0].url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: secondAuthorization,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 401, "a different server's token is rejected");
  });

  it("starts the server for a callback run too (executable)", async () => {
    const specs: ResolvedToolSpec[] = [
      {
        name: "adder",
        kind: "callback",
        callRef: "composio.add",
        description: "Add numbers",
      },
    ];
    const { servers } = await build(specs, relayDir);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].type, "http");
    assert.ok(
      !JSON.stringify(servers[0]).includes("composio.add"),
      "the private callRef never crosses to the advertisement",
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
        kind: "callback",
        callRef: "composio.add",
      },
    ];
    const { servers } = await build(specs, relayDir);
    assert.equal(servers.length, 1, "one server for the executable spec");
  });

  describe("the served MCP endpoint", () => {
    it("authenticates every method and token shape before either executor can run", async () => {
      const dir = mkdtempSync(join(tmpdir(), "agenta-tool-auth-"));
      let clientDispatchCount = 0;
      const clientToolRelay: ClientToolRelay = {
        onClientTool: async () => {
          clientDispatchCount += 1;
          return "deny";
        },
      };
      try {
        const { servers } = await build(
          [
            { name: "search", kind: "callback", callRef: "composio.search" },
            { name: "confirm", kind: "client" },
          ],
          dir,
          { clientToolRelay },
        );
        const url = servers[0].url;
        const token = authorizationFor(url).slice("Bearer ".length);

        for (const method of ["GET", "DELETE"]) {
          const response = await fetch(url, { method });
          assert.equal(response.status, 401, `unauthenticated ${method}`);
          assert.equal(((await response.json()) as any).error.code, -32001);
        }

        const request = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search", arguments: { q: "hi" } },
        });
        for (const authorization of [
          "Basic " + token,
          "Bearer",
          "Bearer  " + token,
          "Bearer\t" + token,
        ]) {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization,
            },
            body: request,
          });
          assert.equal(response.status, 401, authorization);
          assert.equal(((await response.json()) as any).error.code, -32001);
        }

        assert.deepEqual(readdirSync(dir), [], "the callback executor never publishes a request");
        assert.equal(clientDispatchCount, 0, "the client relay is never invoked");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

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

    it("keeps non-client batch behavior unchanged", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const { servers } = await build(specs, relayDir);
      const out = await rpc(servers[0].url, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);

      assert.ok(Array.isArray(out));
      assert.equal(out.length, 2);
      assert.equal(out[0].result.serverInfo.name, "agenta-tools");
      assert.equal(out[1].result.tools[0].name, "search");
    });

    it("returns a JSON-RPC parse error for malformed JSON", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const { servers } = await build(specs, relayDir);
      const response = await postRaw(servers[0].url, "{not-json");
      const body = (await response.json()) as any;

      assert.equal(response.status, 400);
      assert.equal(body.error.code, -32700);
      assert.equal(body.id, null);
    });

    it("rejects a request body larger than one megabyte", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const { servers } = await build(specs, relayDir);
      let response: Response | undefined;
      let transportRejected = false;
      try {
        response = await postRaw(servers[0].url, "x".repeat(1_000_001));
      } catch {
        transportRejected = true;
      }

      assert.ok(
        transportRejected || (response !== undefined && !response.ok),
        "the oversized request must not be accepted",
      );
    });

    it("closes the listening socket normally", async () => {
      const specs: ResolvedToolSpec[] = [
        { name: "search", kind: "callback", callRef: "composio.search" },
      ];
      const result = await build(specs, relayDir);
      const url = result.servers[0].url;
      const authorization = authorizationFor(url);

      await result.close();
      started.splice(started.indexOf(result), 1);
      authorizationByUrl.delete(url);

      await assert.rejects(() =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
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

    it("rejects missing and wrong bearer tokens before dispatch", async () => {
      let dispatchCount = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => {
          dispatchCount += 1;
          return "deny";
        },
      };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "request_connection",
          arguments: { integration: "slack" },
        },
      });

      const missing = await fetch(servers[0].url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: request,
      });
      assert.equal(missing.status, 401);
      assert.equal(((await missing.json()) as any).error.code, -32001);

      const wrong = await fetch(servers[0].url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong",
        },
        body: request,
      });
      assert.equal(wrong.status, 401);
      assert.equal(((await wrong.json()) as any).error.code, -32001);
      assert.equal(dispatchCount, 0, "unauthenticated requests dispatch nothing");
    });

    it("rejects a batch containing a client tool before executing any item", async () => {
      const dir = mkdtempSync(join(tmpdir(), "agenta-tool-batch-"));
      let clientDispatchCount = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => {
          clientDispatchCount += 1;
          return "deny";
        },
      };
      try {
        const { servers } = await build(
          [
            { name: "search", kind: "callback", callRef: "composio.search" },
            clientSpec,
          ],
          dir,
          { clientToolRelay: relay },
        );
        const response = await postRaw(
          servers[0].url,
          JSON.stringify([
            {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "search", arguments: { q: "hi" } },
            },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: {
                name: "request_connection",
                arguments: { integration: "slack" },
              },
            },
          ]),
        );
        const body = (await response.json()) as any;

        assert.equal(response.status, 400);
        assert.equal(body.error.code, -32600);
        assert.ok(!Array.isArray(body), "the batch gets one JSON-RPC error");
        assert.equal(clientDispatchCount, 0, "the client relay is never called");
        assert.deepEqual(readdirSync(dir), [], "the executable sibling is never dispatched");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("advertises client tools in tools/list when a relay is wired", async () => {
      const relay: ClientToolRelay = {
        onClientTool: async () => "pendingApproval",
      };
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

    it("pauses: NO tool result, the request is aborted, and onPause fires exactly once", async () => {
      // The acceptance unit: a paused client tool must produce NO JSON-RPC result for its
      // tools/call (a result would let Claude settle and clobber the pending widget). The handler
      // returns the paused sentinel and the listener destroys the socket, so the client's request
      // is aborted with no body — and onPause is called once (the turn-ender).
      let pauseCount = 0;
      let onClientToolCalls = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => {
          onClientToolCalls += 1;
          return "pendingApproval";
        },
        onPause: () => {
          pauseCount += 1;
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
              authorization: authorizationFor(servers[0].url),
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
          // No body is ever written for a paused call; reading it must fail (socket destroyed).
          await res.text();
        },
        "the paused tools/call is aborted with no JSON-RPC result",
      );
      assert.equal(onClientToolCalls, 1, "the relay was consulted once");
      assert.equal(pauseCount, 1, "onPause fired exactly once");
    });

    it("a duplicate POST with the same JSON-RPC id after a pause is also aborted, never answered", async () => {
      // Pins the no-retry assumption at the HANDLER level: if the MCP client ever re-sent a
      // destroyed tools/call (same JSON-RPC id), the duplicate must get the same no-body abort —
      // each POST independently consults the relay, and nothing is answered from cached state,
      // so a duplicate can never double-consume a stored browser output.
      let onClientToolCalls = 0;
      let outputsServed = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => {
          onClientToolCalls += 1;
          // The paused turn has no stored output; every ask pauses. If the handler ever served
          // a result for the duplicate anyway, outputsServed would flag it below.
          return "pendingApproval";
        },
        onPause: () => {},
      };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      const post = async (): Promise<void> => {
        const res = await fetch(servers[0].url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: authorizationFor(servers[0].url),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 7, // the SAME JSON-RPC id both times (a retry, not a new call)
            method: "tools/call",
            params: {
              name: "request_connection",
              arguments: { integration: "slack" },
            },
          }),
        });
        outputsServed += 1; // only reachable if a body was actually answered
        await res.text();
      };
      await assert.rejects(post, "the first paused tools/call is aborted");
      await assert.rejects(post, "the duplicate (same id) is aborted too");
      assert.equal(onClientToolCalls, 2, "each POST consults the relay independently");
      assert.equal(outputsServed, 0, "neither request was ever answered with a result");
    });

    it("validates required args in the client branch (a normal MCP error, not a pause)", async () => {
      let pauseCount = 0;
      const relay: ClientToolRelay = {
        onClientTool: async () => "pendingApproval",
        onPause: () => {
          pauseCount += 1;
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
      assert.equal(pauseCount, 0, "an under-specified call never pauses");
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

    it("denies: a normal MCP tool error the model can recover from", async () => {
      const relay: ClientToolRelay = { onClientTool: async () => "deny" };
      const { servers } = await build([clientSpec], relayDir, {
        clientToolRelay: relay,
      });
      const out = await rpc(servers[0].url, {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "request_connection",
          arguments: { integration: "slack" },
        },
      });
      assert.equal(out.result.isError, true);
      assert.match(out.result.content[0].text, /was denied/);
    });
  });
});
