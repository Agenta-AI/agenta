/**
 * The gateway-credentials field, from the consumer side (wave 2's seed, D36 and D37).
 *
 * Asserts the SAME golden the SDK producer asserts in
 * `sdks/python/oss/tests/pytest/unit/agents/test_gateway_credentials.py`, so a leg that drops
 * the field fails here rather than at a run that quietly authenticates as nobody.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { loadGolden } from "../utils/golden.ts";
import type { AgentRunRequest, ModelConnection } from "../../src/protocol.ts";
import {
  materializeGatewayHeaders,
  materializeModelEnvironment,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import { requestSecretValues } from "../../src/redaction.ts";
import { applyClaudeConnectionEnv } from "../../src/engines/sandbox_agent/runtime-policy.ts";
import { buildPiModelConfigPlan } from "../../src/engines/sandbox_agent/pi-model-config.ts";

const GOLDEN = loadGolden("model_connection.gateway.json") as ModelConnection;

function request(connection: ModelConnection): AgentRunRequest {
  return { modelConnection: connection } as AgentRunRequest;
}

describe("gateway credentials on the wire", () => {
  it("arrives from the shared golden with a header and a value", () => {
    assert.equal(GOLDEN.gatewayCredentials?.header, "X-AG-Credentials");
    assert.equal(
      GOLDEN.gatewayCredentials?.value,
      "ApiKey mock-gateway-credentials",
    );
  });

  it("materializes as a header, and not into the environment", () => {
    assert.deepEqual(materializeGatewayHeaders(request(GOLDEN)), {
      "X-AG-Credentials": "ApiKey mock-gateway-credentials",
    });

    const materialized = materializeModelEnvironment(request(GOLDEN));
    assert.equal(materialized.ok, true);
    assert.deepEqual(materialized.ok && materialized.environment, {});
  });

  it("seeds the run's redaction deny-set", () => {
    assert.ok(
      requestSecretValues(request(GOLDEN)).includes(
        "ApiKey mock-gateway-credentials",
      ),
    );
  });

  it("is absent, not empty, when the model is not reached through a gateway", () => {
    const direct = { ...GOLDEN, gatewayCredentials: undefined };
    assert.deepEqual(materializeGatewayHeaders(request(direct)), {});
  });

  it("refuses an empty header name or value", () => {
    for (const gatewayCredentials of [
      { header: "  ", value: "ApiKey something" },
      { header: "X-AG-Credentials", value: "" },
    ]) {
      const result = materializeModelEnvironment(
        request({ ...GOLDEN, gatewayCredentials }),
      );
      assert.equal(result.ok, false);
    }
  });

  it("refuses a plaintext hop to a remote host and allows one to loopback", () => {
    const remote = materializeModelEnvironment(
      request({
        ...GOLDEN,
        endpoint: { baseUrl: "http://gateway.example.com" },
      }),
    );
    assert.equal(remote.ok, false);

    const loopback = materializeModelEnvironment(
      request({ ...GOLDEN, endpoint: { baseUrl: "http://localhost:8000" } }),
    );
    assert.equal(loopback.ok, true);
  });

  it("refuses provider credentials riding alongside a gateway credential", () => {
    const both = materializeModelEnvironment(
      request({
        ...GOLDEN,
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: "sk-should-not-be-here",
            usage: "opaque_http",
          },
        ],
      }),
    );
    assert.equal(both.ok, false);
  });
});

describe("gateway credentials, per harness (WP13 Phase 2)", () => {
  const goldenRequest = request(GOLDEN);

  it("claude: carries the header in ANTHROPIC_CUSTOM_HEADERS, and no provider secret", () => {
    const env: Record<string, string> = {};
    applyClaudeConnectionEnv(env, goldenRequest, "claude", () => {});
    assert.equal(
      env.ANTHROPIC_CUSTOM_HEADERS,
      "X-AG-Credentials: ApiKey mock-gateway-credentials",
    );
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  });

  it("pi: carries the header in models.json via $ENV indirection, and no raw value on disk", () => {
    const piRequest: AgentRunRequest = {
      ...goldenRequest,
      harness: "pi_core",
      connection: { mode: "agenta", slug: "gateway-conn" },
      model: "gpt-5.5",
    };
    const plan = buildPiModelConfigPlan(piRequest, {});
    assert.ok(plan);
    assert.deepEqual(plan.headers, {
      "X-AG-Credentials": "$AGENTA_GATEWAY_CREDENTIALS_VALUE",
    });
    assert.equal(
      JSON.stringify(plan).includes("ApiKey mock-gateway-credentials"),
      false,
    );
  });

  it("claude never sees a provider API key on a gateway connection", () => {
    const env: Record<string, string> = {};
    applyClaudeConnectionEnv(env, goldenRequest, "claude", () => {});
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.ok(env.ANTHROPIC_CUSTOM_HEADERS);
  });
});
