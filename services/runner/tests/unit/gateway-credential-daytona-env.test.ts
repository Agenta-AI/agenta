/**
 * The gateway credential has to reach the DAYTONA daemon, not only the local one.
 *
 * The runner authenticates the harness to our own gateway with
 * `AGENTA_GATEWAY_CREDENTIALS_VALUE`, and the harness config files reference it by `$`-expansion
 * rather than holding the raw value. A Daytona sandbox's daemon environment is built from
 * `piExtEnv` plus the model environment; the local daemon's `env` is not one of its inputs. So a
 * credential written only to `env` expands to the empty string in the sandbox and every gateway
 * call goes out unauthenticated — with nothing in the runner's own logs to say so, because the
 * runner did set the variable, on the map the sandbox never reads.
 *
 * This case therefore builds the environment and then builds the Daytona daemon environment FROM
 * it, through the same function the provider calls. Asserting on `piExtEnv` alone would pin the
 * implementation; asserting on what Daytona is handed pins the property.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-credential-daytona-env.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { daytonaEnvVars } from "../../src/engines/sandbox_agent/daytona.ts";
import { GATEWAY_CREDENTIALS_VALUE_ENV } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { RunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildRuntimeEnvironment } from "../../src/environment/runtime-lifecycle.ts";

/** Not a key shape: a real-looking one trips the repository's secret scanner. */
const CREDENTIAL = "the gateway credential under test";

const log = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never;

/** A Daytona run on the gateway, with only the fields this builder reads. */
const daytonaGatewayPlan = (): RunPlan =>
  ({
    acpAgent: "pi",
    isPi: true,
    isDaytona: true,
    sandboxId: "daytona",
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
      gatewayCredentials: {
        header: "x-agenta-gateway-credentials",
        value: CREDENTIAL,
      },
    },
  }) as unknown as AgentRunRequest;

/** The daemon env the real builder would produce, stubbed so this case owns its inputs. */
const buildDaemonEnv = (() => ({})) as never;

describe("the gateway credential on a Daytona run", () => {
  it("reaches the Daytona daemon environment with its value", () => {
    const plan = daytonaGatewayPlan();
    const runtime = buildRuntimeEnvironment({
      plan,
      request: gatewayRequest(),
      piSkillSnapshot: undefined,
      log,
      deps: { buildDaemonEnv },
    });

    const daemonEnv = daytonaEnvVars(
      runtime.piExtEnv,
      plan.credentials.modelEnvironment,
    );

    assert.equal(
      daemonEnv[GATEWAY_CREDENTIALS_VALUE_ENV],
      CREDENTIAL,
      "the sandbox cannot authenticate to the gateway without this",
    );
  });

  it("still reaches the local daemon, which reads the other map", () => {
    const runtime = buildRuntimeEnvironment({
      plan: daytonaGatewayPlan(),
      request: gatewayRequest(),
      piSkillSnapshot: undefined,
      log,
      deps: { buildDaemonEnv },
    });

    assert.equal(runtime.env[GATEWAY_CREDENTIALS_VALUE_ENV], CREDENTIAL);
  });

  it("sets nothing when the run carries no gateway credential", () => {
    // An empty variable is worse than an absent one: the harness would send an empty header
    // rather than none, and the gateway's refusal would name a credential instead of its
    // absence.
    const runtime = buildRuntimeEnvironment({
      plan: daytonaGatewayPlan(),
      request: {} as unknown as AgentRunRequest,
      piSkillSnapshot: undefined,
      log,
      deps: { buildDaemonEnv },
    });

    assert.ok(!(GATEWAY_CREDENTIALS_VALUE_ENV in runtime.piExtEnv));
    assert.ok(!(GATEWAY_CREDENTIALS_VALUE_ENV in runtime.env));
  });
});
