/**
 * Unit tests for the direct-provider credential race (F6).
 *
 * THE BUG. On a Daytona run the model key is a Daytona Secret and the sandbox holds a
 * `dtn_secret_<id>` placeholder Daytona substitutes into egress asynchronously. When the first
 * model call beats that propagation, the provider refuses the raw placeholder with a 401.
 * `classifyRunError` used to recognize that ONLY when the error body echoed the placeholder — which
 * the litellm credits proxy does and no direct provider does. api.anthropic.com answers
 * "Invalid bearer token" with no echo at all, and OpenAI's echo is masked
 * ("dtn_secr***************cdef"), which no longer contains the literal `dtn_secret_`. So every
 * direct-path placeholder 401 was blamed on the user's key.
 *
 * THE INVERSE TRAP, which is why the counter exists. A genuinely wrong key produces a byte-identical
 * refusal on the direct path. Telling it to retry is a dead end: a failed turn DELETES the sandbox,
 * so the retry cold-acquires, re-arms the freshness window, and gets the same advice forever. One
 * report per session bounds it — the second identical failure falls through to the add-a-key copy.
 *
 * The provider bodies below were captured live from the real endpoints (2026-08-31) with a
 * synthetic probe token; no real credential appears here.
 *
 * Run: pnpm exec vitest run tests/unit/credential-race-classification.test.ts
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";

import {
  classifyRunError,
  CREDENTIAL_RACE_REPORTS_PER_SESSION,
  withinCredentialPropagationWindow,
} from "../../src/engines/sandbox_agent/errors.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";

/** Captured live: api.anthropic.com refusing a `dtn_` bearer. Note it echoes NOTHING. */
const ANTHROPIC_DIRECT_401 =
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid bearer token"}}';

/** Captured live: OpenAI refusing the same token, echoing it MASKED. */
const OPENAI_DIRECT_401 =
  'API Error: 401 {"error":{"message":"Incorrect API key provided: dtn_secr***************cdef. You can find your API key at https://platform.openai.com/account/api-keys.","code":"invalid_api_key"}}';

/** The credits proxy, which names the placeholder outright. */
const LITELLM_PROXY_401 =
  'API Error: 401 {"error":{"message":"Authentication Error, LiteLLM Virtual Key expected. Received=dtn_****, expected to start with sk-"}}';

const DELIVERY_MESSAGE =
  "A temporary issue kept this run's credentials from reaching the model. Send the message again.";

const fresh = () => true;
const notFresh = () => false;

describe("classifyRunError: the credential race on a direct provider", () => {
  it("classifies an anthropic-direct 401 as delivery when the Secret is fresh", () => {
    const r = classifyRunError(
      new Error(ANTHROPIC_DIRECT_401),
      "claude",
      "anthropic",
      { connection: { deployment: "direct" }, daytonaCredentialFresh: fresh },
    );
    assert.equal(r.code, "credential_delivery_failed");
    assert.equal(r.message, DELIVERY_MESSAGE);
  });

  it("classifies an openai-direct 401 as delivery when the Secret is fresh", () => {
    const r = classifyRunError(
      new Error(OPENAI_DIRECT_401),
      "codex",
      "openai",
      {
        connection: { deployment: "direct" },
        daytonaCredentialFresh: fresh,
      },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("still classifies the litellm proxy refusal as delivery", () => {
    const r = classifyRunError(
      new Error(LITELLM_PROXY_401),
      "claude",
      "anthropic",
      {
        connection: { deployment: "custom" },
        daytonaCredentialFresh: notFresh,
      },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("keeps the add-a-key advice on a warm sandbox (no fresh Secret)", () => {
    const r = classifyRunError(
      new Error(ANTHROPIC_DIRECT_401),
      "claude",
      "anthropic",
      {
        connection: { deployment: "direct" },
        daytonaCredentialFresh: notFresh,
      },
    );
    assert.equal(r.code, "runner_error");
    assert.match(r.message, /add the project's Anthropic key/);
  });

  it("keeps the add-a-key advice for a run with no Daytona Secret at all", () => {
    const r = classifyRunError(
      new Error(ANTHROPIC_DIRECT_401),
      "claude",
      "anthropic",
      { connection: { deployment: "direct" } },
    );
    assert.equal(r.code, "runner_error");
    assert.match(r.message, /add the project's Anthropic key/);
  });

  it("does not let a fresh Secret reclassify a non-auth failure", () => {
    const r = classifyRunError(
      new Error("ETIMEDOUT: sandbox create timed out after 120s"),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: fresh },
    );
    assert.equal(r.code, "runner_error");
    assert.doesNotMatch(r.message, /credentials from reaching the model/);
  });

  it("does not let a fresh Secret swallow a real credits refusal", () => {
    // The budget branch is more specific and runs first: a spent key is not a delivery fault,
    // and telling the user to retry would loop them against an empty balance.
    const r = classifyRunError(
      new Error("budget_exceeded: Crossed spend within budget"),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: fresh },
    );
    assert.equal(r.code, "starter_credits_exhausted");
  });
});

describe("PLACEHOLDER_CREDENTIAL: the widened masked-echo signature", () => {
  // Body-only detection, with no freshness signal at all — this is what makes the direct OpenAI
  // path self-diagnosing again rather than depending on the timing window.
  const byBodyAlone = (raw: string) =>
    classifyRunError(new Error(raw), "codex", "openai").code;

  it("matches OpenAI's masked echo", () => {
    assert.equal(byBodyAlone(OPENAI_DIRECT_401), "credential_delivery_failed");
  });

  it("matches a short mask and a long mask alike", () => {
    assert.equal(
      byBodyAlone("401 Incorrect API key provided: dtn_*"),
      "credential_delivery_failed",
    );
    assert.equal(
      byBodyAlone("401 Incorrect API key provided: dtn_secret_ab*****"),
      "credential_delivery_failed",
    );
  });

  it("never matches an ordinary user key, masked or not", () => {
    // The signature is anchored on Daytona's `dtn_` placeholder prefix, which cannot occur in a
    // provider key. A masked real key must still read as an ordinary auth failure.
    for (const raw of [
      "401 Incorrect API key provided: sk-proj*************abcd",
      "401 Incorrect API key provided: sk-ant-api03-****",
      "401 invalid api key",
      "401 Unauthorized",
    ]) {
      assert.equal(byBodyAlone(raw), "runner_error", raw);
    }
  });
});

describe("withinCredentialPropagationWindow", () => {
  const now = 1_000_000;

  it("is false when no Daytona Secret was delivered", () => {
    assert.equal(withinCredentialPropagationWindow(undefined, now), false);
  });

  it("is true just inside the window (59s)", () => {
    assert.equal(withinCredentialPropagationWindow(now - 59_000, now), true);
  });

  it("is false just outside the window (61s)", () => {
    assert.equal(withinCredentialPropagationWindow(now - 61_000, now), false);
  });
});

describe("the once-per-session bound (the inverse failure mode)", () => {
  let store: SessionContinuityStore;

  beforeEach(() => {
    store = new SessionContinuityStore();
  });

  /** The predicate `runTurn` builds, in miniature: window AND not-yet-spent. */
  const report = (sessionId: string) =>
    store.noteCredentialRaceReport(sessionId) <=
    CREDENTIAL_RACE_REPORTS_PER_SESSION;

  const classify = (sessionId: string) =>
    classifyRunError(new Error(ANTHROPIC_DIRECT_401), "claude", "anthropic", {
      connection: { deployment: "direct" },
      daytonaCredentialFresh: () => report(sessionId),
    });

  it("tells the first refusal to retry and the second to add a key", () => {
    // This is the test that would have caught the parked draft's hole: without the counter, a
    // genuinely wrong key is told to retry forever, because the failed turn deletes the sandbox
    // and the retry re-arms the freshness window.
    assert.equal(classify("session-a").code, "credential_delivery_failed");

    const second = classify("session-a");
    assert.equal(second.code, "runner_error");
    assert.match(second.message, /add the project's Anthropic key/);
  });

  it("stays on the add-a-key advice for every later refusal", () => {
    classify("session-a");
    classify("session-a");
    assert.equal(classify("session-a").code, "runner_error");
  });

  it("counts each session separately", () => {
    assert.equal(classify("session-a").code, "credential_delivery_failed");
    assert.equal(classify("session-b").code, "credential_delivery_failed");
    assert.equal(classify("session-a").code, "runner_error");
  });

  it("counts only when the classifier actually asks", () => {
    // A turn that failed for an unrelated reason must not spend the session's one report.
    classifyRunError(new Error("ETIMEDOUT"), "claude", "anthropic", {
      daytonaCredentialFresh: () => report("session-c"),
    });
    assert.equal(store.credentialRaceReportCount("session-c"), 0);
    assert.equal(classify("session-c").code, "credential_delivery_failed");
  });

  it("forgets the count when the session is cleared", () => {
    classify("session-a");
    assert.equal(store.credentialRaceReportCount("session-a"), 1);
    store.clear("session-a");
    assert.equal(store.credentialRaceReportCount("session-a"), 0);
    assert.equal(classify("session-a").code, "credential_delivery_failed");
  });
});
