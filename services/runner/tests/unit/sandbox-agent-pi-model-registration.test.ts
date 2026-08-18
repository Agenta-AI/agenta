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
import { afterEach, describe, it } from "vitest";
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

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
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
    assert.equal(entry?.maxTokens, 65536);
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

    assert.equal(plan?.models[0].id, "gpt-5.6-luna:preview");
    assert.equal(plan?.models[0].contextWindow, 272000);
  });
});

describe("buildPiModelRegistrationPlan (no plan — the cases that must stay untouched)", () => {
  it("writes NO entry for a model the provider already has built in", () => {
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/deepseek/deepseek-v4-flash"),
        fakeRegistry,
      ),
      undefined,
    );
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
      `${piModelsJsonProviderId(plan)}/${plan.models[0].id}`,
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
    assert.equal(plan?.models[0].id, "deepseek/deepseek-v4-flash:nitro");
    // Real metadata off the real base model, not Pi's generic defaults.
    assert.equal(plan?.models[0].reasoning, true);
    assert.ok((plan?.models[0].contextWindow ?? 0) > 128000);

    // A model the catalog offers stays Pi's own.
    assert.equal(
      buildPiModelRegistrationPlan(
        piRequest("openrouter/tencent/hy3"),
        registry,
      ),
      undefined,
    );
  });
});

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
