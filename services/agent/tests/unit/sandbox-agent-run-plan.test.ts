/**
 * Unit tests for sandbox-agent run plan normalization.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-run-plan.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";

const previousPiDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiDir;
});

describe("buildRunPlan", () => {
  it("returns the current no-prompt error without creating a cwd", () => {
    let created = false;

    const result = buildRunPlan({}, { createLocalCwd: () => {
      created = true;
      return "/tmp/unused";
    } });

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
        harness: "agenta",
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
    assert.equal(result.plan.harness, "agenta");
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

  it("warns when it drops skills for a non-Pi harness (no silent drop)", () => {
    // The skills-config "per-harness mapping" requires a VISIBLE log-and-drop when a harness
    // whose runtime cannot load SKILL.md (the Claude SDK path) is handed skills. Here the wire
    // still carries skills for a non-Pi harness; the plan must drop them AND warn (count +
    // harness), never silently.
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
        resolveSkillDirs: () => {
          throw new Error("non-Pi should not resolve skills");
        },
        log: (message) => logs.push(message),
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // The skills are dropped (the runtime never materializes them)...
    assert.deepEqual(result.plan.skillDirs, []);
    // ...and the drop is visible, naming the count and the harness.
    const warning = logs.find((line) => line.startsWith("WARNING: dropping"));
    assert.ok(warning, "expected a visible warning when skills are dropped");
    assert.match(warning, /dropping 2 skill\(s\)/);
    assert.match(warning, /harness "claude"/);
  });

  it("stays quiet for a non-Pi harness with no skills to drop", () => {
    // No skills on the wire: a non-Pi run must NOT emit a spurious drop warning.
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
        systemPrompt: "ignored for non-pi",
      },
      {
        createDaytonaCwd: () => "/home/sandbox/agenta-fixed",
        resolveSkillDirs: () => {
          throw new Error("non-Pi should not resolve skills");
        },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.acpAgent, "claude");
    assert.equal(result.plan.isPi, false);
    assert.equal(result.plan.isDaytona, true);
    assert.equal(result.plan.cwd, "/home/sandbox/agenta-fixed");
    assert.equal(result.plan.usageOutPath, undefined);
    assert.equal(result.plan.harnessKeyVar, "ANTHROPIC_API_KEY");
    assert.equal(result.plan.hasApiKey, true);
    assert.equal(result.plan.systemPrompt, undefined);
    assert.equal(result.plan.hasSystemPrompt, false);
    assert.deepEqual(result.plan.skillDirs, []);
  });
});
