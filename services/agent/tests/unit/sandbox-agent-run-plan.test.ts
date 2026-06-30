/**
 * Unit tests for sandbox-agent run plan normalization.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-run-plan.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildRunPlan,
  shouldUploadOwnLogin,
} from "../../src/engines/sandbox_agent/run-plan.ts";

const previousPiDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiDir;
});

describe("buildRunPlan", () => {
  it("returns the current no-prompt error without creating a cwd", () => {
    let created = false;

    const result = buildRunPlan(
      {},
      {
        createLocalCwd: () => {
          created = true;
          return "/tmp/unused";
        },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      error: "No user message to send (prompt/messages empty).",
    });
    assert.equal(created, false);
  });

  it("normalizes an Agenta/Pi local run and filters executable tools", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-agent";
    const logs: string[] = [];
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        messages: [{ role: "user", content: " ship it " }],
        agentsMd: " instructions ",
        systemPrompt: " system ",
        appendSystemPrompt: " append ",
        customTools: [
          { name: "server_tool", kind: "callback" },
          { name: "client_tool", kind: "client" },
        ],
        skills: [
          { name: "alpha", description: "Alpha skill.", body: "Do alpha." },
        ],
        secrets: { OPENAI_API_KEY: "key" },
      } as AgentRunRequest,
      {
        createLocalCwd: () => "/tmp/local-cwd",
        resolveSkillDirs: (_skills, log) => {
          (log ?? (() => {}))("resolved alpha");
          return {
            skills: [{ name: "alpha", dir: "/skills/alpha" }],
            cleanup: () => {},
          };
        },
        log: (message) => logs.push(message),
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.harness, "pi_agenta");
    assert.equal(result.plan.acpAgent, "pi");
    assert.equal(result.plan.sandboxId, "local");
    assert.equal(result.plan.cwd, "/tmp/local-cwd");
    assert.equal(result.plan.relayDir, "/tmp/local-cwd/.agenta-tools");
    assert.equal(result.plan.usageOutPath, "/tmp/local-cwd/.agenta-usage.json");
    assert.equal(result.plan.prompt, " ship it ");
    assert.equal(result.plan.agentsMd, "instructions");
    assert.equal(result.plan.systemPrompt, "system");
    assert.equal(result.plan.appendSystemPrompt, "append");
    assert.equal(result.plan.hasSystemPrompt, true);
    assert.equal(result.plan.hasApiKey, true);
    assert.equal(result.plan.sourcePiAgentDir, "/tmp/pi-agent");
    assert.deepEqual(
      result.plan.executableToolSpecs.map((tool) => tool.name),
      ["server_tool"],
    );
    assert.deepEqual(
      result.plan.toolSpecs.map((tool) => tool.name),
      ["server_tool", "client_tool"],
    );
    assert.equal(result.plan.useToolRelay, true);
    assert.deepEqual(result.plan.skillDirs, [
      { name: "alpha", dir: "/skills/alpha" },
    ]);
    assert.deepEqual(logs, ["resolved alpha", "skills: alpha"]);
  });

  it("keeps the relay enabled for client-only Pi tools", () => {
    const result = buildRunPlan({
      harness: "pi_agenta",
      messages: [{ role: "user", content: "connect slack" }],
      customTools: [{ name: "request_connection", kind: "client" }],
    } as AgentRunRequest);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.executableToolSpecs, []);
    assert.equal(result.plan.useToolRelay, true);
  });

  it("carries the sandbox permission onto the plan and leaves an unrestricted run alone", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "on", allowlist: [] },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.sandboxPermission, {
      network: { mode: "on", allowlist: [] },
      enforcement: "strict",
    });
  });

  it("treats an absent sandbox permission as unrestricted", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
      },
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.sandboxPermission, undefined);
  });

  it("errors on a restricted-network run on the local sandbox under strict", () => {
    // Not enforceable on the local sidecar, so it errors the not-implemented way regardless of
    // enforcement (mirrors the code-tool gate).
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not enforceable on the local sandbox/);
  });

  it("errors on a restricted-network run on the local sandbox even under best_effort", () => {
    // best_effort is no longer the escape hatch: the local sandbox genuinely cannot enforce
    // egress, so a set network policy always errors there.
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "best_effort",
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not enforceable on the local sandbox/);
  });

  it("allows an unrestricted (network: on) run on the local sandbox", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "on" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
  });

  it("errors when filesystem is specified (not implemented on any backend)", () => {
    // Declared on the wire but applied by no backend, so specifying it errors everywhere — even
    // on Daytona, even under best_effort.
    for (const enforcement of ["strict", "best_effort"] as const) {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          sandboxPermission: { filesystem: "readonly", enforcement },
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(
        result.error,
        /Filesystem sandbox policy is not implemented/,
      );
    }
  });

  it("rejects a strict restricted-network Daytona run with a runner-host tool", () => {
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
        sandboxPermission: {
          network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /run on the runner host and would bypass/);
    assert.match(result.error, /network:allowlist/);
  });

  it("treats an OMITTED enforcement as strict (LOW-6: wire-schema default is strict)", () => {
    // The Python service always fills enforcement="strict", but a DIRECT runner caller may omit
    // it. The wire schema defaults it to "strict", so an omitted value must rebuff a runner-host
    // tool on a restricted-network Daytona run the same as an explicit "strict" — only an
    // explicit "best_effort" opts out.
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
        sandboxPermission: {
          network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] },
          // enforcement omitted on purpose
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /run on the runner host and would bypass/);
  });

  it("lets best_effort opt out of the runner-host-tool guard (LOW-6 contrast)", () => {
    // The explicit opt-out: best_effort accepts that the network boundary is not a hard
    // guarantee, so the same restricted-network Daytona run with a host tool is allowed.
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
        sandboxPermission: {
          network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] },
          enforcement: "best_effort",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
  });

  it("errors on any run carrying a stdio MCP server (MCP disabled)", () => {
    // The stdio MCP implementation is disabled in the sidecar; a stdio server errors the
    // not-implemented way regardless of sandbox/enforcement, even with no network policy.
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /MCP servers are not supported by the sidecar/);
  });

  it("errors on a stdio MCP server on the local sandbox too (non-Pi harness)", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /MCP servers are not supported by the sidecar/);
  });

  it("errors LOUD on a Pi run carrying a user STDIO MCP server (F-032, Pi-specific)", () => {
    // Pi delivers tools through its bundled extension, not MCP, so a user MCP server would be
    // dropped silently (the F-032 bug). The Pi gate refuses it up front with a Pi-specific
    // message (precedes the harness-agnostic stdio gate).
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not supported on the Pi harness/);
  });

  it("errors LOUD on a Pi run carrying a user HTTP MCP server (F-032 silent-drop fix)", () => {
    // The core of F-032: an http user MCP on Pi previously passed the stdio gate, then
    // buildSessionMcpServers returned [] for Pi -> the server was dropped with NO log and an
    // HTTP 200. It must now fail loud, not silently succeed. Fails before any cwd is created.
    let created = false;
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [
          {
            name: "linear",
            transport: "http",
            url: "https://mcp.linear.app/sse",
          },
        ],
      } as AgentRunRequest,
      {
        createDaytonaCwd: () => {
          created = true;
          return "/home/sandbox/agenta-fixed";
        },
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not supported on the Pi harness/);
    assert.equal(
      created,
      false,
      "fails before any cwd is created (up-front gate)",
    );
  });

  it("allows a non-Pi (claude) run with a user HTTP MCP server (Pi gate is Pi-only)", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [
          {
            name: "linear",
            transport: "http",
            url: "https://mcp.linear.app/sse",
          },
        ],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
  });

  it("errors on any run carrying a code tool (code execution removed, fail loud)", () => {
    // Code tools were removed for security (F-010). The run is refused up-front so the failure
    // surfaces as a non-success result (ok:false) rather than being laundered into a 200 reply
    // (F-016: a per-call throw becomes a tool result the model echoes back as "success").
    let created = false;
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "local",
        messages: [{ role: "user", content: "compute it" }],
        customTools: [
          {
            name: "secret_math",
            kind: "code",
            runtime: "python",
            code: "def main(x=0):\n    return x * 7 + 1\n",
          },
        ],
      } as AgentRunRequest,
      {
        createLocalCwd: () => {
          created = true;
          return "/tmp/local-cwd";
        },
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Code tools are not supported by the sidecar\./);
    // Fails before any cwd is created (parity with the other up-front gates).
    assert.equal(created, false);
  });

  it("errors LOUD on a non-Pi (claude) Daytona run carrying ANY custom tool (silent-drop fix)", () => {
    // On Daytona the loopback MCP channel is skipped and a non-Pi harness has no in-sandbox tool
    // reader, so the tools would vanish silently (the capability gate passes). Fail up front.
    let created = false;
    for (const tool of [
      { name: "search", kind: "callback", callRef: "x" },
      { name: "request_connection", kind: "client" },
    ] as const) {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "use the tool" }],
          customTools: [tool],
        } as AgentRunRequest,
        {
          createDaytonaCwd: () => {
            created = true;
            return "/home/sandbox/x";
          },
        },
      );
      assert.equal(result.ok, false, `tool kind=${tool.kind} must fail`);
      if (result.ok) return;
      assert.match(result.error, /not deliverable to this harness on daytona/);
    }
    assert.equal(created, false, "fails before any cwd is created");
  });

  it("allows a Pi Daytona run with tools (Pi consumes the file relay in-sandbox)", () => {
    const result = buildRunPlan({
      harness: "pi_agenta",
      sandbox: "daytona",
      messages: [{ role: "user", content: "use the tool" }],
      customTools: [{ name: "request_connection", kind: "client" }],
    } as AgentRunRequest);
    assert.equal(result.ok, true, "Pi on daytona keeps tools (no guard)");
  });

  it("allows a non-Pi (claude) Daytona run with NO custom tools", () => {
    const result = buildRunPlan({
      harness: "claude",
      sandbox: "daytona",
      messages: [{ role: "user", content: "just chat" }],
    } as AgentRunRequest);
    assert.equal(result.ok, true, "no tools -> the guard does not fire");
  });

  it("allows a run with a non-code (callback) tool", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "local",
        messages: [{ role: "user", content: "do it" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
  });

  it("allows a strict restricted-network Daytona run with only a remote MCP server", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [
          { name: "remote", transport: "http", url: "https://mcp.example" },
        ],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
  });

  it("allows a best_effort restricted-network Daytona run with a runner-host tool", () => {
    const result = buildRunPlan(
      {
        harness: "pi_agenta",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        customTools: [{ name: "server_tool", kind: "callback" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "best_effort",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
  });

  it("allows a strict Daytona run with a clean network boundary (no host tools)", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
  });

  it("materializes skills for Claude so workspace preparation can write .claude/skills", () => {
    const logs: string[] = [];
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        skills: [
          { name: "alpha", description: "Alpha skill.", body: "Do alpha." },
          { name: "beta", description: "Beta skill.", body: "Do beta." },
        ],
      } as AgentRunRequest,
      {
        createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
        resolveSkillDirs: (_skills, log) => {
          (log ?? (() => {}))("resolved claude skills");
          return {
            skills: [
              { name: "alpha", dir: "/skills/alpha" },
              { name: "beta", dir: "/skills/beta" },
            ],
            cleanup: () => {},
          };
        },
        log: (message) => logs.push(message),
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.skillDirs, [
      { name: "alpha", dir: "/skills/alpha" },
      { name: "beta", dir: "/skills/beta" },
    ]);
    assert.deepEqual(logs, ["resolved claude skills", "skills: alpha, beta"]);
  });

  it("stays quiet for a Claude harness with no skills", () => {
    // No skills on the wire: materialization is a no-op and must not warn.
    const logs: string[] = [];
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
      },
      {
        createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
        log: (message) => logs.push(message),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(
      logs.some((line) => line.startsWith("WARNING: dropping")),
      false,
    );
  });

  it("normalizes a Daytona Claude run without Pi-only state", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
        secrets: { ANTHROPIC_API_KEY: "anthropic" },
        credentialMode: "env",
        systemPrompt: "ignored for non-pi",
      },
      {
        createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.acpAgent, "claude");
    assert.equal(result.plan.isPi, false);
    assert.equal(result.plan.isDaytona, true);
    assert.equal(result.plan.cwd, "/home/sandbox/agenta-fixed");
    assert.equal(result.plan.usageOutPath, undefined);
    assert.equal(result.plan.legacyHarnessApiKeyVar, "ANTHROPIC_API_KEY");
    assert.equal(result.plan.hasApiKey, true);
    // The resolved credentialMode is carried onto the plan (drives clear-then-apply + the
    // OAuth-upload gate).
    assert.equal(result.plan.credentialMode, "env");
    assert.equal(result.plan.systemPrompt, undefined);
    assert.equal(result.plan.hasSystemPrompt, false);
    assert.deepEqual(result.plan.skillDirs, []);
  });
});

describe("shouldUploadOwnLogin", () => {
  it("never uploads when the connection resolved a real key (credentialMode 'env')", () => {
    // A resolved key is the credential (Security rule 6); the fallback auth.json must not load,
    // even if hasApiKey somehow disagrees.
    assert.equal(
      shouldUploadOwnLogin({ credentialMode: "env", hasApiKey: true }),
      false,
    );
    assert.equal(
      shouldUploadOwnLogin({ credentialMode: "env", hasApiKey: false }),
      false,
    );
  });

  it("uploads for runtime_provided (the harness authenticates with its own login)", () => {
    assert.equal(
      shouldUploadOwnLogin({
        credentialMode: "runtime_provided",
        hasApiKey: false,
      }),
      true,
    );
    assert.equal(
      shouldUploadOwnLogin({
        credentialMode: "runtime_provided",
        hasApiKey: true,
      }),
      true,
    );
  });

  it("never uploads for credentialMode 'none' (no credential asserted)", () => {
    assert.equal(
      shouldUploadOwnLogin({ credentialMode: "none", hasApiKey: false }),
      false,
    );
  });

  it("falls back to the hasApiKey heuristic for an un-migrated caller (no credentialMode)", () => {
    // No credentialMode on the wire: upload only when no api key was supplied (today's behavior).
    assert.equal(
      shouldUploadOwnLogin({ credentialMode: undefined, hasApiKey: false }),
      true,
    );
    assert.equal(
      shouldUploadOwnLogin({ credentialMode: undefined, hasApiKey: true }),
      false,
    );
  });
});
