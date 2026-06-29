/**
 * Unit tests for E2B-specific run-plan normalization.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-e2b-run-plan.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildRunPlan,
  E2B_NETWORK_UNSUPPORTED_MESSAGE,
} from "../../src/engines/sandbox_agent/run-plan.ts";

describe("buildRunPlan — E2B sandbox", () => {
  it("sets isE2b and uses the E2B cwd factory", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.isE2b, true);
    assert.equal(result.plan.isDaytona, false);
    assert.equal(result.plan.sandboxId, "e2b");
    assert.equal(result.plan.cwd, "/root/work/agenta-abc123");
    assert.equal(result.plan.relayDir, "/root/work/agenta-abc123/.agenta-tools");
  });

  it("local runs have isE2b=false", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "local",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/local-cwd" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.isE2b, false);
  });

  it("daytona runs have isE2b=false", () => {
    const result = buildRunPlan(
      {
        harness: "claude",
        sandbox: "daytona",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      { createDaytonaCwd: () => "/home/sandbox/agenta-fixed" },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.isE2b, false);
    assert.equal(result.plan.isDaytona, true);
  });

  it("refuses a restricted-network E2B run under strict (no egress control)", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "off" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not enforceable on the e2b sandbox/);
  });

  it("refuses a restricted-network E2B run even under best_effort (no silent unenforced boundary)", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "allowlist", allowlist: ["10.0.0.0/8"] },
          enforcement: "best_effort",
        },
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not enforceable on the e2b sandbox/);
  });

  it("the E2B refusal message is the E2B_NETWORK_UNSUPPORTED_MESSAGE constant", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: { network: { mode: "off" }, enforcement: "strict" },
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, E2B_NETWORK_UNSUPPORTED_MESSAGE);
  });

  it("allows an unrestricted (network: on) E2B run", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
        sandboxPermission: {
          network: { mode: "on" },
          enforcement: "strict",
        },
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, true);
  });

  it("allows an E2B run with no sandbox permission", () => {
    const result = buildRunPlan(
      {
        harness: "pi_core",
        sandbox: "e2b",
        messages: [{ role: "user", content: "hello" }],
      } as AgentRunRequest,
      { createE2bCwd: () => "/root/work/agenta-abc123" },
    );

    assert.equal(result.ok, true);
  });
});
