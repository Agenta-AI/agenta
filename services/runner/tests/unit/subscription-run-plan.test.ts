/**
 * Unit tests for the hosted subscription half of `buildRunPlan`, the session fingerprint, and the
 * auth-failure classification.
 *
 * The point of every case here is the same distinction: `modelConnection.subscription` is what
 * separates a HOSTED subscription run from the OPERATOR-mount run the runner already served, and
 * the operator-mount rules must not move.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-run-plan.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentRunRequest, ModelConnectionSubscription } from "../../src/protocol.ts";
import {
  buildRunPlan,
  DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE,
  LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE,
  runnerStateDir,
  subscriptionHomeDir,
  SUBSCRIPTION_INVALID_MESSAGE,
  SUBSCRIPTION_UNSUPPORTED_MESSAGE,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import { configFingerprint } from "../../src/engines/sandbox_agent/session-identity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import {
  isSubscriptionAuthFailure,
  subscriptionAuthError,
  subscriptionAuthFailureReason,
  SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
  SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
} from "../../src/engines/sandbox_agent/errors.ts";

const SUBSCRIPTION: ModelConnectionSubscription = {
  id: "conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 3,
  generation: 1,
  login: {
    type: "oauth",
    access: "access",
    refresh: "refresh",
    expires: 1_800_000_000_000,
    accountId: "acct_1",
  },
};

function request(
  overrides: {
    sandbox?: string;
    subscription?: ModelConnectionSubscription;
    credentialMode?: "env" | "runtime_provided" | "none";
  } = {},
): AgentRunRequest {
  return {
    harness: "pi_core",
    sandbox: overrides.sandbox ?? "local",
    messages: [{ role: "user", content: "hello" }],
    modelConnection: {
      provider: "openai-codex",
      deployment: "gpt-5.4-mini",
      credentialMode: overrides.credentialMode ?? "runtime_provided",
      credentials: [],
      ...(overrides.subscription
        ? { subscription: overrides.subscription }
        : {}),
    },
  } as AgentRunRequest;
}

const previousPiDir = process.env.PI_CODING_AGENT_DIR;
const previousStateDir = process.env.AGENTA_RUNNER_STATE_DIR;

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiDir;
  if (previousStateDir === undefined) delete process.env.AGENTA_RUNNER_STATE_DIR;
  else process.env.AGENTA_RUNNER_STATE_DIR = previousStateDir;
});

describe("buildRunPlan with a hosted subscription", () => {
  it("allows a local run with no operator mount configured", () => {
    delete process.env.PI_CODING_AGENT_DIR;

    const result = buildRunPlan(request({ subscription: SUBSCRIPTION }), {
      createLocalCwd: () => "/tmp/agenta-test-cwd",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.credentials.credentialMode, "runtime_provided");
    assert.deepEqual(result.plan.credentials.subscription, SUBSCRIPTION);
    assert.equal(
      result.plan.credentials.subscriptionHome,
      join(runnerStateDir(), "subscriptions", "conn-1"),
    );
  });

  it("allows a Daytona run and points the home at in-VM disk", () => {
    let created = false;

    const result = buildRunPlan(
      request({ sandbox: "daytona", subscription: SUBSCRIPTION }),
      {
        createDaytonaCwd: () => {
          created = true;
          return "/home/sandbox/agenta-test";
        },
      },
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(created, true);
    assert.equal(
      result.plan.credentials.subscriptionHome,
      "/home/sandbox/agenta/subscriptions/conn-1",
      "the login lives on in-VM disk, never on the geesefs cwd",
    );
  });

  it("honors AGENTA_RUNNER_STATE_DIR for the local home", () => {
    process.env.AGENTA_RUNNER_STATE_DIR = "/var/lib/agenta-runner";
    assert.equal(
      subscriptionHomeDir("conn-1", false),
      "/var/lib/agenta-runner/subscriptions/conn-1",
    );
    delete process.env.AGENTA_RUNNER_STATE_DIR;
    assert.equal(
      subscriptionHomeDir("conn-1", false),
      join(tmpdir(), "agenta", "runner-state", "subscriptions", "conn-1"),
    );
  });

  it("refuses a subscription whose id is not a plain path segment", () => {
    const result = buildRunPlan(
      request({ subscription: { ...SUBSCRIPTION, id: "../../etc" } }),
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, SUBSCRIPTION_INVALID_MESSAGE);
  });

  /**
   * The runner's own wire boundary. A direct `/run` caller never passes through the SDK resolver
   * that already refuses these pairs, and the runner writes a ChatGPT-shaped `auth.json` into a Pi
   * agent dir: no other harness reads that file, and Pi has no login format for another product.
   */
  it("refuses a subscription on a harness that is not Pi", () => {
    const result = buildRunPlan(
      {
        ...request({ subscription: SUBSCRIPTION }),
        harness: "claude_code",
      } as AgentRunRequest,
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, SUBSCRIPTION_UNSUPPORTED_MESSAGE);
  });

  it("refuses a subscription for a product family other than ChatGPT", () => {
    const result = buildRunPlan(
      request({ subscription: { ...SUBSCRIPTION, provider: "claude" } }),
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, SUBSCRIPTION_UNSUPPORTED_MESSAGE);
  });

  it("accepts the provider name whatever its case and spacing", () => {
    const result = buildRunPlan(
      request({ subscription: { ...SUBSCRIPTION, provider: " ChatGPT " } }),
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, true);
  });

  it("refuses a subscription with an unusable login instead of falling back to the mount", () => {
    process.env.PI_CODING_AGENT_DIR = "/pi-agent";
    const result = buildRunPlan(
      request({
        subscription: {
          ...SUBSCRIPTION,
          login: { ...SUBSCRIPTION.login, refresh: "" },
        },
      }),
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, SUBSCRIPTION_INVALID_MESSAGE);
  });

  it("refuses a subscription sent with a managed credential mode", () => {
    const result = buildRunPlan(
      request({ credentialMode: "env", subscription: SUBSCRIPTION }),
      { createLocalCwd: () => "/tmp/agenta-test-cwd" },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /requires credentialMode 'runtime_provided'/);
  });
});

describe("buildRunPlan without a subscription keeps the operator-mount rules", () => {
  it("still rejects a Daytona runtime_provided run", () => {
    const result = buildRunPlan(request({ sandbox: "daytona" }), {
      createDaytonaCwd: () => "/home/sandbox/should-not-happen",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE);
  });

  it("still requires PI_CODING_AGENT_DIR for a local run", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    const result = buildRunPlan(request(), {
      createLocalCwd: () => "/tmp/agenta-test-cwd",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE);
  });

  it("carries no subscription home on a plain operator-mount run", () => {
    process.env.PI_CODING_AGENT_DIR = "/pi-agent";
    const result = buildRunPlan(request(), {
      createLocalCwd: () => "/tmp/agenta-test-cwd",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.credentials.subscriptionHome, undefined);
    assert.equal(result.plan.credentials.subscription, undefined);
  });
});

describe("configFingerprint and a hosted subscription", () => {
  it("changes when the connection changes, so a warm session cannot serve another account", () => {
    const first = configFingerprint(request({ subscription: SUBSCRIPTION }));
    const second = configFingerprint(
      request({ subscription: { ...SUBSCRIPTION, id: "conn-2" } }),
    );
    assert.notEqual(first, second);
  });

  it("changes when the user signs in again, because Pi never re-reads its cached token", () => {
    const first = configFingerprint(request({ subscription: SUBSCRIPTION }));
    const second = configFingerprint(
      request({ subscription: { ...SUBSCRIPTION, generation: 2 } }),
    );
    assert.notEqual(first, second);
  });

  it("does NOT change on a background refresh, so warm reuse survives it", () => {
    const first = configFingerprint(request({ subscription: SUBSCRIPTION }));
    const second = configFingerprint(
      request({
        subscription: {
          ...SUBSCRIPTION,
          version: 9,
          login: { ...SUBSCRIPTION.login, access: "rotated", expires: 2 },
        },
      }),
    );
    assert.equal(first, second);
  });
});

describe("subscription auth failure classification", () => {
  it("recognizes each of Pi's own words for an unusable login", () => {
    const messages = [
      'Authentication failed for "openai-codex". Credentials may have expired or network is unavailable.',
      "Failed to refresh OAuth token for openai-codex",
      "No API key found for openai-codex.",
      "Request failed with status 401",
    ];
    for (const message of messages) {
      assert.equal(
        isSubscriptionAuthFailure(new Error(message)),
        true,
        `not recognized: ${message}`,
      );
    }
  });

  it("does not read the runner's own 401 as a dead sign-in", () => {
    assert.equal(
      isSubscriptionAuthFailure(
        new Error("tool call abc failed: HTTP 401 Unauthorized"),
      ),
      false,
    );
    assert.equal(
      isSubscriptionAuthFailure(new Error("session records persist failed: 401")),
      false,
    );
  });

  it("does not fire on an unrelated failure", () => {
    assert.equal(
      isSubscriptionAuthFailure(new Error("the sandbox is gone")),
      false,
    );
  });

  it("reduces the harness sentence to a closed set of reasons", () => {
    assert.equal(
      subscriptionAuthFailureReason(
        new Error("Failed to refresh OAuth token for openai-codex"),
      ),
      "refresh_rejected",
    );
    assert.equal(
      subscriptionAuthFailureReason(
        new Error("No API key found for openai-codex."),
      ),
      "login_missing",
    );
    assert.equal(
      subscriptionAuthFailureReason(
        new Error('Authentication failed for "openai-codex".'),
      ),
      "auth_failed",
    );
    assert.equal(
      subscriptionAuthFailureReason(new Error("HTTP 401")),
      "unauthorized",
    );
  });

  it("maps the API's stale answer to the retryable code", () => {
    assert.deepEqual(subscriptionAuthError(true), {
      message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
      code: "subscription_login_refreshed",
    });
    assert.deepEqual(subscriptionAuthError(false), {
      message: SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
      code: "subscription_login_required",
    });
  });

  it("keeps tokens and paths out of both messages", () => {
    for (const message of [
      SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
      SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
    ]) {
      assert.ok(!message.includes("/"), message);
      assert.ok(!/token|access|refresh/i.test(message), message);
    }
  });
});
