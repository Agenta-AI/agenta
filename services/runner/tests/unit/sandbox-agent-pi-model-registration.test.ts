/**
 * Unit tests for registering a model Pi's built-in registry does not carry.
 *
 * Pi enumerates a STATIC model table and refuses to select anything outside it, so a model id an
 * author typed by hand (an OpenRouter routing variant, a model newer than the pinned Pi) has to be
 * merged into that provider's block in the per-run `models.json`. These tests pin the three things
 * that make that safe: the right entry for an unknown id, NO entry for a catalog id (registering
 * one would replace Pi's own definition), and no write into the operator's mounted agent dir.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-pi-model-registration.test.ts)
 */
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "pi-coding-agent-pi-ai";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  DEFAULT_PI_MAX_OUTPUT_TOKENS,
  PI_MAX_OUTPUT_TOKENS_ENV,
  PI_MODELS_AHEAD_OF_CATALOG,
  buildPiModelRegistrationPlan,
  describePiModelsJsonPlan,
  isPiModelRegistrationPlan,
  piModelsJsonProviderId,
  serializePiModelsJson,
  type PiModelEntry,
  type PiModelRegistrationPlan,
} from "../../src/engines/sandbox_agent/pi-model-config.ts";
import {
  loadPiBuiltinRegistry,
  type PiBuiltinModel,
  type PiBuiltinRegistry,
} from "../../src/engines/sandbox_agent/pi-builtin-registry.ts";
import { prepareLocalPiAssets } from "../../src/engines/sandbox_agent/pi-assets.ts";
import { createSessionModelRuntime } from "../../src/engines/inprocess/pi/pi-session-factory.ts";
import { resetEnvWarnings } from "../../src/env.ts";

/** A stand-in for Pi's static table: one gateway provider with one reasoning model. */
const OPENROUTER_BASE: PiBuiltinModel = {
  id: "deepseek/deepseek-v4-flash",
  name: "DeepSeek: DeepSeek V4 Flash",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
  reasoning: true,
  thinkingLevelMap: { low: null, high: "high" },
  input: ["text"],
  cost: { input: 0.09, output: 0.18 },
  contextWindow: 1048576,
  maxTokens: 65536,
};

const OPENROUTER_OTHER: PiBuiltinModel = {
  id: "z-ai/glm-5.2",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
  contextWindow: 200000,
};

const fakeRegistry: PiBuiltinRegistry = {
  hasProvider: (provider) => provider === "openrouter" || provider === "openai",
  models: (provider) =>
    provider === "openrouter" ? [OPENROUTER_BASE, OPENROUTER_OTHER] : [],
};

function piRequest(
  model: string | undefined,
  harness = "pi_core",
): AgentRunRequest {
  return { harness, model } as AgentRunRequest;
}

describe("buildPiModelRegistrationPlan (an id Pi does not carry)", () => {
  it("registers a hand-entered routing variant under its built-in provider", () => {
    const plan = buildPiModelRegistrationPlan(
      piRequest("openrouter/deepseek/deepseek-v4-flash:nitro"),
      fakeRegistry,
    );

    assert.ok(plan, "an unregistered id must produce a plan");
    assert.equal(plan.builtinProvider, "openrouter");
    assert.equal(plan.models.length, 1);
    // The provider prefix is split off ONCE: the model id keeps its own embedded slash.
    assert.equal(plan.models[0].id, "deepseek/deepseek-v4-flash:nitro");
  });

  it("inherits the base model's metadata, because a variant routes the same model", () => {
    const plan = buildPiModelRegistrationPlan(
      piRequest("openrouter/deepseek/deepseek-v4-flash:nitro"),
      fakeRegistry,
    );

    const entry = plan?.models[0];
    assert.deepEqual(entry?.compat, OPENROUTER_BASE.compat);
    assert.equal(entry?.reasoning, true);
    assert.deepEqual(entry?.thinkingLevelMap, OPENROUTER_BASE.thinkingLevelMap);
    assert.equal(entry?.contextWindow, 1048576);
    // Lowered from the base's 65,536: OpenRouter reserves the full output cap up front.
    assert.equal(entry?.maxTokens, DEFAULT_PI_MAX_OUTPUT_TOKENS);
    assert.deepEqual(entry?.cost, OPENROUTER_BASE.cost);
    // The variant is its own model id, never relabelled as the base's display name.
    assert.deepEqual(Object.keys(entry ?? {}).includes("name"), false);
  });

  it("falls back to the provider's request dialect when no base model matches", () => {
    const plan = buildPiModelRegistrationPlan(
      piRequest("openrouter/some-vendor/model-released-last-week"),
      fakeRegistry,
    );

    const entry: PiModelEntry | undefined = plan?.models[0];
    // Exactly these two keys: nothing is guessed, so Pi defaults the context window, the output
    // limit, and reasoning support rather than being told something invented for them.
    assert.deepEqual(entry, {
      id: "some-vendor/model-released-last-week",
      compat: { supportsDeveloperRole: false, thinkingFormat: "openrouter" },
    });
  });

  it("registers a variant of a model whose base id has no slash", () => {
    const registry: PiBuiltinRegistry = {
      hasProvider: (provider) => provider === "openai",
      models: () => [{ id: "gpt-5.6-luna", contextWindow: 272000 }],
    };

    const plan = buildPiModelRegistrationPlan(
      piRequest("openai/gpt-5.6-luna:preview"),
      registry,
    );

    assert.equal(plan?.models[0]?.id, "gpt-5.6-luna:preview");
    assert.equal(plan?.models[0]?.contextWindow, 272000);
  });
});

describe("buildPiModelRegistrationPlan (no plan — the cases that must stay untouched)", () => {
  it("writes NO entry for a model the provider already has built in", () => {
    // No output limit in the catalog, so there is nothing to cap either.
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/z-ai/glm-5.2"),
        fakeRegistry,
      ),
      undefined,
    );
  });

  it("leaves a custom connection slug alone (the custom-provider plan owns it)", () => {
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("my-ollama/qwen2.5-coder:7b"),
        fakeRegistry,
      ),
      undefined,
    );
  });

  it("leaves a bare (unprefixed) model id to Pi's own suffix matching", () => {
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("gpt-5.6-luna"), fakeRegistry),
      undefined,
    );
  });

  it("does nothing for a non-Pi harness or a request with no model", () => {
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/deepseek/deepseek-v4-flash:nitro", "claude"),
        fakeRegistry,
      ),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest(undefined), fakeRegistry),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("  "), fakeRegistry),
      undefined,
    );
  });

  it("registers nothing for an id that names no provider or no model", () => {
    // "openrouter/" -> empty model id.
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("openrouter/"), fakeRegistry),
      undefined,
    );
    // A leading slash names no provider.
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("/deepseek-v4"), fakeRegistry),
      undefined,
    );
  });
});

describe("serializePiModelsJson (registration document)", () => {
  const plan = buildPiModelRegistrationPlan(
    piRequest("openrouter/deepseek/deepseek-v4-flash:nitro"),
    fakeRegistry,
  ) as PiModelRegistrationPlan;

  it("keys the block by the BUILT-IN provider and writes only models", () => {
    const document = JSON.parse(serializePiModelsJson(plan));
    const block = document.providers.openrouter;

    assert.deepEqual(Object.keys(document.providers), ["openrouter"]);
    // No baseUrl / api / apiKey: Pi inherits the endpoint, dialect, and credential from its own
    // definition of this provider. Emitting baseUrl here would re-point every built-in model on it.
    assert.deepEqual(Object.keys(block), ["models"]);
    assert.equal(block.models[0].id, "deepseek/deepseek-v4-flash:nitro");
  });

  it("carries no credential value or env reference at all", () => {
    const text = serializePiModelsJson(plan);
    assert.equal(text.includes("apiKey"), false);
    assert.equal(text.includes("$"), false);
    assert.equal(text.endsWith("}\n"), true);
  });

  it("reports its identity for logs and for the model the run asks the harness to select", () => {
    assert.equal(isPiModelRegistrationPlan(plan), true);
    assert.equal(piModelsJsonProviderId(plan), "openrouter");
    assert.equal(
      `${piModelsJsonProviderId(plan)}/${plan.models[0]?.id}`,
      "openrouter/deepseek/deepseek-v4-flash:nitro",
    );
    assert.match(describePiModelsJsonPlan(plan), /builtin-model-registration/);
  });
});

describe("Pi's real built-in registry (the table the pinned harness runs)", () => {
  it("knows the catalog model and does NOT know the hand-entered variant", async () => {
    const registry = await loadPiBuiltinRegistry();

    assert.ok(
      registry,
      "the pinned pi-ai catalog must be readable from the runner",
    );
    assert.equal(registry.hasProvider("openrouter"), true);
    assert.equal(registry.hasProvider("my-ollama"), false);

    const ids = new Set(registry.models("openrouter").map((model) => model.id));
    assert.equal(ids.has("deepseek/deepseek-v4-flash"), true);
    assert.equal(ids.has("deepseek/deepseek-v4-flash:nitro"), false);
  });

  it("produces the founder's blocked model as a registration against the real table", async () => {
    const registry = await loadPiBuiltinRegistry();
    assert.ok(registry);

    const plan = buildPiModelRegistrationPlan(
      piRequest("openrouter/deepseek/deepseek-v4-flash:nitro"),
      registry,
    );

    assert.equal(plan?.builtinProvider, "openrouter");
    assert.equal(plan?.models[0]?.id, "deepseek/deepseek-v4-flash:nitro");
    // Real metadata off the real base model, not Pi's generic defaults.
    assert.equal(plan?.models[0]?.reasoning, true);
    assert.ok((plan?.models[0]?.contextWindow ?? 0) > 128000);

    // A model the catalog offers stays Pi's own: at most its output cap changes.
    assert.deepEqual(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/tencent/hy3"),
        registry,
      )?.models ?? [],
      [],
    );
  });
});

describe("the output cap on a provider that reserves output up front", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetEnvWarnings();
  });

  function registryOf(
    provider: string,
    models: PiBuiltinModel[],
  ): PiBuiltinRegistry {
    return {
      hasProvider: (candidate) => candidate === provider,
      models: (candidate) => (candidate === provider ? models : []),
    };
  }

  it("lowers a catalog OpenRouter model's cap through modelOverrides and registers no model", () => {
    const plan = buildPiModelRegistrationPlan(
      piRequest("openrouter/deepseek/deepseek-v4-flash"),
      fakeRegistry,
    );

    assert.deepEqual(plan, {
      builtinProvider: "openrouter",
      models: [],
      modelOverrides: {
        "deepseek/deepseek-v4-flash": { maxTokens: DEFAULT_PI_MAX_OUTPUT_TOKENS },
      },
    });
    // Only the override is written, so Pi keeps every other field of its own definition.
    const document = JSON.parse(serializePiModelsJson(plan as PiModelRegistrationPlan));
    assert.deepEqual(document, {
      providers: {
        openrouter: {
          modelOverrides: {
            "deepseek/deepseek-v4-flash": { maxTokens: DEFAULT_PI_MAX_OUTPUT_TOKENS },
          },
        },
      },
    });
    assert.equal(
      describePiModelsJsonPlan(plan as PiModelRegistrationPlan),
      "kind=builtin-model-override provider=openrouter " +
        `override=deepseek/deepseek-v4-flash:maxTokens=${DEFAULT_PI_MAX_OUTPUT_TOKENS}`,
    );
  });

  it("leaves a catalog model whose limit is already at or under the cap", () => {
    const registry = registryOf("openrouter", [
      { id: "vendor/small", maxTokens: 8192 },
      { id: "vendor/exact", maxTokens: DEFAULT_PI_MAX_OUTPUT_TOKENS },
    ]);

    assert.equal(
      buildPiModelRegistrationPlan(piRequest("openrouter/vendor/small"), registry),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("openrouter/vendor/exact"), registry),
      undefined,
    );
    // A variant inherits the smaller limit unchanged.
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("openrouter/vendor/small:nitro"), registry)
        ?.models[0]?.maxTokens,
      8192,
    );
  });

  it("keeps Pi's value on a provider that bills only the output a turn uses", () => {
    const registry = registryOf("anthropic", [
      { id: "claude-large", maxTokens: 128000 },
    ]);

    assert.equal(
      buildPiModelRegistrationPlan(piRequest("anthropic/claude-large"), registry),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("anthropic/claude-large:preview"), registry)
        ?.models[0]?.maxTokens,
      128000,
    );
  });

  it(`takes the cap from ${PI_MAX_OUTPUT_TOKENS_ENV}`, () => {
    vi.stubEnv(PI_MAX_OUTPUT_TOKENS_ENV, "8000");

    assert.deepEqual(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/deepseek/deepseek-v4-flash"),
        fakeRegistry,
      )?.modelOverrides,
      { "deepseek/deepseek-v4-flash": { maxTokens: 8000 } },
    );
    // A model with no limit of its own would get Pi's 16,384 default, which is above this cap.
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/some-vendor/model-released-last-week"),
        fakeRegistry,
      )?.models[0]?.maxTokens,
      8000,
    );
  });

  it("uses the default cap when the override is not a number", () => {
    vi.stubEnv(PI_MAX_OUTPUT_TOKENS_ENV, "lots");
    const warnings: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });

    assert.deepEqual(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/deepseek/deepseek-v4-flash"),
        fakeRegistry,
      )?.modelOverrides,
      { "deepseek/deepseek-v4-flash": { maxTokens: DEFAULT_PI_MAX_OUTPUT_TOKENS } },
    );
    assert.ok(warnings.some((line) => line.includes(PI_MAX_OUTPUT_TOKENS_ENV)));
  });
});

describe("the output cap Pi sends to OpenRouter (the pinned Pi, no network)", () => {
  const MODEL = "deepseek/deepseek-v4.1-flash";

  /**
   * Load `models.json` the way an in-process session does, start one OpenRouter turn, and read
   * the output cap off the request body. The fake `fetch` stops the request before it leaves.
   */
  async function sentOutputCap(modelsJson: string | undefined): Promise<number> {
    const dir = mkdtempSync(join(tmpdir(), "pi-output-cap-"));
    const modelsPath = join(dir, "models.json");
    if (modelsJson) writeFileSync(modelsPath, modelsJson);
    try {
      const runtime = await createSessionModelRuntime({
        credentials: new InMemoryCredentialStore(),
        modelsPath: modelsJson ? modelsPath : undefined,
        modelEnv: { OPENROUTER_API_KEY: "not-a-real-key" },
      });
      const model = runtime.getModel("openrouter", MODEL);
      assert.ok(model, `the pinned Pi catalog must carry openrouter/${MODEL}`);
      let body: Record<string, unknown> | undefined;
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        body = JSON.parse(String(init?.body));
        throw new Error("stopped before the network");
      };
      await runtime.completeSimple(
        model,
        { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
        { fetch, maxRetries: 0 },
      );
      assert.ok(body, "Pi must have built a request body");
      return Number(body.max_tokens ?? body.max_completion_tokens);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("asks for nearly the whole context window without the override (the 402)", async () => {
    assert.ok((await sentOutputCap(undefined)) > 900_000);
  });

  it("asks for the cap once the run's models.json is loaded", async () => {
    const registry = await loadPiBuiltinRegistry();
    assert.ok(registry);
    const plan = buildPiModelRegistrationPlan(piRequest(`openrouter/${MODEL}`), registry);
    assert.ok(plan, "a catalog model over the cap must produce an override plan");

    assert.equal(
      await sentOutputCap(serializePiModelsJson(plan)),
      DEFAULT_PI_MAX_OUTPUT_TOKENS,
    );
  });
});

describe("models newer than the pinned Pi catalog", () => {
  // Pi 0.87.1 carries Opus 5.5 and Grok 4.7 itself, so the runner registers nothing for them and
  // Pi prices each turn from its own catalog instead of from a runner-side copy.
  it("leaves Opus 5.5 and Grok 4.7 to the pinned catalog, which prices them", async () => {
    const registry = await loadPiBuiltinRegistry();
    assert.ok(registry);

    const opus = registry
      .models("anthropic")
      .find((model) => model.id === "claude-opus-5-5");
    assert.deepEqual(pickRates(opus?.cost), {
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
    });
    const grok = registry
      .models("xai")
      .find((model) => model.id === "grok-4.7");
    assert.deepEqual(pickRates(grok?.cost), {
      input: 2,
      output: 6,
      cacheRead: 0.5,
      cacheWrite: 0,
    });

    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("anthropic/claude-opus-5-5"),
        registry,
      ),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("xai/grok-4.7"), registry),
      undefined,
    );
  });

  // Pi 0.99.1 carries Sonnet 5.5 and GPT-6.1 Sol itself, so the runner registers nothing for
  // them either (Sonnet 5.5's runner-side entry was dropped with the 0.99.1 bump).
  it("leaves Sonnet 5.5 and GPT-6.1 Sol to the pinned catalog, which prices them", async () => {
    const registry = await loadPiBuiltinRegistry();
    assert.ok(registry);

    const sonnet = registry
      .models("anthropic")
      .find((model) => model.id === "claude-sonnet-5-5");
    assert.deepEqual(pickRates(sonnet?.cost), {
      input: 2,
      output: 10,
      cacheRead: 0.2,
      cacheWrite: 2.5,
    });
    const sol = registry
      .models("openai")
      .find((model) => model.id === "gpt-6.1-sol");
    assert.deepEqual(pickRates(sol?.cost), {
      input: 2,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2.5,
    });

    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("anthropic/claude-sonnet-5-5"),
        registry,
      ),
      undefined,
    );
    assert.equal(
      buildPiModelRegistrationPlan(piRequest("openai/gpt-6.1-sol"), registry),
      undefined,
    );
  });

  it("lists only models the pinned catalog still lacks", async () => {
    const registry = await loadPiBuiltinRegistry();
    assert.ok(registry);
    for (const id of Object.keys(PI_MODELS_AHEAD_OF_CATALOG)) {
      const separator = id.indexOf("/");
      const provider = id.slice(0, separator);
      const modelId = id.slice(separator + 1);
      assert.equal(
        registry.models(provider).some((model) => model.id === modelId),
        false,
        `${id} is in the pinned Pi catalog now; drop its entry`,
      );
    }
  });

  it("matches the SDK's curated additions, so the picker and the run agree on price", () => {
    const curated = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../../../sdks/python/agenta/sdk/agents/data/pi_models.curated.json",
        ),
        "utf8",
      ),
    ) as {
      additions: Array<{
        id: string;
        pricing: Record<string, number>;
        context_window: number;
      }>;
    };
    const additions = new Map(curated.additions.map((entry) => [entry.id, entry]));

    for (const [id, known] of Object.entries(PI_MODELS_AHEAD_OF_CATALOG)) {
      const addition = additions.get(id);
      assert.ok(addition, `${id} has no SDK catalog addition`);
      assert.deepEqual(
        known.cost,
        {
          input: addition.pricing.input_per_mtok,
          output: addition.pricing.output_per_mtok,
          cacheRead: addition.pricing.cache_read_per_mtok,
          cacheWrite: addition.pricing.cache_write_per_mtok,
        },
        id,
      );
    }
  });
});

function pickRates(
  cost: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!cost) return undefined;
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cacheRead,
    cacheWrite: cost.cacheWrite,
  };
}

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("prepareLocalPiAssets (where a registration is allowed to land)", () => {
  const registrationPlan = buildPiModelRegistrationPlan(
    piRequest("openrouter/deepseek/deepseek-v4-flash:nitro"),
    fakeRegistry,
  ) as PiModelRegistrationPlan;

  function planFor(credentialMode: string, sourcePiAgentDir: string) {
    return {
      isPi: true,
      isDaytona: false,
      credentials: { credentialMode },
      workspace: { skillDirs: [], sourcePiAgentDir },
      prompt: {
        hasSystemPrompt: false,
        systemPrompt: undefined,
        appendSystemPrompt: undefined,
      },
    };
  }

  it("writes the registration into the throwaway per-run dir on a managed run", () => {
    const source = tempDir("agenta-pi-registration-source-");
    const env: Record<string, string> = {};

    const { dir: runDir, modelConfigWritten } = prepareLocalPiAssets({
      plan: planFor("env", source),
      env,
      piModelConfig: registrationPlan,
    });

    assert.ok(runDir);
    dirs.push(runDir as string);
    assert.equal(modelConfigWritten, true);
    assert.equal(env.PI_CODING_AGENT_DIR, runDir);

    const document = JSON.parse(
      readFileSync(join(runDir as string, "models.json"), "utf-8"),
    );
    assert.equal(
      document.providers.openrouter.models[0].id,
      "deepseek/deepseek-v4-flash:nitro",
    );
  });

  it("keeps seeding the operator's auth.json — a built-in provider authenticates as it always did", () => {
    const source = tempDir("agenta-pi-registration-auth-");
    writeFileSync(join(source, "auth.json"), '{"token":"managed"}', "utf-8");

    const { dir: runDir } = prepareLocalPiAssets({
      plan: planFor("env", source),
      env: {},
      piModelConfig: registrationPlan,
    });

    assert.ok(runDir);
    dirs.push(runDir as string);
    // Unlike a CUSTOM-PROVIDER plan, which suppresses this seed so Pi cannot fall back to the
    // operator's own provider, a registration only adds a model to a provider Pi already has.
    assert.equal(
      readFileSync(join(runDir as string, "auth.json"), "utf-8"),
      '{"token":"managed"}',
    );
  });

  it("NEVER writes models.json into the operator's mounted dir on a subscription run", () => {
    const mount = tempDir("agenta-pi-subscription-mount-");
    writeFileSync(join(mount, "auth.json"), '{"oauth":"operator"}', "utf-8");
    const env: Record<string, string> = {};

    const result = prepareLocalPiAssets({
      plan: planFor("runtime_provided", mount),
      env,
      piModelConfig: registrationPlan,
    });

    // The mount is used in place (Pi refreshes its OAuth token into it), so it is not a throwaway.
    assert.equal(result.dir, undefined);
    assert.equal(env.PI_CODING_AGENT_DIR, mount);
    assert.equal(result.modelConfigWritten, true);
    assert.equal(existsSync(join(mount, "models.json")), false);
    // The operator's own login is left exactly as it was found.
    assert.equal(
      readFileSync(join(mount, "auth.json"), "utf-8"),
      '{"oauth":"operator"}',
    );
  });
});
