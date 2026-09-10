/**
 * A subscription recovery that cannot complete must not take the turn down with it.
 *
 * The recovery reads and writes the login file, on Daytona through the sandbox's file API, and a
 * sandbox or a mount that died mid-turn makes that throw. `runTurn` asks it from two places, and
 * both sit ahead of the trace flush; one of them is inside the `catch` itself, where an unguarded
 * rejection would replace the run's real error with a filesystem one and skip the flush entirely.
 *
 * The rejection is injected at the module boundary because the throw sites need a terminal verdict
 * from the real provider, which a unit test has no way to produce.
 *
 * Run: pnpm exec vitest run --project unit tests/unit/subscription-recovery-throws.test.ts
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RECOVERY_FAILURE = new Error("sandbox filesystem is gone");

vi.mock("../../src/engines/sandbox_agent/subscription-recovery.ts", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/engines/sandbox_agent/subscription-recovery.ts")
  >("../../src/engines/sandbox_agent/subscription-recovery.ts");
  return {
    ...actual,
    recoverSubscriptionAuthFailure: async () => {
      throw RECOVERY_FAILURE;
    },
  };
});

const { runSandboxAgent } = await import("../../src/engines/sandbox_agent.ts");
const { resetRunnerConfigCache } = await import(
  "../../src/config/runner-config.ts"
);
const { fakeHarness } = await import("../utils/sandbox-agent-harness.ts");
const { makeLogin } = await import("../utils/subscription-login.ts");
type AgentRunRequest =
  import("../../src/protocol.ts").AgentRunRequest;

const CONNECTION_ID = "conn-throwing";
const PI_PROVIDER_KEY = "openai-codex";
const previousEnv: Record<string, string | undefined> = {};
let stateDir: string;

function stubEnv(name: string, value: string): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
  process.env[name] = value;
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "agenta-recovery-throws-"));
  stubEnv("AGENTA_RUNNER_STATE_DIR", stateDir);
  stubEnv("AGENTA_RUNNER_TOKEN", "test-runner-token");
  stubEnv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local");
  stubEnv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", "local");
  // No API to reach: a push that cannot be delivered is retried, never fatal, and this test is
  // about the turn's own exit path.
  stubEnv("AGENTA_API_INTERNAL_URL", "http://127.0.0.1:1");
  resetRunnerConfigCache();
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    delete previousEnv[name];
  }
  resetRunnerConfigCache();
});

function runRequest(): AgentRunRequest {
  const login = makeLogin({ expires: Date.now() + 3_600_000 });
  const home = join(stateDir, "subscriptions", CONNECTION_ID);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "auth.json"), JSON.stringify({ [PI_PROVIDER_KEY]: login }), {
    mode: 0o600,
  });
  return {
    harness: "pi_core",
    sandbox: "local",
    messages: [{ role: "user", content: "hello" }],
    model: "gpt-5",
    modelConnection: {
      provider: "openai",
      deployment: "direct",
      credentialMode: "runtime_provided",
      subscription: {
        id: CONNECTION_ID,
        slug: "chatgpt",
        provider: "chatgpt",
        version: 3,
        generation: 1,
        login,
      },
    },
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey run-cred" } } },
    },
  } as unknown as AgentRunRequest;
}

describe("a subscription recovery that throws", () => {
  it("ends the turn with its own error instead of rejecting", async () => {
    const { deps, logs } = fakeHarness({
      // Pi's own words for a login it cannot use, which is what asks for a recovery.
      promptError: new Error("Authentication failed for openai-codex"),
    });

    const result = await runSandboxAgent(
      runRequest(),
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    // The turn's own failure survives; the recovery's filesystem error does not reach the user.
    assert.doesNotMatch(String(result.error), /sandbox filesystem is gone/);
    // And the failure is recorded rather than swallowed. `thrownFields` keeps the class and the
    // frame; it never logs the message, which on this path can quote the credential.
    const recorded = logs.filter((line) => line.includes("verdict=threw"));
    assert.equal(recorded.length > 0, true, logs.join("\n"));
    assert.match(recorded[0] as string, /event=subscription\.recovery/);
    assert.match(recorded[0] as string, /error=Error/);
    assert.doesNotMatch(recorded[0] as string, /sandbox filesystem is gone/);
  });
});
