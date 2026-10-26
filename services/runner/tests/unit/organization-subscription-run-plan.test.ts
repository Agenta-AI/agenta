/**
 * An organization subscription login (M5) runs only on the `inprocess` engine, where the login
 * stays in the runner process. The `daytona` and `local` engines would write it where agent code
 * can read it, so they refuse the run. It arrives in its own field, so a runner older than M5
 * never reads it.
 *
 * Run: pnpm exec vitest run tests/unit/organization-subscription-run-plan.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type {
  AgentRunRequest,
  ModelConnectionSubscription,
} from "../../src/protocol.ts";
import {
  buildRunPlan,
  ORGANIZATION_SUBSCRIPTION_ENGINE_MESSAGE,
} from "../../src/engines/sandbox_agent/run-plan.ts";
import { configFingerprint } from "../../src/engines/sandbox_agent/session-identity.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

const LOGIN: ModelConnectionSubscription = {
  id: "org-conn-1",
  slug: "chatgpt",
  provider: "chatgpt",
  version: 2,
  generation: 1,
  login: {
    type: "oauth",
    access: "access",
    refresh: "refresh",
    expires: 1_800_000_000_000,
    accountId: "acct_org",
  },
};

function request(
  sandbox: string,
  extra: Partial<AgentRunRequest["modelConnection"]> = {},
) {
  return {
    harness: "pi_core",
    sandbox,
    messages: [{ role: "user", content: "hello" }],
    modelConnection: {
      provider: "openai-codex",
      deployment: "gpt-5.4-mini",
      credentialMode: "runtime_provided",
      credentials: [],
      organizationSubscription: LOGIN,
      ...extra,
    },
  } as AgentRunRequest;
}

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS =
    "local,daytona,inprocess";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  resetRunnerConfigCache();
});

describe("an organization subscription login", () => {
  it("runs on the inprocess engine, as the organization's login", () => {
    const result = buildRunPlan(request("inprocess"), {
      sandboxProvider: "inprocess",
      enabledProviders: ["local", "daytona", "inprocess"],
    });
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (!result.ok) return;
    assert.equal(result.plan.credentials.subscriptionOwner, "organization");
    assert.equal(result.plan.credentials.subscription?.id, "org-conn-1");
    assert.equal(result.plan.credentials.subscription?.owner, "organization");
  });

  for (const sandbox of ["daytona", "local"]) {
    it(`is refused on the ${sandbox} engine`, () => {
      const result = buildRunPlan(request(sandbox), {
        sandboxProvider: sandbox,
        enabledProviders: ["local", "daytona", "inprocess"],
        createLocalCwd: () => "/tmp/agenta-test-cwd",
        createDaytonaCwd: () => "/home/sandbox/agenta-test",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error, ORGANIZATION_SUBSCRIPTION_ENGINE_MESSAGE);
    });
  }

  it("is refused beside a project subscription or another credential mode", () => {
    for (const extra of [
      { subscription: LOGIN },
      { credentialMode: "env" as const },
    ]) {
      const result = buildRunPlan(request("inprocess", extra), {
        sandboxProvider: "inprocess",
        enabledProviders: ["inprocess"],
      });
      assert.equal(result.ok, false);
    }
  });

  it("is refused for a harness other than Pi", () => {
    const run = {
      ...request("inprocess"),
      harness: "claude",
    } as AgentRunRequest;
    const result = buildRunPlan(run, {
      sandboxProvider: "inprocess",
      enabledProviders: ["inprocess"],
    });
    assert.equal(result.ok, false);
  });

  it("enters the session fingerprint like a project login", () => {
    const first = configFingerprint(request("inprocess"));
    const other = configFingerprint(
      request("inprocess", {
        organizationSubscription: { ...LOGIN, generation: 2 },
      }),
    );
    assert.notEqual(first, other);
  });
});
