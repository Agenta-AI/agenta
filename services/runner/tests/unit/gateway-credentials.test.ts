/**
 * The gateway-credentials field from the consumer side.
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
import {
  applyClaudeConnectionEnv,
  applyCodexGatewayConnectionEnv,
} from "../../src/engines/sandbox_agent/runtime-policy.ts";
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

  it("refuses malformed header names and newline-bearing values", () => {
    for (const gatewayCredentials of [
      { header: "  ", value: "ApiKey something" },
      { header: "X-AG-Credentials", value: "" },
      { header: "X-AG-Credentials: injected", value: "ApiKey something" },
      { header: "X-AG-Credentials\r\nX-Injected", value: "ApiKey something" },
      {
        header: "X-AG-Credentials",
        value: "ApiKey something\r\nX-Injected: yes",
      },
    ]) {
      const result = materializeModelEnvironment(
        request({ ...GOLDEN, gatewayCredentials }),
      );
      assert.equal(result.ok, false);
    }
  });

  it("allows the normal HTTP API gateway route, which is loopback", () => {
    // Local development's API gateway is plain http to loopback, and D37 exempts exactly that
    // hop: it has no remote to leak a bearer to. This case used to assert a ROUTABLE
    // plain-http host (`http://gateway.example.com`) was accepted, which contradicted the SDK
    // producer's `test_plain_http_to_a_remote_host_is_refused` on the same URL — one leg
    // admitted what the other refused. That host now lives in the flag-gated block below.
    for (const baseUrl of [
      "http://localhost:8000/gateways",
      "http://127.0.0.1:8000/gateways",
      "http://host.docker.internal:8000/gateways",
    ]) {
      const normalApiRoute = materializeModelEnvironment(
        request({ ...GOLDEN, endpoint: { baseUrl } }),
      );
      assert.equal(normalApiRoute.ok, true, baseUrl);
    }
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

  it("claude: carries the header and only the fixed non-secret selector", () => {
    const env: Record<string, string> = {};
    applyClaudeConnectionEnv(env, goldenRequest, "claude", () => {});
    assert.equal(
      env.ANTHROPIC_CUSTOM_HEADERS,
      "X-AG-Credentials: ApiKey mock-gateway-credentials",
    );
    assert.equal(env.ANTHROPIC_API_KEY, "agenta-gateway");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.MCP_PROTOCOL_NEGOTIATION, "auto");
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
    assert.equal(plan.apiKey, "agenta-gateway");
    assert.equal(
      JSON.stringify(plan).includes("ApiKey mock-gateway-credentials"),
      false,
    );
  });

  it("claude never sees a provider API key on a gateway connection", () => {
    const env: Record<string, string> = {};
    applyClaudeConnectionEnv(env, goldenRequest, "claude", () => {});
    assert.equal(env.ANTHROPIC_API_KEY, "agenta-gateway");
    assert.notEqual(env.ANTHROPIC_API_KEY, GOLDEN.gatewayCredentials?.value);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.ok(env.ANTHROPIC_CUSTOM_HEADERS);
  });

  it("codex receives only the fixed selector placeholder on a gateway connection", () => {
    const env: Record<string, string> = {};
    applyCodexGatewayConnectionEnv(env, goldenRequest, "codex");
    assert.deepEqual(env, { OPENAI_API_KEY: "agenta-gateway" });
    assert.notEqual(env.OPENAI_API_KEY, GOLDEN.gatewayCredentials?.value);
  });
});

/**
 * The plain-http opt-in (OR24), from the runner's leg.
 *
 * The invariant under test is agreement, not permissiveness: the Python SDK
 * (`connections/models.py`) and this leg read the same variable and must answer the same way
 * for the same URL. Before the flag existed they disagreed — the SDK refused a routable
 * plain-http gateway while this leg accepted one — so a deployment could pass one gate and
 * fail the other.
 *
 * Each case sets the variable explicitly and restores it, because the ambient value belongs
 * to whatever env file the shell loaded.
 */
describe("gateway credentials over plain http", () => {
  const FLAG = "AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED";
  const ROUTABLE_HTTP =
    "http://144.76.237.122:8680/api/gateways/llms/builtin/mock/v1";

  function withFlag<T>(value: string | undefined, run: () => T): T {
    const previous = process.env[FLAG];
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    try {
      return run();
    } finally {
      if (previous === undefined) delete process.env[FLAG];
      else process.env[FLAG] = previous;
    }
  }

  function overHttp(): ModelConnection {
    return {
      ...GOLDEN,
      endpoint: { ...GOLDEN.endpoint, baseUrl: ROUTABLE_HTTP },
    } as ModelConnection;
  }

  it("is refused when the flag is unset", () => {
    withFlag(undefined, () => {
      const result = materializeModelEnvironment(request(overHttp()));
      assert.equal(result.ok, false);
      assert.match(
        result.ok === false ? result.error : "",
        /effective HTTPS endpoint/,
      );
      // The refusal has to name the way out, the same way the SDK's typed error does.
      assert.match(result.ok === false ? result.error : "", new RegExp(FLAG));
    });
  });

  it("is refused when the flag is explicitly off", () => {
    withFlag("false", () => {
      assert.equal(materializeModelEnvironment(request(overHttp())).ok, false);
    });
  });

  it("is allowed when the flag is on", () => {
    withFlag("true", () => {
      const result = materializeModelEnvironment(request(overHttp()));
      assert.equal(result.ok, true);
      assert.deepEqual(materializeGatewayHeaders(request(overHttp())), {
        "X-AG-Credentials": "ApiKey mock-gateway-credentials",
      });
    });
  });

  it("never consults the flag for an https gateway", () => {
    withFlag("false", () => {
      assert.equal(materializeModelEnvironment(request(GOLDEN)).ok, true);
    });
  });

  it("keeps the loopback exemption in both flag states", () => {
    const loopback = {
      ...GOLDEN,
      endpoint: {
        ...GOLDEN.endpoint,
        baseUrl: "http://localhost:8680/api/gateways",
      },
    } as ModelConnection;

    for (const value of [undefined, "false", "true"]) {
      withFlag(value, () => {
        assert.equal(materializeModelEnvironment(request(loopback)).ok, true);
      });
    }
  });

  it("does not let the flag carry a provider secret over plain http", () => {
    withFlag("true", () => {
      const providerSecretOverHttp = {
        ...GOLDEN,
        endpoint: { ...GOLDEN.endpoint, baseUrl: ROUTABLE_HTTP },
        gatewayCredentials: undefined,
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: "sk-provider",
            usage: "opaque_http",
          },
        ],
      } as unknown as ModelConnection;

      const result = materializeModelEnvironment(
        request(providerSecretOverHttp),
      );
      assert.equal(result.ok, false);
      assert.match(
        result.ok === false ? result.error : "",
        /opaque_http model credentials require an effective HTTPS endpoint/,
      );
    });
  });
});
