/**
 * Unit tests for recognizing a hosted subscription authentication failure by its message.
 *
 * WHY THIS FILE EXISTS AS ITS OWN SUITE. The classification is by string, because Pi exposes no
 * error taxonomy, and a string pattern rots silently: it keeps compiling, keeps passing every other
 * test, and shows the user Pi's internal sentence with an HTTP 500 instead of a sign-in button.
 * Every alternative below is a sentence OBSERVED on the wire — read out of the shipped
 * `@earendil-works/pi-ai` and `pi-coding-agent` 0.80.6 bundles, or returned by a live run against
 * the real provider on 2026-09-08. Three of them did not match the first pattern this feature
 * shipped with.
 *
 * Run: pnpm exec vitest run tests/unit/subscription-auth-strings.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  isSubscriptionAuthFailure,
  subscriptionAuthError,
  subscriptionAuthFailureReason,
  SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
  SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
  SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE,
} from "../../src/engines/sandbox_agent/errors.ts";

/** Sentence, and the short reason word the API records for it. */
const OBSERVED: Array<[string, string]> = [
  ['Authentication failed for "openai-codex".', "auth_failed"],
  ["Authentication failed", "auth_failed"],
  ["Failed to refresh OAuth token for openai-codex", "refresh_rejected"],
  // Three DIFFERENT shipped sentences for "there is no credential", one of which interpolates a
  // display name rather than the provider id.
  ["No API key found for ChatGPT Plus/Pro (Codex Subscription).", "login_missing"],
  ["No API key for provider: openai-codex", "login_missing"],
  ["No API key for openai-codex/gpt-5.4-mini", "login_missing"],
  // Live-observed, HTTP 500 before it was classified.
  ["Failed to extract accountId from token", "login_unreadable"],
  // The provider's own prose, relayed through Pi. Live-observed.
  [
    "Could not parse your authentication token. Please try signing in again.",
    "token_rejected",
  ],
  ["HTTP 401", "unauthorized"],
];

describe("isSubscriptionAuthFailure", () => {
  for (const [message, reason] of OBSERVED) {
    it(`recognizes: ${message.slice(0, 56)}`, () => {
      assert.equal(isSubscriptionAuthFailure(new Error(message)), true);
      assert.equal(subscriptionAuthFailureReason(new Error(message)), reason);
    });
  }

  it("ignores a failure that is not about a credential", () => {
    for (const message of [
      "the model returned a 500",
      "sandbox_gone",
      "read ECONNRESET",
      "tool call failed: rate limited",
    ]) {
      assert.equal(isSubscriptionAuthFailure(new Error(message)), false, message);
    }
  });

  it("ignores a 401 the RUNNER produced, which is not a provider refusal", () => {
    // Telling the user to re-authenticate a connection because the runner's own callback got a
    // 401 sends them to fix something that is not broken.
    for (const message of [
      "tool call weather failed: HTTP 401",
      "attachment fetch failed: HTTP 401",
      "session records query failed: HTTP 401",
    ]) {
      assert.equal(isSubscriptionAuthFailure(new Error(message)), false, message);
    }
  });

  it("reads a non-Error the same way", () => {
    assert.equal(isSubscriptionAuthFailure("No API key for provider: openai-codex"), true);
  });
});

describe("the three subscription messages", () => {
  it("carry no token, no path, and no provider mechanics", () => {
    for (const message of [
      SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
      SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
      SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE,
    ]) {
      assert.ok(!/\//.test(message), `${message} looks like it carries a path`);
      assert.ok(!/openai-codex|oauth|token|401/i.test(message), message);
      assert.match(message, /ChatGPT/);
    }
  });

  it("say different things: sign in, try again, and could not check", () => {
    assert.notEqual(
      SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
      SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
    );
    assert.notEqual(
      SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
      SUBSCRIPTION_LOGIN_UNCHECKED_MESSAGE,
    );
  });

  it("maps stale to the retryable code and everything else to the sign-in code", () => {
    assert.deepEqual(subscriptionAuthError(true), {
      message: SUBSCRIPTION_LOGIN_REFRESHED_MESSAGE,
      code: "subscription_login_refreshed",
    });
    assert.deepEqual(subscriptionAuthError(false), {
      message: SUBSCRIPTION_LOGIN_REQUIRED_MESSAGE,
      code: "subscription_login_required",
    });
  });
});
