/**
 * The gateway credential on an in-process Pi session.
 *
 * A gateway route writes the credential header into models.json as a `$AGENTA_GATEWAY_CREDENTIALS_VALUE`
 * reference (`pi-model-config.ts`). A subprocess or Daytona harness expands it from its own process
 * environment. An in-process session has no process of its own, and the runner's `process.env` is
 * shared by every session of every organization, so the value must come from the session's own
 * runtime. Before this, every in-process gateway turn failed with "Failed to resolve provider ...
 * header X-AG-Credentials from environment variable: AGENTA_GATEWAY_CREDENTIALS_VALUE".
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "pi-coding-agent-pi-ai";
import type { AgentRunRequest } from "../../../src/protocol.ts";
import { buildPiModelConfigPlan, serializePiModelsJson } from "../../../src/engines/sandbox_agent/pi-model-config.ts";
import { GATEWAY_CREDENTIALS_VALUE_ENV } from "../../../src/engines/sandbox_agent/run-plan.ts";
import { createSessionModelRuntime } from "../../../src/engines/inprocess/pi/pi-session-factory.ts";

const HEADER = "X-AG-Credentials";

function gatewayRequest(slug: string, model: string, value: string): AgentRunRequest {
  return {
    harness: "pi_core",
    model,
    connection: { mode: "agenta", slug },
    modelConnection: {
      provider: "openai",
      deployment: "custom",
      credentialMode: "none",
      endpoint: { baseUrl: "https://gateway.example.test/gateways/llms/openai/v1" },
      gatewayCredentials: { header: HEADER, value },
    },
  } as unknown as AgentRunRequest;
}

/** The models.json the runner writes for the run, and the session runtime the harness host builds. */
async function sessionRuntime(request: AgentRunRequest, env?: Record<string, string>) {
  const plan = buildPiModelConfigPlan(request, {});
  if (!plan || !("providerId" in plan)) throw new Error("expected a custom-provider plan");
  const dir = mkdtempSync(join(tmpdir(), "inprocess-gateway-"));
  const modelsPath = join(dir, "models.json");
  const document = serializePiModelsJson(plan);
  writeFileSync(modelsPath, document);
  const runtime = await createSessionModelRuntime({
    credentials: new InMemoryCredentialStore(),
    modelsPath,
    modelEnv: {},
    customProvider: { providerId: plan.providerId, ...(env ? { env } : {}) },
  });
  const model = runtime.getModel(plan.providerId, plan.models[0]!.id);
  if (!model) throw new Error(`model ${plan.models[0]!.id} not registered`);
  return { runtime, model, document };
}

const CASES = [
  { name: "built-in Gemini (agenta connection)", slug: "agenta", model: "google/gemini-3.8-flash" },
  { name: "own-key OpenAI-compatible endpoint", slug: "openai-compatible-endpoint-0fbcbb114d58", model: "Fireworks/custom/kimi-k3-fast" },
  { name: "own-key Gemini as an OpenAI-compatible provider", slug: "gemini-4d2c1a", model: "gemini-3.8-flash" },
];

describe("in-process Pi: gateway credential header", () => {
  it.each(CASES)("$name: the header carries the session's own credential", async ({ slug, model }) => {
    const value = `ApiKey session-${slug}`;
    expect(process.env[GATEWAY_CREDENTIALS_VALUE_ENV]).toBeUndefined();
    const { runtime, model: m, document } = await sessionRuntime(gatewayRequest(slug, model, value), {
      [GATEWAY_CREDENTIALS_VALUE_ENV]: value,
    });
    const auth = await runtime.getAuth(m);
    expect(auth?.auth.headers?.[HEADER]).toBe(value);
    // The raw value is never on disk, and never in the shared process environment.
    expect(document).not.toContain(value);
    expect(process.env[GATEWAY_CREDENTIALS_VALUE_ENV]).toBeUndefined();
  });

  it("fails as before without the session credential (the production failure)", async () => {
    const { runtime, model } = await sessionRuntime(gatewayRequest("agenta", "google/gemini-3.8-flash", "ApiKey x"));
    await expect(runtime.getAuth(model)).rejects.toThrow(/AGENTA_GATEWAY_CREDENTIALS_VALUE/);
  });

  it("keeps two concurrent sessions on their own credentials", async () => {
    const [a, b] = await Promise.all(
      ["ApiKey org-a", "ApiKey org-b"].map((value) =>
        sessionRuntime(gatewayRequest("agenta", "google/gemini-3.8-flash", value), { [GATEWAY_CREDENTIALS_VALUE_ENV]: value }),
      ),
    );
    const [authA, authB] = await Promise.all([a!.runtime.getAuth(a!.model), b!.runtime.getAuth(b!.model)]);
    expect(authA?.auth.headers?.[HEADER]).toBe("ApiKey org-a");
    expect(authB?.auth.headers?.[HEADER]).toBe("ApiKey org-b");
  });
});
