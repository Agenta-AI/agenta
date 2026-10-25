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
      models: [{ id: "gemini-3.8-flash" }],
      headers: { "X-AG-Credentials": "$AGENTA_GATEWAY_CREDENTIALS_VALUE" },
    });
  });

  it("writes the bare model without a thinking flag, and never the gateway credential", () => {
    const plan = buildPiModelConfigPlan(builtinGemini("gemini"), {});
    const document = JSON.parse(serializePiModelsJson(plan!));
    expect(document.providers.agenta).toMatchObject({
      api: "google-generative-ai",
      models: [{ id: "gemini-3.8-flash" }],
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

  // Computed with the code before the protocol existed: a connection without it keeps exactly
  // the session identity and runtime digest it had, so a deploy does not cold-start every session.
  const PRE_NATIVE_FINGERPRINT = "a76d5029d0aee3392a8558664ec1f336ac0f0d313d479edd1236d6e85c2a50a3";
  const PRE_NATIVE_RUNTIME = "467647048340a488f943ab80b7877eb1d1b9a2e27eee4886feceb3d4df363253";
  const runtime = (request: AgentRunRequest) => normalizeDesiredState(request, "fp").digests.runtime;

  it("keeps the identity a connection without the protocol had before it existed", () => {
    expect(configFingerprint(builtinGemini())).toBe(PRE_NATIVE_FINGERPRINT);
    expect(runtime(builtinGemini())).toBe(PRE_NATIVE_RUNTIME);
  });

  it("starts a new session and rebuilds a warm runtime when the protocol appears or goes", () => {
    expect(configFingerprint(builtinGemini("gemini"))).not.toBe(PRE_NATIVE_FINGERPRINT);
    expect(runtime(builtinGemini("gemini"))).not.toBe(PRE_NATIVE_RUNTIME);
  });
});

describe("Pi's Google client errors", () => {
  it("reads a native stream that broke off as a lost connection", () => {
    const raw = new Error("Internal error: Google stream ended without a finish reason");
    expect(classifyRunError(raw, "pi_core", "agenta", { unknownText: "hidden" }).message).toMatch(
      /lost its connection/,
    );
  });

  it("reads a native stream cut inside an event as a lost connection", () => {
    const raw = new Error("Internal error: Incomplete JSON segment at the end");
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

describe("Pi's Google client against the native route", () => {
  it("calls the gateway's native operation with our credential header and the placeholder key", async () => {
    const { streamSimple } = await import("pi-coding-agent-pi-ai/compat");
    const plan = buildPiModelConfigPlan(builtinGemini("gemini"), {})!;
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input instanceof Request ? input.url : input),
        headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      const event = {
        candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
      };
      return new Response(`data: ${JSON.stringify(event)}\r\n\r\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    try {
      const model = {
        id: plan.models[0].id,
        name: plan.models[0].id,
        api: plan.api,
        provider: plan.providerId,
        baseUrl: plan.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8000,
        headers: { "X-AG-Credentials": "Secret run-token" },
      };
      const stream = streamSimple(
        model as never,
        { systemPrompt: "Be terse.", messages: [{ role: "user", content: "hi", timestamp: 0 }] },
        { apiKey: plan.apiKey, reasoning: undefined, headers: { "X-AG-Credentials": "Secret run-token" } } as never,
      );
      for await (const _event of stream) {
        // drain
      }
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.example.test/api/gateways/llms/builtin/agenta/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
    );
    expect(calls[0].headers.get("x-ag-credentials")).toBe("Secret run-token");
    expect(calls[0].headers.get("x-goog-api-key")).toBe(GATEWAY_PLACEHOLDER_API_KEY);
    expect(calls[0].body).toMatchObject({
      systemInstruction: { parts: [{ text: "Be terse." }] },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    // No thinking setting: the gateway gives the request its LOW default.
    expect(JSON.stringify(calls[0].body)).not.toContain("thinking");
  });
});
