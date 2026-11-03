/**
 * A run on a Claude subscription: the setup-token rides as `CLAUDE_CODE_OAUTH_TOKEN`.
 *
 * Delivery needs no runner change, so the first half pins that it holds: the token reaches the
 * Claude daemon with no API key, and on Daytona it becomes a Secret for `api.anthropic.com`. The
 * second half pins how a refused token is reported. `claude-agent-acp` turns Claude Code's 401
 * into the ACP `authRequired()` error, so the runner sees "Authentication required" (JSON-RPC
 * -32000) and no status at all.
 *
 * Run: pnpm exec vitest run tests/unit/claude-subscription-token.test.ts
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import {
  CLAUDE_SUBSCRIPTION_TOKEN_REFUSED_MESSAGE,
  classifyRunError,
} from "../../src/engines/sandbox_agent/errors.ts";
import { buildRunPlan } from "../../src/engines/sandbox_agent/run-plan.ts";
import type {
  AgentEvent,
  AgentRunRequest,
  ModelConnection,
} from "../../src/protocol.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";

/** Not a token shape: a real-looking one trips the repository's secret scanner. */
const TOKEN = "the claude setup-token under test";

const tokenConnection: ModelConnection = {
  provider: "anthropic",
  deployment: "direct",
  endpoint: { baseUrl: "https://api.anthropic.com" },
  credentialMode: "env",
  credentials: [
    {
      binding: { kind: "environment", name: "CLAUDE_CODE_OAUTH_TOKEN" },
      value: TOKEN,
      usage: "opaque_http",
    },
  ],
};

const apiKeyConnection: ModelConnection = {
  ...tokenConnection,
  credentials: [
    {
      binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
      value: "an anthropic key under test",
      usage: "opaque_http",
    },
  ],
};

const request = (
  sandbox: "local" | "daytona",
  modelConnection: ModelConnection = tokenConnection,
): AgentRunRequest => ({
  harness: "claude",
  sandbox,
  messages: [{ role: "user", content: "hello" }],
  modelConnection,
});

/** The refusal exactly as the ACP adapter raises it. */
const authRequired = () =>
  Object.assign(new Error("Authentication required"), { code: -32000 });

/** What both call sites hand the classifier, minus the Codex mount check. */
const classify = (err: unknown, modelConnection: ModelConnection) =>
  classifyRunError(err, "claude", "anthropic", { modelConnection });

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  resetRunnerConfigCache();
});

describe("a Claude token run's credential", () => {
  it("reaches the local Claude daemon as the token, with no API key", () => {
    const built = buildRunPlan(request("local"));

    assert.equal(built.ok, true, (built as { error?: string }).error);
    if (!built.ok) return;
    const environment = built.plan.credentials.modelEnvironment;
    assert.equal(environment.CLAUDE_CODE_OAUTH_TOKEN, TOKEN);
    assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  });

  it("becomes a Daytona Secret for api.anthropic.com and leaves the plaintext environment", () => {
    const built = buildRunPlan(request("daytona"), {
      createDaytonaCwd: () => "/sandbox/cwd",
    });

    assert.equal(built.ok, true, (built as { error?: string }).error);
    if (!built.ok) return;
    assert.equal(
      built.plan.credentials.modelEnvironment.CLAUDE_CODE_OAUTH_TOKEN,
      undefined,
    );
    assert.deepEqual(
      built.plan.credentials.daytonaSecretPlan?.candidates.map((candidate) => ({
        consumer: candidate.consumer,
        binding: candidate.binding.name,
        host: candidate.allowedHost,
      })),
      [
        {
          consumer: { kind: "model" },
          binding: "CLAUDE_CODE_OAUTH_TOKEN",
          host: "api.anthropic.com",
        },
      ],
    );
  });
});

describe("a refused Claude token", () => {
  it("reports the adapter's authRequired refusal as subscription_login_required", () => {
    const classified = classify(authRequired(), tokenConnection);

    assert.equal(classified.code, "subscription_login_required");
    assert.equal(classified.message, CLAUDE_SUBSCRIPTION_TOKEN_REFUSED_MESSAGE);
    assert.equal(classified.detail?.code, "subscription_login_required");
    assert.equal(classified.detail?.retryable, false);
  });

  it("reports the authRequired refusal the same way on a fresh Daytona Secret", () => {
    // The adapter's refusal carries no 401, so the delivery-race reading never claims it.
    const classified = classifyRunError(authRequired(), "claude", "anthropic", {
      modelConnection: tokenConnection,
      daytonaCredentialFresh: () => true,
    });

    assert.equal(classified.code, "subscription_login_required");
    assert.equal(classified.detail?.code, "subscription_login_required");
  });

  it("reports a provider 401 the same way", () => {
    const classified = classify(
      new Error('401 {"type":"error","error":{"type":"authentication_error"}}'),
      tokenConnection,
    );

    assert.equal(classified.code, "subscription_login_required");
  });

  it("does not read a runner call's 401 as a refused token", () => {
    const classified = classify(
      new Error("tool call ref-1 failed: HTTP 401"),
      tokenConnection,
    );

    assert.equal(classified.code, "runner_error");
    assert.notEqual(
      classified.message,
      CLAUDE_SUBSCRIPTION_TOKEN_REFUSED_MESSAGE,
    );
  });

  it("does not read an unrelated 'unauthorized' as a refused token", () => {
    const classified = classify(
      new Error("the mount answered unauthorized"),
      tokenConnection,
    );

    assert.equal(classified.code, "runner_error");
  });

  it("keeps an API key run's own advice", () => {
    const classified = classify(authRequired(), apiKeyConnection);

    assert.equal(classified.code, "runner_error");
    assert.match(classified.message, /add the project's Anthropic key/);
    assert.equal(classified.detail, undefined);
  });

  it("carries the code in the live error event and in the final result's errorDetail", async () => {
    const { deps, events } = fakeHarness({ promptError: authRequired() });

    const result = await runSandboxAgent(
      request("local"),
      undefined,
      undefined,
      deps,
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, CLAUDE_SUBSCRIPTION_TOKEN_REFUSED_MESSAGE);
    assert.equal(result.errorDetail?.code, "subscription_login_required");
    const errors = events.filter(
      (event: AgentEvent) => event.type === "error",
    ) as Array<Extract<AgentEvent, { type: "error" }>>;
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, "subscription_login_required");
    assert.equal(errors[0]!.detail?.code, "subscription_login_required");
  });
});
