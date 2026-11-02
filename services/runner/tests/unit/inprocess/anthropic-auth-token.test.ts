/**
 * The Anthropic bearer token on an in-process Pi session.
 *
 * A direct Anthropic connection may carry `ANTHROPIC_AUTH_TOKEN` instead of an API key. pi-ai reads
 * that token only from its auth context (`anthropicApiKeyAuth().resolve`), whose default reads
 * `process.env`, which every in-process session of every organization shares. Each session's
 * runtime gets its own auth context (`sessionAuthContext`), through the `authContext` option the
 * runner's Pi patch adds to `ModelRuntime.create`.
 */
import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "pi-coding-agent-pi-ai";
import { createSessionModelRuntime } from "../../../src/engines/inprocess/pi/pi-session-factory.ts";

async function anthropicAuth(modelEnv: Record<string, string>) {
  const runtime = await createSessionModelRuntime({ credentials: new InMemoryCredentialStore(), modelsPath: undefined, modelEnv });
  const model = runtime.getModels("anthropic")[0];
  if (!model) throw new Error("no anthropic model registered");
  return { runtime, auth: await runtime.getAuth(model) };
}

describe("in-process Pi: Anthropic bearer token", () => {
  it("sends the session's token as a bearer header, and the provider counts as configured", async () => {
    const { runtime, auth } = await anthropicAuth({ ANTHROPIC_AUTH_TOKEN: "token-a" });
    expect(auth?.auth.headers?.Authorization).toBe("Bearer token-a");
    expect(auth?.auth.apiKey).toBeUndefined();
    // The prompt's own auth check reads the availability snapshot.
    expect(runtime.hasConfiguredAuth("anthropic")).toBe(true);
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("sends the token, not the API key, when the run has both (pi-ai's own order)", async () => {
    const { auth } = await anthropicAuth({ ANTHROPIC_AUTH_TOKEN: "token-a", ANTHROPIC_API_KEY: "sk-ant-a" });
    expect(auth?.auth.headers?.Authorization).toBe("Bearer token-a");
    expect(auth?.auth.apiKey).toBeUndefined();
  });

  it("still sends an API key alone as the API key", async () => {
    const { auth } = await anthropicAuth({ ANTHROPIC_API_KEY: "sk-ant-a" });
    expect(auth?.auth.apiKey).toBe("sk-ant-a");
    expect(auth?.auth.headers?.Authorization).toBeUndefined();
  });

  it("keeps two concurrent sessions on their own tokens", async () => {
    const [a, b] = await Promise.all([anthropicAuth({ ANTHROPIC_AUTH_TOKEN: "token-org-a" }), anthropicAuth({ ANTHROPIC_AUTH_TOKEN: "token-org-b" })]);
    expect(a.auth?.auth.headers?.Authorization).toBe("Bearer token-org-a");
    expect(b.auth?.auth.headers?.Authorization).toBe("Bearer token-org-b");
    // A session without a token gets none from another session.
    const { runtime } = await anthropicAuth({});
    expect(runtime.hasConfiguredAuth("anthropic")).toBe(false);
  });
});
