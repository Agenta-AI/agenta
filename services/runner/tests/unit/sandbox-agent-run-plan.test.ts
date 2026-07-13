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
import { RESERVED_MCP_SERVER_NAME_MESSAGE } from "../../src/engines/sandbox_agent/mcp.ts";

const previousPiDir = process.env.PI_CODING_AGENT_DIR;
const previousDenyPermissions = process.env.SANDBOX_AGENT_DENY_PERMISSIONS;

afterEach(() => {
  if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiDir;
  if (previousDenyPermissions === undefined)
    delete process.env.SANDBOX_AGENT_DENY_PERMISSIONS;
  else process.env.SANDBOX_AGENT_DENY_PERMISSIONS = previousDenyPermissions;
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
    // The relay dir + usage capture are ephemeral runner files kept OFF the (possibly geesefs)
    // cwd: an ephemeral sibling whose leaf is the cwd basename.
    assert.ok(!result.plan.relayDir.startsWith(result.plan.cwd));
    assert.ok(result.plan.relayDir.endsWith("/agenta/relay/local-cwd"));
    assert.equal(
      result.plan.usageOutPath,
      `${result.plan.relayDir}/.agenta-usage.json`,
    );
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

  it("turns builtin gating on when blanket allow has a reduced grant set", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
        tools: ["read", "write"],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, ["read", "write"]);
    assert.equal(result.plan.builtinGatingActive, true);
    // Builtin gating rides the ACP dialog plane, not the relay: no custom tools, no relay.
    assert.equal(result.plan.useToolRelay, false);
  });

  it("turns builtin gating on when grants include Pi-nondefault builtins", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
        tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
    assert.equal(result.plan.builtinGatingActive, true);
  });

  it("leaves the all-allow default-grants Pi fast path off", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, [
      "read",
      "bash",
      "edit",
      "write",
    ]);
    assert.equal(result.plan.builtinGatingActive, false);
    assert.equal(result.plan.useToolRelay, false);
  });

  it("distinguishes omitted tools from an explicit empty grant set", () => {
    const omitted = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );
    const none = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
        tools: [],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(omitted.ok, true);
    assert.equal(none.ok, true);
    if (!omitted.ok || !none.ok) return;
    assert.deepEqual(omitted.plan.builtinGrants, [
      "read",
      "bash",
      "edit",
      "write",
    ]);
    assert.equal(omitted.plan.builtinGatingActive, false);
    assert.deepEqual(none.plan.builtinGrants, []);
    assert.equal(none.plan.builtinGatingActive, true);
    assert.equal(none.plan.useToolRelay, false);
  });

  it("turns builtin gating on when the permission kill switch is set", () => {
    process.env.SANDBOX_AGENT_DENY_PERMISSIONS = "true";

    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: { default: "allow", rules: [] },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.builtinGrants, [
      "read",
      "bash",
      "edit",
      "write",
    ]);
    assert.equal(result.plan.builtinGatingActive, true);
    assert.equal(result.plan.useToolRelay, false);
  });

  it("turns builtin gating on when an all-allow policy has a builtin rule", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        messages: [{ role: "user", content: "hello" }],
        permissions: {
          default: "allow",
          rules: [{ pattern: "Bash(npm:*)", permission: "allow" }],
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.builtinGatingActive, true);
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
    // Pi (not claude): a non-Pi harness with tools on Daytona is now refused earlier and
    // unconditionally by the F1 remote-tools gate (no delivery path exists at all), which would
    // otherwise mask this network-boundary-bypass gate. Pi tools ride its native extension, so
    // Pi is exempt from the F1 gate and still exercises this Layer-2 network check.
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
    // explicit "best_effort" opts out. Pi (see note above): exempt from the F1 remote-tools gate.
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
    // guarantee, so the same restricted-network Daytona run with a host tool is allowed. Pi (see
    // note above): exempt from the F1 remote-tools gate.
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

  it("refuses a user MCP server that claims the reserved internal name 'agenta-tools'", () => {
    // The internal gateway-tool channel is keyed by name and claude_settings.py renders
    // permission rules against it; a user server with the name would collide/steal them.
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
        mcpServers: [
          {
            name: "agenta-tools",
            connection: { type: "http", url: "https://mcp.example.com/mcp" },
            policy: { tools: { mode: "all" } },
          },
        ],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, RESERVED_MCP_SERVER_NAME_MESSAGE);
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
            connection: { type: "http", url: "https://mcp.linear.app/sse" },
            policy: { tools: { mode: "all" } },
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
            connection: { type: "http", url: "https://mcp.linear.app/sse" },
            policy: { tools: { mode: "all" } },
          },
        ],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
  });

  describe("remote-tools gate (non-Pi harness x remote sandbox x tools)", () => {
    it("allows claude x daytona x executable tools (delivered via the in-sandbox stdio MCP shim)", () => {
      // The in-sandbox-tool-mcp slice 1: executable (gateway/callback) tools are deliverable
      // on Claude+Daytona — the runner uploads the stdio MCP shim into `plan.toolMcpDir` and
      // the calls ride the file relay. The plan must carry the shim dir (an ephemeral SIBLING
      // of the relay dir, never inside it) and still start the relay loop.
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "server_tool", kind: "callback" }],
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(
        result.plan.toolMcpDir,
        "/home/sandbox/agenta/tool-mcp/agenta-fixed",
      );
      assert.notEqual(result.plan.toolMcpDir, result.plan.relayDir);
      assert.ok(
        !result.plan.toolMcpDir.startsWith(`${result.plan.relayDir}/`),
        "the shim dir is never nested inside the relay dir (the relay loop sweeps it)",
      );
      assert.equal(
        result.plan.useToolRelay,
        true,
        "the relay loop still starts (it executes the shim's requests)",
      );
    });

    it("refuses claude x UNKNOWN remote provider x tools (fails closed, not open)", () => {
      // In-sandbox delivery is proven for Daytona only, so a new remote provider (the
      // in-flight E2B one, or anything after it) is refused with the same loud error until
      // delivery is proven there — instead of silently re-opening the F1 zero-tools drop one
      // provider over.
      let created = false;
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "e2b",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "server_tool", kind: "callback" }],
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
      assert.match(result.error, /non-Pi harness on this remote sandbox provider/);
      assert.match(result.error, /proven for Daytona only/);
      assert.match(
        result.error,
        /docs\/design\/agent-workflows\/projects\/in-sandbox-tool-mcp\//,
      );
      assert.equal(
        created,
        false,
        "fails before any cwd is created (up-front gate)",
      );
    });

    it("allows claude x daytona x NO tools", () => {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, true);
    });

    it("allows pi x daytona x tools (the file relay works for Pi)", () => {
      const result = buildRunPlan(
        {
          harness: "pi_agenta",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "server_tool", kind: "callback" }],
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, true);
    });

    it("allows claude x local x tools (the loopback MCP channel is reachable)", () => {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "local",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "server_tool", kind: "callback" }],
        } as AgentRunRequest,
        { createLocalCwd: () => "/tmp/local-cwd" },
      );

      assert.equal(result.ok, true);
    });

    it("allows claude x local x client-only tools (the feature's primary configuration)", () => {
      // Client tools ride the internal loopback MCP channel on local Claude (advertised in
      // tools/list, paused in tools/call), so this combination must pass the gate.
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "local",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "request_connection", kind: "client" }],
        } as AgentRunRequest,
        { createLocalCwd: () => "/tmp/local-cwd" },
      );

      assert.equal(result.ok, true);
    });

    it("allows claude x daytona x mixed tools and keeps only executable shim specs", () => {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [
            { name: "server_tool", kind: "callback" },
            { name: "request_connection", kind: "client" },
          ],
        } as AgentRunRequest,
        {
          createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
        },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(
        result.plan.toolSpecs.map((tool) => tool.name),
        ["server_tool", "request_connection"],
      );
      assert.deepEqual(
        result.plan.executableToolSpecs.map((tool) => tool.name),
        ["server_tool"],
      );
    });

    it("allows claude x daytona x client-only tools with no shim specs", () => {
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "request_connection", kind: "client" }],
        } as AgentRunRequest,
        {
          createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
        },
      );

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.plan.executableToolSpecs, []);
    });

    it("allows pi x daytona x client-only tools (Pi's extension + file relay deliver them)", () => {
      const result = buildRunPlan(
        {
          harness: "pi_agenta",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "request_connection", kind: "client" }],
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, true);
    });

    it("still refuses claude x daytona x executable tools under strict restricted network", () => {
      // The Layer-2 strict-network gate is UNCHANGED by the shim: the shim only advertises;
      // execution still happens on the RUNNER HOST via the relay, outside the sandbox egress
      // boundary, so a strict restricted-network run with executable tools stays refused.
      const result = buildRunPlan(
        {
          harness: "claude",
          sandbox: "daytona",
          messages: [{ role: "user", content: "hello" }],
          customTools: [{ name: "server_tool", kind: "callback" }],
          sandboxPermission: {
            network: { mode: "off" },
            enforcement: "strict",
          },
        } as AgentRunRequest,
        { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
      );

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /bypass the sandbox network boundary/);
    });
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
        // A real code-tool wire payload still carries the SDK's executor fields
        // (runtime/code). The runner no longer declares them on ResolvedToolSpec and ignores
        // them; the double cast represents that extra-property wire reality. The refusal keys
        // on `kind: "code"` alone, so it is unaffected.
        customTools: [
          {
            name: "secret_math",
            kind: "code",
            runtime: "python",
            code: "def main(x=0):\n    return x * 7 + 1\n",
          },
        ],
      } as unknown as AgentRunRequest,
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
          {
            name: "remote",
            connection: { type: "http", url: "https://mcp.example" },
            policy: { tools: { mode: "all" } },
          },
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
    // Pi (not claude): see the note on the "rejects a strict restricted-network..." test above —
    // a non-Pi harness with tools on Daytona is refused unconditionally by the F1 gate before
    // this Layer-2 network check ever runs.
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

describe("buildRunPlan durableCwd (prefix-derived cwd)", () => {
  it("uses durableCwd directly for local, making the cwd deterministic from the prefix", () => {
    // Same prefix -> same cwd -> checkMounted short-circuits -> no re-mount -> no geesefs leak.
    const localCwdCalls: Array<string | undefined> = [];
    const result = buildRunPlan(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      {
        durableCwd: "/tmp/agenta/mounts/proj-1/mount-abc",
        createLocalCwd: (durable) => {
          localCwdCalls.push(durable);
          // mimic the real helper: when durableCwd is set, just return it
          return durable ?? "/tmp/agenta-sandbox-agent-fallback";
        },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.cwd, "/tmp/agenta/mounts/proj-1/mount-abc");
    // Relay dir is an ephemeral sibling (leaf = cwd basename), NOT inside the durable mount.
    assert.ok(!result.plan.relayDir.startsWith(result.plan.cwd));
    assert.ok(result.plan.relayDir.endsWith("/agenta/relay/mount-abc"));
    // createLocalCwd received the durableCwd value.
    assert.deepEqual(localCwdCalls, ["/tmp/agenta/mounts/proj-1/mount-abc"]);
  });

  it("uses durableCwd directly for daytona, same prefix -> same remote cwd", () => {
    const daytonaCwdCalls: Array<string | undefined> = [];
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      {
        durableCwd: "/home/sandbox/agenta/mounts/proj-1/mount-abc",
        createDaytonaCwd: (durable) => {
          daytonaCwdCalls.push(durable);
          return durable ?? `/home/sandbox/agenta-fallback`;
        },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.plan.cwd,
      "/home/sandbox/agenta/mounts/proj-1/mount-abc",
    );
    assert.deepEqual(daytonaCwdCalls, [
      "/home/sandbox/agenta/mounts/proj-1/mount-abc",
    ]);
  });

  it("falls back to ephemeral cwd when durableCwd is absent (non-session / sign failed)", () => {
    // No durableCwd -> createLocalCwd receives undefined -> mkdtempSync ephemeral path.
    const localCwdCalls: Array<string | undefined> = [];
    const result = buildRunPlan(
      {
        harness: "claude",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      {
        // no durableCwd property
        createLocalCwd: (durable) => {
          localCwdCalls.push(durable);
          return "/tmp/agenta-sandbox-agent-ephemeral";
        },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.cwd, "/tmp/agenta-sandbox-agent-ephemeral");
    assert.deepEqual(localCwdCalls, [undefined]);
  });

  it("second turn with same durableCwd gets identical cwd (deterministic, mount reuse)", () => {
    // Two buildRunPlan calls with the same durableCwd -> same cwd.
    // In practice the runner calls mountStorage which calls checkMounted(cwd) -> no re-mount.
    const prefix = "mounts/proj-2/mount-xyz";
    const localPath = `/tmp/agenta/${prefix}`;

    function makePlan() {
      return buildRunPlan(
        {
          harness: "claude",
          messages: [{ role: "user", content: "hi" }],
        } as AgentRunRequest,
        {
          durableCwd: localPath,
          createLocalCwd: (durable) => durable ?? "/tmp/fallback",
        },
      );
    }

    const r1 = makePlan();
    const r2 = makePlan();
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (!r1.ok || !r2.ok) return;
    // Same prefix -> same cwd across turns.
    assert.equal(r1.plan.cwd, r2.plan.cwd);
    assert.equal(r1.plan.cwd, localPath);
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
