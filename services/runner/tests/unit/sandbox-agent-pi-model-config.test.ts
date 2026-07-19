/**
 * Unit tests for the pure Pi model-config builder (design Decision 5, planning layer).
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
  PiModelConfigError,
  serializePiModelsJson,
} from "../../src/engines/sandbox_agent/pi-model-config.ts";

const RAW_KEY = "sk-super-secret-value-do-not-leak";

/** A complete, applicable managed OpenAI-compatible custom Pi request. */
function completeRequest(over: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    harness: "pi_core",
    provider: "openai",
    deployment: "custom",
    connection: { mode: "agenta", slug: "my-ollama" },
    endpoint: { baseUrl: "https://example.test/v1" },
    credentialMode: "env",
    model: "qwen2.5-coder:7b",
    ...over,
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

describe("buildPiModelConfigPlan (applicable but incomplete -> typed error)", () => {
  const cases: Array<{
    name: string;
    over: Partial<AgentRunRequest>;
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
