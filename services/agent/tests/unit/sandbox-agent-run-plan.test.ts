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
        prompt: " ship it ",
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
    assert.equal(result.plan.useToolRelay, true);
    assert.deepEqual(result.plan.skillDirs, [
      { name: "alpha", dir: "/skills/alpha" },
    ]);
    assert.deepEqual(logs, ["resolved alpha", "skills: alpha"]);
  });

  it("carries the sandbox permission onto the plan and leaves an unrestricted run alone", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
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
      { harness: "claude", sandbox: "daytona", prompt: "hello" },
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.sandboxPermission, undefined);
  });

  it("rejects a strict restricted-network run on the local sandbox", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        prompt: "hello",
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /local sandbox cannot enforce network:off/);
  });

  it("allows a best_effort restricted-network run on the local sandbox", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "local",
        prompt: "hello",
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "best_effort",
        },
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
  });

  it("rejects a strict restricted-network Daytona run with a runner-host tool", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
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

  it("rejects a strict restricted-network Daytona run with a stdio MCP server", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
        mcpServers: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /stdio MCP servers run on the runner host/);
  });

  it("allows a strict restricted-network Daytona run with only a remote MCP server", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
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
        harness: "claude",
        sandbox: "daytona",
        prompt: "hello",
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
        prompt: "hello",
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
        prompt: "hello",
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
      { harness: "claude", sandbox: "daytona", prompt: "hello" },
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
        prompt: "hello",
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
