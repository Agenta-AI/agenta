/**
 * Built-in model metadata on a custom-provider `models.json` entry must survive Pi's own loader.
 *
 * A managed custom connection registers its model under the connection slug with no metadata of
 * its own, so Pi fell back to a generic 128000-token window. On a session past that, pi-ai's
 * `clampMaxTokensToContext` floors `max_tokens` to 1 and the agent answers nothing. The runner now
 * carries the built-in definition onto the entry (`pi-model-config.ts`, `findBuiltinModel`); this
 * test holds the property that Pi actually READS it — not merely that the runner writes it.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "pi-coding-agent-pi-ai";
import type { AgentRunRequest } from "../../../src/protocol.ts";
import {
  buildPiModelConfigPlan,
  serializePiModelsJson,
} from "../../../src/engines/sandbox_agent/pi-model-config.ts";
import type {
  PiBuiltinModel,
  PiBuiltinRegistry,
} from "../../../src/engines/sandbox_agent/pi-builtin-registry.ts";
import { createSessionModelRuntime } from "../../../src/engines/inprocess/pi/pi-session-factory.ts";

/** `deepseek-flash` as Pi's own catalog carries it: a 1M/384K reasoning model. */
const DEEPSEEK_FLASH: PiBuiltinModel = {
  id: "deepseek-flash",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  compat: { thinkingFormat: "deepseek", maxTokensField: "max_tokens" },
  reasoning: true,
  contextWindow: 1000000,
  maxTokens: 384000,
};

const registry: PiBuiltinRegistry = {
  providers: () => ["deepseek"],
  hasProvider: (provider) => provider === "deepseek",
  models: (provider) => (provider === "deepseek" ? [DEEPSEEK_FLASH] : []),
};

function request(model: string, baseUrl: string): AgentRunRequest {
  return {
    harness: "pi_core",
    model,
    connection: { mode: "agenta", slug: "deepseek-conn" },
    modelConnection: {
      provider: "openai",
      deployment: "custom",
      credentialMode: "none",
      endpoint: { baseUrl },
      gatewayCredentials: { header: "X-AG-Credentials", value: "ApiKey x" },
    },
  } as unknown as AgentRunRequest;
}

/** Resolve the model the way a run does: write models.json, then load it through the harness host. */
async function resolveModel(model: string, baseUrl: string, withRegistry: boolean) {
  const plan = buildPiModelConfigPlan(
    request(model, baseUrl),
    {},
    withRegistry ? registry : undefined,
  );
  if (!plan || !("providerId" in plan)) throw new Error("expected a custom-provider plan");
  const dir = mkdtempSync(join(tmpdir(), "pi-model-metadata-"));
  const modelsPath = join(dir, "models.json");
  writeFileSync(modelsPath, serializePiModelsJson(plan));
  const runtime = await createSessionModelRuntime({
    credentials: new InMemoryCredentialStore(),
    modelsPath,
    modelEnv: {},
    customProvider: { providerId: plan.providerId },
  });
  return runtime.getModel(plan.providerId, plan.models[0]!.id);
}

describe("in-process Pi: custom-provider model metadata reaches the harness", () => {
  it("resolves the built-in context window, not Pi's 128K default", async () => {
    const model = await resolveModel(
      "openai/deepseek-flash",
      "https://api.deepseek.com",
      true,
    );
    if (!model) throw new Error("model not registered");
    expect(model.contextWindow).toBe(1000000);
    expect(model.maxTokens).toBe(384000);
  });

  it("keeps Pi's default window when the registry has no match", async () => {
    const model = await resolveModel(
      "openai/deepseek-flash",
      "https://api.deepseek.com",
      false,
    );
    if (!model) throw new Error("model not registered");
    expect(model.contextWindow).toBe(128000);
    expect(model.maxTokens).toBe(16384);
  });
});
