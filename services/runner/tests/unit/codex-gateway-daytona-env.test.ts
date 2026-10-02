/**
 * Codex's gateway connection environment has to reach the DAYTONA daemon, not only the local one.
 *
 * On a gateway-routed run the SDK renders a Codex provider with `env_key = "OPENAI_API_KEY"`, and
 * the gateway credential replaces any provider key, so `applyCodexGatewayConnectionEnv` sets a
 * placeholder `OPENAI_API_KEY` for Codex to read. A Daytona sandbox's daemon environment is built
 * from `piExtEnv` plus the model environment, and the local daemon's `env` is not one of its
 * inputs. Written only to `env`, the placeholder never reaches Codex in the sandbox (issue #7148,
 * the Codex counterpart of #7144).
 *
 * Run: pnpm exec vitest run tests/unit/codex-gateway-daytona-env.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import { GATEWAY_PLACEHOLDER_API_KEY } from "../../src/extensions/model-provider-override.ts";
import type { RunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRuntimeEnvironment } from "../../src/environment/runtime-lifecycle.ts";

/** Not a key shape: a real-looking one trips the repository's secret scanner. */
const CREDENTIAL = "the gateway credential under test";

const log = (() => {}) as never;

const codexPlan = (isDaytona: boolean): RunPlan =>
  ({
    acpAgent: "codex",
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
      harnessApiKeyVar: "OPENAI_API_KEY",
      hasApiKey: false,
      credentialMode: "env",
    },
  }) as unknown as RunPlan;

const gatewayRequest = (): AgentRunRequest =>
  ({
    modelConnection: {
      provider: "openai",
      endpoint: { baseUrl: "https://gateway.example/openai" },
      gatewayCredentials: {
        header: "x-agenta-gateway-credentials",
        value: CREDENTIAL,
      },
    },
  }) as unknown as AgentRunRequest;

const buildDaemonEnv = (() => ({})) as never;

const build = (isDaytona: boolean, request: AgentRunRequest) => {
  const plan = codexPlan(isDaytona);
  const runtime = buildRuntimeEnvironment({
    plan,
    request,
    piSkillSnapshot: undefined,
    log,
    deps: { buildDaemonEnv },
  });
  return { plan, runtime };
};

describe("Codex's gateway connection environment on a Daytona run", () => {
  it("gives Codex in the Daytona sandbox the OPENAI_API_KEY its gateway provider reads", () => {
    const { plan, runtime } = build(true, gatewayRequest());
    const daemonEnv = daytonaEnvVars(runtime.piExtEnv, plan.credentials.modelEnvironment);

    assert.equal(daemonEnv.OPENAI_API_KEY, GATEWAY_PLACEHOLDER_API_KEY);
  });

  it("still reaches the local daemon", () => {
    const { runtime } = build(false, gatewayRequest());

    assert.equal(runtime.env.OPENAI_API_KEY, GATEWAY_PLACEHOLDER_API_KEY);
  });

  it("sets no placeholder on a run without gateway credentials", () => {
    const { plan, runtime } = build(true, {} as AgentRunRequest);
    const daemonEnv = daytonaEnvVars(runtime.piExtEnv, plan.credentials.modelEnvironment);

    assert.ok(!("OPENAI_API_KEY" in daemonEnv));
  });
});
