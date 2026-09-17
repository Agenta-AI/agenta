/**
 * Unit tests for the hosted subscription device-login attempt state machine.
 *
 * The provider is mocked: `SubscriptionLoginAttempts` takes the login function as a constructor
 * argument precisely so these run with no network and no OAuth.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-login-attempts.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  SubscriptionLoginAttempts,
  type DeviceCodeInfo,
} from "../../src/subscription-login-attempts.ts";

const LOGIN = {
  access: "access-token",
  refresh: "refresh-token",
  expires: 1_800_000_000_000,
  accountId: "acct_1",
};

/** A login function whose device code fires at once and whose approval the test resolves. */
function controllableLogin(info: Partial<DeviceCodeInfo> = {}) {
  let approve: (value: typeof LOGIN) => void = () => {};
  let refuse: (err: unknown) => void = () => {};
  const login = (options: {
    onDeviceCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }) => {
    options.onDeviceCode({
      userCode: "ABCD-1234",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSeconds: 7,
      expiresInSeconds: 900,
      ...info,
    });
    return new Promise<typeof LOGIN>((resolve, reject) => {
      approve = resolve;
      refuse = reject;
      options.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  };
  return {
    login,
    approve: (value = LOGIN) => approve(value),
    refuse: (err: unknown) => refuse(err),
  };
}

/** Lets the microtask queue drain so a settled login promise has recorded its outcome. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SubscriptionLoginAttempts", () => {
  it("returns the user code as soon as the provider issues it, still pending", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(provider.login, () => {});

    const started = await attempts.start("chatgpt");

    assert.equal(started.state, "pending");
    assert.equal(started.userCode, "ABCD-1234");
    assert.equal(
      started.verificationUri,
      "https://auth.openai.com/codex/device",
    );
    assert.equal(started.intervalSeconds, 7);
    assert.ok(started.expiresAt);
    assert.equal(started.login, undefined);
  });

  it("hands the login out on every read until the API deletes the attempt", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(provider.login, () => {});
    const { attemptId } = await attempts.start("chatgpt");

    // Before approval the attempt is pending and carries no credential.
    assert.equal(attempts.get(attemptId)?.state, "pending");
    assert.equal(attempts.get(attemptId)?.login, undefined);

    provider.approve();
    await settle();

    const first = attempts.get(attemptId);
    assert.equal(first?.state, "succeeded");
    // `type` is stamped on, so the vault stores the file-ready Pi shape.
    assert.deepEqual(first?.login, { type: "oauth", ...LOGIN });

    // A second poll must still get the credential. The API stores it durably and only then
    // deletes; consuming it on the first read lost logins whose response never arrived.
    const second = attempts.get(attemptId);
    assert.equal(second?.state, "succeeded");
    assert.deepEqual(
      second?.login,
      { type: "oauth", ...LOGIN },
      "the login stays readable until the API deletes the attempt",
    );

    attempts.cancel(attemptId);
    assert.equal(
      attempts.get(attemptId),
      undefined,
      "the DELETE is what ends the credential's life in this process",
    );
  });

  it("reports a refused login as failed with a reason that quotes nothing", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(provider.login, () => {});
    const { attemptId } = await attempts.start("chatgpt");

    provider.refuse(
      new Error("device code POST failed: user_code=ABCD-1234 secret=xyz"),
    );
    await settle();

    const view = attempts.get(attemptId);
    assert.equal(view?.state, "failed");
    assert.equal(view?.error, "login_failed");
  });

  it("reports a provider timeout as expired", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(provider.login, () => {});
    const { attemptId } = await attempts.start("chatgpt");

    provider.refuse(new Error("Device code login timed out"));
    await settle();

    assert.equal(attempts.get(attemptId)?.state, "expired");
  });

  it("aborts the flow on cancel and forgets the attempt", async () => {
    let aborted = false;
    const login = (options: {
      onDeviceCode: (info: DeviceCodeInfo) => void;
      signal?: AbortSignal;
    }) => {
      options.onDeviceCode({
        userCode: "WXYZ-9999",
        verificationUri: "https://auth.openai.com/codex/device",
      });
      return new Promise<typeof LOGIN>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    };
    const attempts = new SubscriptionLoginAttempts(login, () => {});
    const { attemptId } = await attempts.start("chatgpt");

    attempts.cancel(attemptId);
    await settle();

    assert.equal(aborted, true, "the AbortController stops the provider poll");
    assert.equal(attempts.get(attemptId), undefined);
    assert.equal(attempts.size(), 0);
    // A repeated cancel is a no-op, so the route stays idempotent.
    attempts.cancel(attemptId);
  });

  it("fails the start when the provider never issues a device code", async () => {
    const login = () => Promise.reject(new Error("bad client id"));
    const attempts = new SubscriptionLoginAttempts(login, () => {});

    await assert.rejects(
      () => attempts.start("chatgpt"),
      /subscription login could not start: login_failed/,
    );
    // A start that never became actionable leaves nothing behind for the API to poll.
    assert.equal(attempts.size(), 0);
  });

  it("purges a settled attempt after the purge window", async () => {
    const provider = controllableLogin();
    const attempts = new SubscriptionLoginAttempts(provider.login, () => {}, 5);
    const { attemptId } = await attempts.start("chatgpt");

    provider.approve();
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(
      attempts.get(attemptId),
      undefined,
      "an unread login does not sit in memory for the life of the process",
    );
  });
});
