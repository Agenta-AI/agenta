/**
 * Claude's connection environment has to reach the DAYTONA daemon, not only the local one.
 *
 * `applyClaudeConnectionEnv` sets `ENABLE_TOOL_SEARCH=false`, `MCP_PROTOCOL_NEGOTIATION` and the
 * gateway routing variables. A Daytona sandbox's daemon environment is built from `piExtEnv` plus
 * the model environment, and the local daemon's `env` is not one of its inputs. Written only to
 * `env`, these values never reach Claude Code in the sandbox, which then defers the Agenta tools
 * behind ToolSearch (issue #7144).
 *
 * Like `gateway-credential-daytona-env.test.ts`, this builds the environment and then builds the
 * Daytona daemon environment from it through the function the provider calls.
 *
 * Run: pnpm exec vitest run tests/unit/claude-connection-daytona-env.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import type { RunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRuntimeEnvironment } from "../../src/environment/runtime-lifecycle.ts";

/** Not a key shape: a real-looking one trips the repository's secret scanner. */
const CREDENTIAL = "the gateway credential under test";

const log = (() => {}) as never;

const claudePlan = (isDaytona: boolean): RunPlan =>
  ({
    acpAgent: "claude",
    isPi: false,
    isDaytona,
    sandboxId: isDaytona ? "daytona" : "local",
    workspace: {
      cwd: "/workspace",
      relayDir: "/tmp/relay",
      telemetryDir: "/tmp/telemetry",
      toolMcpDir: "/tmp/toolmcp",
      skillDirs: [],
      skillsDropped: [],
      skillsCleanup: () => {},
      sourcePiAgentDir: "/tmp/pi",
    },
    tools: { builtinGatingActive: false, toolSpecs: undefined },
    credentials: {
      modelEnvironment: {},
      sandboxEnvironment: {},
      harnessApiKeyVar: "ANTHROPIC_API_KEY",
      hasApiKey: false,
      credentialMode: "env",
    },
  }) as unknown as RunPlan;

const gatewayRequest = (): AgentRunRequest =>
  ({
    modelConnection: {
      provider: "anthropic",
      endpoint: { baseUrl: "https://gateway.example/anthropic" },
      gatewayCredentials: {
        header: "x-agenta-gateway-credentials",
        value: CREDENTIAL,
      },
    },
  }) as unknown as AgentRunRequest;

const buildDaemonEnv = (() => ({})) as never;

const build = (isDaytona: boolean, request: AgentRunRequest) => {
  const plan = claudePlan(isDaytona);
  const runtime = buildRuntimeEnvironment({
    plan,
    request,
    piSkillSnapshot: undefined,
    log,
    deps: { buildDaemonEnv },
  });
  return { plan, runtime };
};

describe("Claude's connection environment on a Daytona run", () => {
  it("disables ToolSearch in the Daytona daemon environment", () => {
    const { plan, runtime } = build(true, {} as AgentRunRequest);
    const daemonEnv = daytonaEnvVars(runtime.piExtEnv, plan.credentials.modelEnvironment);

    assert.equal(daemonEnv.ENABLE_TOOL_SEARCH, "false");
    assert.equal(daemonEnv.MCP_PROTOCOL_NEGOTIATION, "auto");
  });

  it("carries the gateway routing to the Daytona daemon environment", () => {
    const { plan, runtime } = build(true, gatewayRequest());
    const daemonEnv = daytonaEnvVars(runtime.piExtEnv, plan.credentials.modelEnvironment);

    assert.equal(daemonEnv.ANTHROPIC_BASE_URL, "https://gateway.example/anthropic");
    assert.ok(daemonEnv.ANTHROPIC_CUSTOM_HEADERS?.includes(CREDENTIAL));
  });

  it("still reaches the local daemon", () => {
    const { runtime } = build(false, gatewayRequest());

    assert.equal(runtime.env.ENABLE_TOOL_SEARCH, "false");
    assert.equal(runtime.env.ANTHROPIC_BASE_URL, "https://gateway.example/anthropic");
  });
});
