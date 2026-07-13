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
  RESERVED_MCP_SERVER_NAME_MESSAGE,
  type McpServerStdio,
  type SessionMcpServers,
} from "../../src/engines/sandbox_agent/mcp.ts";
import type { ToolMcpAssets } from "../../src/engines/sandbox_agent/tool-mcp-assets.ts";
import { USER_MCP_UNSUPPORTED_MESSAGE } from "../../src/tools/mcp-bridge.ts";
import type {
  HarnessCapabilities,
  McpServerConfig,
  ResolvedToolSpec,
} from "../../src/protocol.ts";

const credential = (name: string, value: string) => ({
  binding: { kind: "header" as const, name },
  value,
  usage: "opaque_http" as const,
});

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
          credentials: [credential("Authorization", "Bearer x")],
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

  it("the internal channel advertises only a loopback guard, never a provider credential", async () => {
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
    // WP1 (#5201): the loopback HTTP endpoint now carries a per-session bearer so another local
    // process cannot list or call tools through it. That token is a locally minted access guard,
    // NOT a provider/control-plane credential — the private callRef still never reaches the
    // advertisement (asserted below), which is the invariant that actually matters here.
    const headers = (internal as { headers: Array<{ name: string; value: string }> })
      .headers;
    assert.equal(headers.length, 1, "exactly the loopback guard header");
    assert.equal(headers[0].name, "Authorization");
    assert.match(headers[0].value, /^Bearer .+/, "a non-empty loopback guard token");
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

  it("(Daytona, non-Pi) never logs the file-relay delivery claim (F1: it would be false)", async () => {
    // F1: a non-Pi harness has no sandbox-side file-relay writer (only Pi's bundled extension has
    // one), so claiming "delivered via the file relay" here would be false. `run-plan.ts` now
    // refuses this combination before a session is built, but this pins the log itself as a
    // defense-in-depth: it must never make that claim for a non-Pi harness.
    const logs: string[] = [];
    await build({
      isPi: false,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "claude",
      toolSpecs: [gatewayTool],
      relayDir,
      log: (message) => logs.push(message),
    });
    assert.ok(
      !logs.some((line) => line.includes("delivered via the file relay")),
      "must not claim file-relay delivery for a harness with no relay writer",
    );
  });

  it("(Daytona, non-Pi, internalToolMcp) one run: user stdio refused, user http delivered, internal stdio entry present", async () => {
    // The slice-1 layering pin, all three layers on ONE Daytona run: the uploaded in-sandbox
    // shim becomes the internal TYPELESS stdio entry; a user http MCP rides along unchanged;
    // a user stdio MCP is still refused. The internal entry carries ONLY the two env names —
    // no credential, no callRef, no loopback URL. The response-watch flag is cleared for the
    // duration (buildInternalToolMcpEntry forwards it verbatim when the runner env sets it,
    // which would add a third env entry; the with-flag shape has its own test below).
    const savedResponseWatch =
      process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
    delete process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
    const internalToolMcp: ToolMcpAssets = {
      bundlePath: "/home/sandbox/agenta/tool-mcp/agenta-abc/tool-mcp-stdio.js",
      specsPath: "/home/sandbox/agenta/tool-mcp/agenta-abc/tool-mcp-specs.json",
    };
    try {
      // Deliberately auth-free: this pin is about WHICH servers are delivered on the
      // three-layer Daytona shape; user-MCP auth delivery has its own tests and its wire
      // shape is owned by another seam.
      const userHttp: McpServerConfig = {
        name: "linear",
        transport: "http",
        url: "https://mcp.linear.app/sse",
      };
      const { servers } = await build({
        isPi: false,
        isDaytona: true,
        capabilities: mcpCapable,
        harness: "claude",
        toolSpecs: [gatewayTool],
        userMcpServers: [userHttp],
        relayDir,
        internalToolMcp,
      });
      assert.deepEqual(
        servers.map((s) => s.name).sort(),
        ["agenta-tools", "linear"],
        "internal stdio channel AND the user http server",
      );

      const internal = servers.find((s) => s.name === "agenta-tools");
      assert.ok(internal, "the internal channel is advertised");
      assert.ok(
        !("type" in internal!),
        "the internal stdio entry is TYPELESS (the ACP adapter maps typeless -> stdio)",
      );
      const stdio = internal as McpServerStdio;
      assert.equal(stdio.command, "node");
      assert.deepEqual(stdio.args, [internalToolMcp.bundlePath]);
      assert.deepEqual(
        stdio.env.map((e) => e.name).sort(),
        [
          "AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE",
          "AGENTA_AGENT_TOOLS_RELAY_DIR",
        ],
        "ONLY the specs-file path and the relay dir ride the env",
      );
      assert.equal(
        stdio.env.find((e) => e.name === "AGENTA_AGENT_TOOLS_RELAY_DIR")?.value,
        relayDir,
      );
      const serialized = JSON.stringify(internal);
      assert.ok(!serialized.includes("composio.search"), "no private callRef");
      assert.ok(
        !serialized.includes("mcp.linear.app"),
        "no user MCP url leaks into the internal entry",
      );
      assert.ok(!serialized.includes("127.0.0.1"), "no loopback URL");

      // The user stdio path is still refused on the same Daytona + internalToolMcp shape.
      await assert.rejects(
        () =>
          buildSessionMcpServers({
            isPi: false,
            isDaytona: true,
            capabilities: mcpCapable,
            harness: "claude",
            toolSpecs: [gatewayTool],
            userMcpServers: [
              { name: "evil", transport: "stdio", command: "rm" },
            ],
            relayDir,
            internalToolMcp,
          }),
        new RegExp(USER_MCP_UNSUPPORTED_MESSAGE),
      );
    } finally {
      if (savedResponseWatch === undefined) {
        delete process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
      } else {
        process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED =
          savedResponseWatch;
      }
    }
  });

  it("(Daytona, non-Pi, internalToolMcp) the runner's response-watch flag is forwarded verbatim as a THIRD env entry", async () => {
    // Companion to the exact-two-names pin above: when the operator set the hop-1
    // response-watch kill switch on the RUNNER, buildInternalToolMcpEntry forwards it —
    // verbatim — to the in-sandbox shim (mirroring buildPiExtensionEnv).
    const savedResponseWatch =
      process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
    process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED = "false";
    try {
      const { servers } = await build({
        isPi: false,
        isDaytona: true,
        capabilities: mcpCapable,
        harness: "claude",
        toolSpecs: [gatewayTool],
        relayDir,
        internalToolMcp: {
          bundlePath: "/home/sandbox/x/tool-mcp-stdio.js",
          specsPath: "/home/sandbox/x/tool-mcp-specs.json",
        },
      });
      const stdio = servers.find(
        (s) => s.name === "agenta-tools",
      ) as McpServerStdio;
      assert.ok(stdio, "the internal channel is advertised");
      assert.deepEqual(
        stdio.env.map((e) => e.name).sort(),
        [
          "AGENTA_AGENT_TOOLS_PUBLIC_SPECS_FILE",
          "AGENTA_AGENT_TOOLS_RELAY_DIR",
          "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
        ],
        "the flag rides as the third env entry",
      );
      assert.deepEqual(
        stdio.env.find(
          (e) => e.name === "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
        ),
        {
          name: "AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED",
          value: "false",
        },
        "forwarded verbatim",
      );
    } finally {
      if (savedResponseWatch === undefined) {
        delete process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED;
      } else {
        process.env.AGENTA_AGENT_TOOLS_RELAY_RESPONSE_WATCH_ENABLED =
          savedResponseWatch;
      }
    }
  });

  it("(Daytona, Pi, internalToolMcp) still gets [] (Pi delivers via its extension, never the shim)", async () => {
    const { servers } = await build({
      isPi: true,
      isDaytona: true,
      capabilities: mcpCapable,
      harness: "pi_agenta",
      toolSpecs: [gatewayTool],
      relayDir,
      internalToolMcp: {
        bundlePath: "/home/sandbox/x/tool-mcp-stdio.js",
        specsPath: "/home/sandbox/x/tool-mcp-specs.json",
      },
    });
    assert.deepEqual(servers, [], "Pi never uses the stdio shim");
  });

  it("(Daytona, non-Pi, internalToolMcp, only client tools) -> no internal entry (nothing executable)", async () => {
    const clientTool: ResolvedToolSpec = {
      name: "request_connection",
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
      internalToolMcp: {
        bundlePath: "/home/sandbox/x/tool-mcp-stdio.js",
        specsPath: "/home/sandbox/x/tool-mcp-specs.json",
      },
    });
    assert.deepEqual(
      servers,
      [],
      "a client-only spec list advertises no stdio channel",
    );
  });

  it("a user-declared MCP server named 'agenta-tools' is rejected (reserved name)", async () => {
    // The internal channel's name is coupled to the rendered permission rules
    // (claude_settings.py renders `mcp__agenta-tools__<tool>`), so a user server must never
    // claim it — on any sandbox, any transport.
    await assert.rejects(
      () =>
        buildSessionMcpServers({
          isPi: false,
          isDaytona: false,
          capabilities: mcpCapable,
          harness: "claude",
          toolSpecs: [],
          userMcpServers: [
            {
              name: "agenta-tools",
              transport: "http",
              url: "https://mcp.example.com/mcp",
            },
          ],
          relayDir,
        }),
      new RegExp(RESERVED_MCP_SERVER_NAME_MESSAGE.slice(0, 40)),
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
          credentials: [credential("Authorization", "Bearer x")],
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
