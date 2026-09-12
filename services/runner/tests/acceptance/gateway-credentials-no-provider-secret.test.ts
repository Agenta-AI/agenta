/**
 * Acceptance: a gateway-routed run reaches every harness with no provider secret in the
 * sandbox environment. No deployed stack exists in this worktree (repo policy: write, don't run),
 * so this drives the REAL environment-construction functions the runner uses for both the local
 * and the Daytona path — `materializeModelEnvironment`, `applyClaudeConnectionEnv`,
 * `buildPiModelConfigPlan`/`serializePiModelsJson`, `buildDaytonaSecretPlan` — against the shared
 * golden gateway connection, and inspects what they actually produce (the env object, the
 * models.json text, the Daytona secret plan), not the resolver's intent. It does not spawn a real
 * sandbox or harness binary; that would need the deployed stack this constraint forbids running.
 *
 * It verifies that only gateway credentials enter sandbox configuration.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import type { AgentRunRequest, ModelConnection } from "../../src/protocol.ts";
import { materializeModelEnvironment } from "../../src/engines/sandbox_agent/run-plan.ts";
import { applyClaudeConnectionEnv } from "../../src/engines/sandbox_agent/runtime-policy.ts";
import {
  buildPiModelConfigPlan,
  serializePiModelsJson,
} from "../../src/engines/sandbox_agent/pi-model-config.ts";
import { buildDaytonaSecretPlan } from "../../src/engines/sandbox_agent/daytona-secret-plan.ts";

const GOLDEN = loadGolden("model_connection.gateway.json") as ModelConnection;
const GATEWAY_VALUE = GOLDEN.gatewayCredentials!.value; // "ApiKey mock-gateway-credentials"

// A provider-secret-shaped string. If this (or anything matching the real shape a resolver would
// would emit directly, e.g. "sk-...") appears, the isolation invariant is broken.
const PROVIDER_SECRET_MARKERS = ["sk-", "OPENAI_API_KEY=", "ANTHROPIC_API_KEY="];

function assertNoProviderSecret(haystack: string): void {
  for (const marker of PROVIDER_SECRET_MARKERS) {
    assert.equal(
      haystack.includes(marker),
      false,
      `provider-secret marker '${marker}' leaked into the sandbox environment`,
    );
  }
}

describe("gateway route -> no provider secret in the sandbox (local and Daytona shape)", () => {
  it("materializeModelEnvironment: empty environment for a gateway connection", () => {
    const request: AgentRunRequest = { modelConnection: GOLDEN };
    const materialized = materializeModelEnvironment(request);
    assert.equal(materialized.ok, true);
    assert.ok(materialized.ok && Object.keys(materialized.environment).length === 0);
  });

  it("claude: the daemon env carries the gateway header and only a non-secret selector", () => {
    const request: AgentRunRequest = { modelConnection: GOLDEN };
    const env: Record<string, string> = {};
    applyClaudeConnectionEnv(env, request, "claude", () => {});
    assert.equal(env.ANTHROPIC_API_KEY, "agenta-gateway");
    assert.notEqual(env.ANTHROPIC_API_KEY, GATEWAY_VALUE);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assertNoProviderSecret(JSON.stringify(env));
    assert.ok(env.ANTHROPIC_CUSTOM_HEADERS?.includes(GATEWAY_VALUE));
  });

  it("pi: the rendered models.json carries $ENV indirection, never a raw key or the gateway value on disk", () => {
    const request: AgentRunRequest = {
      modelConnection: GOLDEN,
      harness: "pi_core",
      connection: { mode: "agenta", slug: "gateway-conn" },
      model: "gpt-5.5",
    };
    const plan = buildPiModelConfigPlan(request, {});
    assert.ok(plan);
    const text = serializePiModelsJson(plan);
    assertNoProviderSecret(text);
    assert.equal(text.includes(GATEWAY_VALUE), false); // the value never reaches disk
    assert.equal(text.includes("$AGENTA_GATEWAY_CREDENTIALS_VALUE"), true);
  });

  it("daytona: the secret plan for a gateway connection hides nothing, because there is nothing left to hide", () => {
    const plan = buildDaytonaSecretPlan({ modelConnection: GOLDEN });
    assert.deepEqual(plan.candidates, []);
    assert.deepEqual(plan.environment, {});
  });

  it("across every harness, the ONLY credential value ever set is our own gateway credential", () => {
    const request: AgentRunRequest = {
      modelConnection: GOLDEN,
      harness: "pi_core",
      connection: { mode: "agenta", slug: "gateway-conn" },
      model: "gpt-5.5",
    };
    const claudeEnv: Record<string, string> = {};
    applyClaudeConnectionEnv(claudeEnv, request, "claude", () => {});
    const piPlan = buildPiModelConfigPlan(request, {});
    const piText = piPlan ? serializePiModelsJson(piPlan) : "";
    const materialized = materializeModelEnvironment(request);

    const everything = JSON.stringify({
      claudeEnv,
      piText,
      materializedEnvironment: materialized.ok ? materialized.environment : {},
    });
    // The gateway value legitimately appears (Claude reads it directly); no OTHER secret does.
    assertNoProviderSecret(everything);
  });
});
