/**
 * OR32: an MCP server that fails its handshake used to vanish from the run — the turn reported
 * success, the transcript said nothing, and the runner log said nothing either.
 *
 * Two halves are proven here. The probe itself classifies each way a handshake can fail and
 * names the server and the status in the log. Then the whole engine is driven once per harness,
 * because the three deliver MCP configuration three different ways (Pi through an env var its
 * extension reads, Claude and Codex through the ACP `session/new` parameter) and a fix that only
 * reached the ACP pair would leave Pi exactly as silent as before.
 *
 * Codex's second channel — its own synthetic `mcp__<server>__startup` failure frame, which the
 * runner used to discard — is pinned in `session-keepalive-engine.test.ts` beside the tool-call
 * suppression it belongs to.
 *
 * Run: pnpm exec vitest run tests/unit/mcp-handshake-notice.test.ts
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  mcpHandshakeFailureMessage,
  probeMcpServerHandshake,
  probeMcpServerHandshakes,
} from "../../src/engines/sandbox_agent/mcp-handshake.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import type { AgentEvent } from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

// A public IP literal, because `validateUserMcpUrl` resolves and range-blocks the host before the
// run ever reaches the probe. The path is a registered gateway route, which is what Pi requires.
const SERVER_URL = "https://93.184.216.34/gateways/mcps/custom/gw-mock-mcp/";
const GATEWAY_CREDENTIAL = "ag-mcp-credential";

const server = {
  name: "gw-mock-mcp",
  connection: {
    type: "http" as const,
    url: SERVER_URL,
    credentials: [
      {
        binding: { kind: "header" as const, name: "X-AG-Credentials" },
        value: GATEWAY_CREDENTIAL,
        usage: "opaque_http" as const,
      },
    ],
  },
  policy: { tools: { mode: "all" as const } },
};

function answer(
  body: string,
  init: { ok?: boolean; status?: number; sessionId?: string } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string) =>
        name === "mcp-session-id" ? (init.sessionId ?? null) : null,
    },
    text: async () => body,
  };
}

const okHandshake = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: { protocolVersion: "2026-07-28", capabilities: {} },
});

describe("MCP handshake probe", () => {
  it("names the status when the server refuses the handshake", async () => {
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async () =>
        answer("not implemented", { ok: false, status: 501 }),
    });
    assert.deepEqual(failure, {
      serverName: "gw-mock-mcp",
      reasonCode: "handshake_http_error",
      status: 501,
      message: "MCP server gw-mock-mcp failed to connect: 501",
    });
  });

  it("treats a JSON-RPC error under a 200 as a refusal, not a connection", async () => {
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async () =>
        answer(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32601, message: "no" },
          }),
        ),
    });
    assert.equal(failure?.reasonCode, "handshake_rejected");
    assert.equal(failure?.status, 200);
  });

  it("reports an unreachable server without a status", async () => {
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(failure?.reasonCode, "handshake_unreachable");
    assert.equal(failure?.status, undefined);
    assert.equal(
      failure?.message,
      "MCP server gw-mock-mcp failed to connect: handshake_unreachable",
    );
  });

  it("reports a body that is not a JSON-RPC answer", async () => {
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async () => answer("<html>gateway timeout</html>"),
    });
    assert.equal(failure?.reasonCode, "handshake_invalid_response");
  });

  it("reads a Streamable HTTP answer delivered as a single SSE event", async () => {
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async () => answer(`event: message\ndata: ${okHandshake}\n\n`),
    });
    assert.equal(failure, undefined);
  });

  it("carries the gateway credential into the handshake and releases the session it opened", async () => {
    const calls: Array<{ method: string; headers: Record<string, string> }> =
      [];
    const failure = await probeMcpServerHandshake(server, {
      fetchImpl: async (_url, init) => {
        calls.push({ method: init.method, headers: init.headers });
        return answer(okHandshake, { sessionId: "mcp-session-7" });
      },
    });
    assert.equal(failure, undefined);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["POST", "DELETE"],
    );
    for (const call of calls) {
      assert.equal(call.headers["X-AG-Credentials"], GATEWAY_CREDENTIAL);
    }
    assert.equal(calls[1].headers["mcp-session-id"], "mcp-session-7");
  });

  it("logs each failure at warn with the server name and the status", async () => {
    const logs: string[] = [];
    const failures = await probeMcpServerHandshakes([server], {
      fetchImpl: async () => answer("nope", { ok: false, status: 502 }),
      log: (message) => logs.push(message),
    });
    assert.equal(failures.length, 1);
    assert.deepEqual(logs, [
      "[mcp] warn: server 'gw-mock-mcp' failed its handshake: status=502 reason=handshake_http_error",
    ]);
  });

  it("says nothing and costs nothing when the run configures no MCP server", async () => {
    const logs: string[] = [];
    const failures = await probeMcpServerHandshakes(undefined, {
      fetchImpl: async () => {
        throw new Error("the probe must not run");
      },
      log: (message) => logs.push(message),
    });
    assert.deepEqual(failures, []);
    assert.deepEqual(logs, []);
  });

  it("builds the same sentence the notice carries", () => {
    assert.equal(
      mcpHandshakeFailureMessage("gw-mock-mcp", "handshake_http_error", 501),
      "MCP server gw-mock-mcp failed to connect: 501",
    );
  });
});

describe("a failed MCP server is reported on every harness", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const harness of ["pi_core", "claude", "codex"] as const) {
    it(`${harness} completes the turn and names the server that did not connect`, async () => {
      globalThis.fetch = (async () =>
        answer("not implemented", {
          ok: false,
          status: 501,
        })) as unknown as typeof fetch;
      const { deps, events, logs } = fakeHarness();

      const result = await runSandboxAgent(
        {
          harness,
          messages: [{ role: "user", content: "hello" }],
          mcpServers: [server],
        },
        undefined,
        undefined,
        deps,
      );

      // Non-fatal by construction: the turn still succeeds, it just ran without the server.
      assert.equal(result.ok, true);
      const notices = events.filter(
        (event: AgentEvent) => event.type === "mcp_server_failed",
      );
      assert.deepEqual(notices, [
        {
          type: "mcp_server_failed",
          serverName: "gw-mock-mcp",
          reasonCode: "handshake_http_error",
          status: 501,
          message: "MCP server gw-mock-mcp failed to connect: 501",
        },
      ]);
      assert.ok(
        logs.some((line) =>
          line.includes(
            "[mcp] warn: server 'gw-mock-mcp' failed its handshake: status=501",
          ),
        ),
        `no warn line for ${harness}: ${logs.join("\n")}`,
      );
    });
  }

  it("stays quiet when the server connects", async () => {
    globalThis.fetch = (async () =>
      answer(okHandshake)) as unknown as typeof fetch;
    const { deps, events } = fakeHarness();

    const result = await runSandboxAgent(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [server],
      },
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      events.filter((event: AgentEvent) => event.type === "mcp_server_failed"),
      [],
    );
  });
});
