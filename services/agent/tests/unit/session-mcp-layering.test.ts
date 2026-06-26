/**
 * Layering regression guard for buildSessionMcpServers — the test that FAILS if the internal
 * gateway-tool channel and the user MCP capability are ever re-merged into one gate.
 *
 * PR #4831 conflated two independent things into a single `MCP_UNSUPPORTED_MESSAGE` switch, which
 * disabled gateway-tool delivery to Claude as collateral with the (correct) user stdio MCP
 * disable. The fix (project gateway-tool-mcp) split them into:
 *   1. INTERNAL gateway-tool channel — restored over loopback HTTP MCP; toggles on executable tools.
 *   2. USER MCP capability — stdio DISABLED, http delivered (#4834).
 *
 * These three cases pin that the two layers toggle independently:
 *   (a) gateway tools + NO user MCP        -> internal channel present, no throw
 *   (b) user stdio MCP + NO gateway tools  -> refused (user gate)
 *   (c) gateway tools + user http MCP      -> BOTH delivered; user stdio still refused
 *
 * Plus: Pi gets [] (native delivery), and the channel never carries a credential.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-mcp-layering.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  buildSessionMcpServers,
  type SessionMcpServers,
} from "../../src/engines/sandbox_agent/mcp.ts";
import { USER_MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
} from "../../src/protocol.ts";

const relayDir = "/tmp/agenta-tools-layering";
const mcpCapable: HarnessCapabilities = { mcpTools: true, toolCalls: true };

const gatewayTool: ResolvedToolSpec = {
  name: "search",
  kind: "callback",
  callRef: "composio.search",
  description: "Search",
};

/** Always release the internal server's port after each case. */
const built: SessionMcpServers[] = [];
async function build(input: Parameters<typeof buildSessionMcpServers>[0]) {
  const result = await buildSessionMcpServers(input);
  built.push(result);
  return result;
}
afterEach(async () => {
  await Promise.all(built.map((b) => b.close()));
  built.length = 0;
});

describe("buildSessionMcpServers layering (do-not-merge regression guard)", () => {
  it("(a) gateway tools + no user MCP -> internal channel present, no throw", async () => {
    const { servers } = await build({
      isPi: false,
      isDaytona: false,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      userMcpServers: undefined,
      relayDir,
    });
    assert.equal(
      servers.length,
      1,
      "the internal gateway-tool server is delivered",
    );
    assert.equal(servers[0].name, "agenta-tools");
    assert.ok(
      "type" in servers[0] && servers[0].type === "http",
      "http transport",
    );
  });

  it("(b) user stdio MCP + no gateway tools -> refused (user gate untouched)", async () => {
    const userMcpServers: McpServerConfig[] = [
      { name: "github", transport: "stdio", command: "npx", args: ["x"] },
    ];
    await assert.rejects(
      () =>
        buildSessionMcpServers({
          isPi: false,
          isDaytona: false,
          capabilities: mcpCapable,
          harness: "claude",
          toolSpecs: [],
          userMcpServers,
          relayDir,
        }),
      new RegExp(USER_MCP_UNSUPPORTED_MESSAGE),
      "a user stdio MCP server is still refused",
    );
  });

  it("(c) gateway tools + user http MCP -> BOTH delivered; user stdio still refused", async () => {
    const { servers } = await build({
      isPi: false,
      isDaytona: false,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      userMcpServers: [
        {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/sse",
          env: { Authorization: "Bearer x" },
        },
      ],
      relayDir,
    });
    assert.equal(
      servers.length,
      2,
      "internal channel AND the user http server",
    );
    const names = servers.map((s) => s.name).sort();
    assert.deepEqual(names, ["agenta-tools", "linear"]);

    // The user stdio path is still refused even alongside a gateway tool.
    await assert.rejects(
      () =>
        buildSessionMcpServers({
          isPi: false,
          isDaytona: false,
          capabilities: mcpCapable,
          harness: "claude",
          toolSpecs: [gatewayTool],
          userMcpServers: [{ name: "evil", transport: "stdio", command: "rm" }],
          relayDir,
        }),
      new RegExp(USER_MCP_UNSUPPORTED_MESSAGE),
    );
  });

  it("Pi gets [] (native delivery, no MCP channel) even with gateway tools", async () => {
    const { servers } = await build({
      isPi: true,
      isDaytona: false,
      capabilities: mcpCapable,
      harness: "pi_agenta",
      toolSpecs: [gatewayTool],
      relayDir,
    });
    assert.deepEqual(
      servers,
      [],
      "Pi receives tools via the bundled extension, not MCP",
    );
  });

  it("a non-MCP harness gets [] (capability gate), no internal server started", async () => {
    const { servers } = await build({
      isPi: false,
      isDaytona: false,
      capabilities: { mcpTools: false, toolCalls: false },
      harness: "no-mcp",
      toolSpecs: [gatewayTool],
      relayDir,
    });
    assert.deepEqual(servers, []);
  });

  it("the internal channel advertisement carries no credential (server-side invariant)", async () => {
    const { servers } = await build({
      isPi: false,
      isDaytona: false,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      relayDir,
    });
    const internal = servers.find((s) => s.name === "agenta-tools");
    assert.ok(internal);
    assert.deepEqual(
      (internal as { headers: unknown }).headers,
      [],
      "no auth header on the internal channel",
    );
    assert.ok(
      !JSON.stringify(internal).includes("composio.search"),
      "the private callRef never reaches the advertisement",
    );
  });

  it("(Daytona) gateway tools -> NO internal loopback advertisement (file relay delivers them)", async () => {
    // On Daytona the harness runs IN the sandbox, so the runner-loopback URL (127.0.0.1) is
    // unreachable. The internal channel must NOT be advertised; the file relay (already running
    // on Daytona) delivers the tools instead. Asserting the loopback URL is absent is the
    // Finding-1 regression guard.
    const { servers } = await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      relayDir,
    });
    assert.equal(
      servers.find((s) => s.name === "agenta-tools"),
      undefined,
      "no internal agenta-tools server is advertised on Daytona",
    );
    assert.ok(
      !JSON.stringify(servers).includes("127.0.0.1"),
      "the Daytona session never carries an unreachable loopback MCP url",
    );
  });

  it("(Daytona, non-Pi, relayShimPath) gateway tools -> stdio MCP relay shim, no loopback (F-042)", async () => {
    // The F-042 fix: a non-Pi harness on Daytona gets the internal channel as a STDIO MCP server
    // (the uploaded relay-mcp-stdio.js shim), since the loopback HTTP URL is unreachable in the
    // sandbox. The entry carries the public specs + relay dir in env, NO credential, NO loopback.
    const shimPath =
      "/home/sandbox/agenta-abc/.agenta-tools/relay-mcp-stdio.js";
    const { servers } = await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      relayDir,
      relayShimPath: shimPath,
    });
    const internal = servers.find((s) => s.name === "agenta-tools");
    assert.ok(internal, "the internal channel is advertised as a stdio server");
    assert.ok(
      !("type" in internal),
      "a stdio MCP entry has no `type` field (so Claude's ACP adapter maps it to a stdio server)",
    );
    const stdio = internal as {
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    };
    assert.equal(stdio.command, "node");
    assert.deepEqual(stdio.args, [shimPath]);
    const envNames = stdio.env.map((e) => e.name).sort();
    assert.deepEqual(envNames, [
      "AGENTA_TOOL_PUBLIC_SPECS",
      "AGENTA_TOOL_RELAY_DIR",
    ]);
    assert.ok(
      !JSON.stringify(internal).includes("composio.search"),
      "the private callRef never reaches the stdio advertisement",
    );
    assert.ok(
      !JSON.stringify(servers).includes("127.0.0.1"),
      "no unreachable loopback url on the Daytona session",
    );
  });

  it("(Daytona, non-Pi, NO relayShimPath) gateway tools -> no channel (shim upload failed)", async () => {
    // Without an uploaded shim path the channel cannot be advertised (fall back to no channel,
    // the pre-F-042 behavior). The capability gate + fail-loud in the engine still apply upstream.
    const { servers } = await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      relayDir,
      relayShimPath: undefined,
    });
    assert.deepEqual(servers, [], "no internal channel without a shim path");
  });

  it("(Daytona, Pi, relayShimPath) still gets [] (Pi delivers via its extension, never the shim)", async () => {
    const { servers } = await build({
      isPi: true,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "pi_agenta",
      toolSpecs: [gatewayTool],
      relayDir,
      relayShimPath: "/home/sandbox/x/relay-mcp-stdio.js",
    });
    assert.deepEqual(servers, [], "Pi never uses the stdio shim");
  });

  it("(Daytona, non-Pi, relayShimPath, only client tools) -> no channel (nothing executable)", async () => {
    const clientTool: ResolvedToolSpec = {
      name: "pick_date",
      kind: "client",
      description: "browser-fulfilled",
    };
    const { servers } = await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [clientTool],
      relayDir,
      relayShimPath: "/home/sandbox/x/relay-mcp-stdio.js",
    });
    assert.deepEqual(
      servers,
      [],
      "a client-only spec list advertises no stdio channel",
    );
  });

  it("(Daytona) a user http MCP is STILL delivered (remote url, not a runner loopback)", async () => {
    // The Daytona guard is scoped to the INTERNAL loopback channel only. A user http MCP is a
    // remote url the harness dials directly, so it stays reachable from the sandbox and must be
    // delivered on Daytona unchanged.
    const { servers } = await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      userMcpServers: [
        {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/sse",
          env: { Authorization: "Bearer x" },
        },
      ],
      relayDir,
    });
    assert.deepEqual(
      servers.map((s) => s.name),
      ["linear"],
      "only the user http server is delivered on Daytona (no internal loopback)",
    );
  });
});
