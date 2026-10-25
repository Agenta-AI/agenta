/**
 * The built-in Gemini route served in Google's native protocol (`docs/design/gemini-native-door`):
 * when the connection names `protocol: "gemini"`, Pi drives it with its Google client.
 */
import { describe, expect, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { buildPiModelConfigPlan, serializePiModelsJson } from "../../src/engines/sandbox_agent/pi-model-config.ts";
import { GATEWAY_PLACEHOLDER_API_KEY } from "../../src/extensions/model-provider-override.ts";
import { classifyRunError } from "../../src/engines/sandbox_agent/errors.ts";
import { configFingerprint } from "../../src/engines/sandbox_agent/session-identity.ts";
import { normalizeDesiredState } from "../../src/lifecycle/desired-state.ts";

const GATEWAY = "https://api.example.test/api/gateways/llms/builtin/agenta/v1";

function builtinGemini(protocol?: string): AgentRunRequest {
  return {
    harness: "pi_core",
    connection: { mode: "agenta", slug: "agenta", namespace: "builtin" } as AgentRunRequest["connection"],
    model: "openai/google/gemini-3.8-flash",
    modelConnection: {
      provider: "openai",
      deployment: "custom",
      endpoint: { baseUrl: GATEWAY },
      credentialMode: "none",
      credentials: [],
      gatewayCredentials: { header: "X-AG-Credentials", value: "Secret run-token" },
      ...(protocol ? { protocol } : {}),
    },
  };
}

describe("the built-in Gemini route in Google's native protocol", () => {
  it("registers Pi's Google client on the versioned native base, with the bare model id", () => {
    expect(buildPiModelConfigPlan(builtinGemini("gemini"), {})).toEqual({
      providerId: "agenta",
      providerFamily: "openai",
      api: "google-generative-ai",
      baseUrl: "https://api.example.test/api/gateways/llms/builtin/agenta/v1beta",
      apiKey: GATEWAY_PLACEHOLDER_API_KEY,
      apiKeyEnv: "OPENAI_API_KEY",
      models: [{ id: "gemini-3.8-flash", reasoning: true }],
      headers: { "X-AG-Credentials": "$AGENTA_GATEWAY_CREDENTIALS_VALUE" },
    });
  });

  it("writes the model as one that thinks, and never the gateway credential", () => {
    const plan = buildPiModelConfigPlan(builtinGemini("gemini"), {});
    const document = JSON.parse(serializePiModelsJson(plan!));
    expect(document.providers.agenta).toMatchObject({
      api: "google-generative-ai",
      models: [{ id: "gemini-3.8-flash", reasoning: true }],
    });
    expect(serializePiModelsJson(plan!)).not.toContain("run-token");
  });

  it("keeps the OpenAI-compatible route when the connection names no protocol", () => {
    expect(buildPiModelConfigPlan(builtinGemini(), {})).toMatchObject({
      api: "openai-completions",
      baseUrl: GATEWAY,
      models: [{ id: "google/gemini-3.8-flash" }],
    });
  });

  it("keeps the OpenAI-compatible route for a protocol it does not know", () => {
    expect(buildPiModelConfigPlan(builtinGemini("anthropic"), {})).toMatchObject({ api: "openai-completions" });
  });

  it("starts a new session identity when the protocol appears, and keeps the old one without it", () => {
    const without = configFingerprint(builtinGemini());
    const again = configFingerprint(builtinGemini());
    const native = configFingerprint(builtinGemini("gemini"));
    expect(again).toEqual(without);
    expect(native).not.toEqual(without);
  });

  it("rebuilds a warm runtime when the protocol appears, and keeps it without it", () => {
    const runtime = (request: AgentRunRequest) => normalizeDesiredState(request, "fp").digests.runtime;
    expect(runtime(builtinGemini())).toEqual(runtime(builtinGemini()));
    expect(runtime(builtinGemini("gemini"))).not.toEqual(runtime(builtinGemini()));
  });
});

describe("Pi's Google client errors", () => {
  it("reads a native stream that broke off as a lost connection", () => {
    const raw = new Error("Internal error: Google stream ended without a finish reason");
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" }).message).toMatch(
      /lost its connection/,
    );
  });

  it("reads a native malformed tool call like the OpenAI client's", () => {
    const raw = new Error("Internal error: Provider stopped with: MALFORMED_FUNCTION_CALL");
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" })).toMatchObject({
      code: "upstream_error",
    });
  });
});
