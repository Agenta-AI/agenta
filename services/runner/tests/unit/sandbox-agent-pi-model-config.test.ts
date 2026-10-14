/**
 * Unit tests for the pure Pi model-config builder.
 *
 * Exhaustive over the applicability + completeness gate, and a no-secret-leak proof. Pure module:
 * no filesystem or sandbox dependency.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-model-config.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  buildPiModelConfigPlan,
  isPiModelConfigApplicable,
  PI_GATEWAY_DEFAULT_PROVIDER_ID,
  PiModelConfigError,
  serializePiModelsJson,
} from "../../src/engines/sandbox_agent/pi-model-config.ts";
import { GATEWAY_PLACEHOLDER_API_KEY } from "../../src/extensions/model-provider-override.ts";

const RAW_KEY = "sk-super-secret-value-do-not-leak";

/** Flattened overrides: the resolved routing fields live on `modelConnection` on the wire. */
interface RequestOverrides {
  harness?: string;
  provider?: string;
  deployment?: string;
  endpoint?: { baseUrl?: string };
  credentialMode?: "env" | "runtime_provided" | "none";
  connection?: AgentRunRequest["connection"];
  model?: string;
}

/** A complete, applicable managed OpenAI-compatible custom Pi request. */
function completeRequest(over: RequestOverrides = {}): AgentRunRequest {
  return {
    harness: "harness" in over ? over.harness : "pi_core",
    connection:
      "connection" in over ? over.connection : { mode: "agenta", slug: "my-ollama" },
    model: over.model ?? "qwen2.5-coder:7b",
    modelConnection: {
      provider: over.provider ?? "openai",
      deployment: over.deployment ?? "custom",
      endpoint: over.endpoint ?? { baseUrl: "https://example.test/v1" },
      credentialMode: over.credentialMode ?? "env",
      credentials: [],
    },
  };
}

const completeSecrets = { OPENAI_API_KEY: RAW_KEY };

describe("buildPiModelConfigPlan (applicable + complete)", () => {
  it("builds a plan for a managed OpenAI-compatible custom Pi run", () => {
    const plan = buildPiModelConfigPlan(completeRequest(), completeSecrets);
    assert.deepEqual(plan, {
      providerId: "my-ollama",
      providerFamily: "openai",
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      apiKey: "$OPENAI_API_KEY",
      apiKeyEnv: "OPENAI_API_KEY",
      models: [{ id: "qwen2.5-coder:7b" }],
    });
  });

  it("applies to pi_agenta as well as pi_core, and to an empty (defaulted) harness", () => {
    assert.ok(
      buildPiModelConfigPlan(
        completeRequest({ harness: "pi_agenta" }),
        completeSecrets,
      ),
    );
    assert.ok(
      buildPiModelConfigPlan(
        completeRequest({ harness: undefined }),
        completeSecrets,
      ),
    );
  });

  it("holds only the env var NAME — never the raw key value", () => {
    const plan = buildPiModelConfigPlan(completeRequest(), completeSecrets);
    assert.ok(plan);
    assert.equal(plan.apiKeyEnv, "OPENAI_API_KEY");
    assert.equal(JSON.stringify(plan).includes(RAW_KEY), false);
  });
});

describe("buildPiModelConfigPlan (non-applicable -> no plan, current behavior)", () => {
  it("returns no plan for a Claude request", () => {
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({ harness: "claude" }),
        completeSecrets,
      ),
      undefined,
    );
  });

  it("returns no plan for a standard Pi (direct) request", () => {
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({ deployment: "direct", connection: undefined }),
        completeSecrets,
      ),
      undefined,
    );
  });

  it("returns no plan for a subscription (runtime_provided) request", () => {
    // A subscription run is direct + self-managed, not a named custom connection.
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({
          deployment: "direct",
          credentialMode: "runtime_provided",
          connection: { mode: "default" },
        }),
        {},
      ),
      undefined,
    );
  });

  it("returns no plan when the provider family is not openai", () => {
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({ provider: "anthropic" }),
        completeSecrets,
      ),
      undefined,
    );
  });

  it("returns no plan when the connection is not a named agenta connection", () => {
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({ connection: { mode: "default", slug: "x" } }),
        completeSecrets,
      ),
      undefined,
    );
    assert.equal(
      buildPiModelConfigPlan(
        completeRequest({ connection: undefined }),
        completeSecrets,
      ),
      undefined,
    );
  });
});

describe("buildPiModelConfigPlan (gateway route with no named connection)", () => {
  // A Gemini provider key with no connection picked: the gateway resolves it to its
  // OpenAI-compatible chat-completions route. Pi's built-in `openai` provider would call
  // `/responses` there, which Google does not serve (404).
  const geminiKeyRequest = (): AgentRunRequest => ({
    harness: "pi_core",
    model: "openai/gemini-4-argon",
    modelConnection: {
      provider: "openai",
      deployment: "custom",
      endpoint: {
        baseUrl: "https://gateway.example.test/api/gateways/llms/standard/gemini/v1",
      },
      credentialMode: "none",
      credentials: [],
      gatewayCredentials: { header: "X-AG-Credentials", value: RAW_KEY },
    },
  });

  it("registers a chat-completions provider for the gateway route", () => {
    const request = geminiKeyRequest();
    assert.equal(isPiModelConfigApplicable(request), true);
    assert.deepEqual(buildPiModelConfigPlan(request, {}), {
      providerId: PI_GATEWAY_DEFAULT_PROVIDER_ID,
      providerFamily: "openai",
      api: "openai-completions",
      baseUrl: "https://gateway.example.test/api/gateways/llms/standard/gemini/v1",
      apiKey: GATEWAY_PLACEHOLDER_API_KEY,
      apiKeyEnv: "OPENAI_API_KEY",
      models: [{ id: "gemini-4-argon" }],
      headers: { "X-AG-Credentials": "$AGENTA_GATEWAY_CREDENTIALS_VALUE" },
    });
  });

  it("never writes the gateway credential into models.json", () => {
    const plan = buildPiModelConfigPlan(geminiKeyRequest(), {});
    assert.ok(plan);
    assert.ok(!serializePiModelsJson(plan).includes(RAW_KEY));
  });

  it("leaves a direct custom route with no connection to the provider override", () => {
    const request = geminiKeyRequest();
    delete request.modelConnection!.gatewayCredentials;
    assert.equal(isPiModelConfigApplicable(request), false);
    assert.equal(buildPiModelConfigPlan(request, {}), undefined);
  });

  it("leaves a gateway route to a direct provider to Pi's built-in provider", () => {
    const request = geminiKeyRequest();
    request.modelConnection!.deployment = "direct";
    assert.equal(buildPiModelConfigPlan(request, {}), undefined);
  });
});

describe("buildPiModelConfigPlan (applicable but incomplete -> typed error)", () => {
  const cases: Array<{
    name: string;
    over: RequestOverrides;
    secrets?: Record<string, string>;
    hint: RegExp;
  }> = [
    {
      name: "empty connection slug",
      over: { connection: { mode: "agenta", slug: "   " } },
      hint: /connection slug/,
    },
    {
      name: "missing endpoint base URL",
      over: { endpoint: { baseUrl: "  " } },
      hint: /base URL/,
    },
    {
      name: "credential mode is not env",
      over: { credentialMode: "none" },
      hint: /credential mode "env"/,
    },
    {
      name: "OPENAI_API_KEY absent from the secret set",
      over: {},
      secrets: {},
      hint: /OPENAI_API_KEY/,
    },
    {
      name: "OPENAI_API_KEY present but blank",
      over: {},
      secrets: { OPENAI_API_KEY: "   " },
      hint: /OPENAI_API_KEY/,
    },
    {
      name: "no model id",
      over: { model: "  " },
      hint: /model id/,
    },
  ];

  for (const { name, over, secrets, hint } of cases) {
    it(`throws a typed error when ${name} (never a silent no-op)`, () => {
      assert.throws(
        () =>
          buildPiModelConfigPlan(
            completeRequest(over),
            secrets ?? completeSecrets,
          ),
        (err: unknown) => {
          assert.ok(err instanceof PiModelConfigError);
          assert.match(err.message, hint);
          // Fail-loud, never a silent fall-back.
          assert.match(err.message, /stopped/);
          return true;
        },
      );
    });
  }

  it("never leaks the raw key in the incomplete-request error message", () => {
    try {
      buildPiModelConfigPlan(completeRequest({ model: "" }), completeSecrets);
      assert.fail("expected an incomplete-request error");
    } catch (err) {
      assert.ok(err instanceof PiModelConfigError);
      assert.equal(err.message.includes(RAW_KEY), false);
    }
  });
});

describe("serializePiModelsJson (exact shape, no key leak)", () => {
  it("serializes the exact Pi models.json document keyed by slug", () => {
    const plan = buildPiModelConfigPlan(completeRequest(), completeSecrets);
    assert.ok(plan);
    const text = serializePiModelsJson(plan);

    assert.deepEqual(JSON.parse(text), {
      providers: {
        "my-ollama": {
          baseUrl: "https://example.test/v1",
          api: "openai-completions",
          apiKey: "$OPENAI_API_KEY",
          models: [{ id: "qwen2.5-coder:7b" }],
        },
      },
    });
    // The file references the env var, never the raw key.
    assert.equal(text.includes("$OPENAI_API_KEY"), true);
    assert.equal(text.includes(RAW_KEY), false);
    // Trailing newline for a well-formed file.
    assert.equal(text.endsWith("\n"), true);
  });
});
