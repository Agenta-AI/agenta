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
import {
  enableDaytonaProvider,
  piTranscriptWithError,
  runSilentTurn,
} from "../utils/silent-turn.ts";

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

  it("matches a real mask of any width", () => {
    assert.equal(
      byBodyAlone("401 Incorrect API key provided: dtn_secret_ab*****"),
      "credential_delivery_failed",
    );
    assert.equal(
      byBodyAlone("401 Incorrect API key provided: dtn_abcd***"),
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

  it("never matches a literal glob, which is ordinary text", () => {
    // `dtn_*` is a perfectly normal thing to find in a path, a filter or a log line, and the
    // first version of this signature allowed a zero-length stem, so it matched. A real mask is
    // many characters wide behind a real stem.
    for (const raw of [
      "401 Unauthorized while listing dtn_* secrets",
      "401 Unauthorized: no match for pattern dtn_*",
      "401 Unauthorized: dtn_**",
      "401 Unauthorized: dtn_ab***",
    ]) {
      assert.equal(byBodyAlone(raw), "runner_error", raw);
    }
  });

  it("needs auth context, so a masked token in an unrelated error is not a delivery fault", () => {
    // A hypothetical customer key spelled `dtn_customer_***`. Inside a credential refusal it
    // reads as delivery; inside anything else it must not, because the masked-echo pattern is a
    // guess about formatting rather than a quoted protocol string.
    assert.equal(
      byBodyAlone("ETIMEDOUT while syncing dtn_customer_*** to the store"),
      "runner_error",
    );
    assert.equal(
      byBodyAlone("failed to parse config value dtn_customer_***"),
      "runner_error",
    );
    assert.equal(
      byBodyAlone("401 Unauthorized: dtn_customer_***"),
      "credential_delivery_failed",
    );
  });

  it("keeps the two self-evidencing signatures free of the auth requirement", () => {
    // Those name the placeholder in a shape only the delivery layer produces, so they carry
    // their own proof and must not be weakened by the corroboration rule above.
    assert.equal(
      byBodyAlone("tool run failed: dtn_secret_abc123 was rejected downstream"),
      "credential_delivery_failed",
    );
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

describe("the swallowed-Pi-error recovery path (Codex P1)", () => {
  // Pi does not throw a provider refusal: it records it in its transcript and ends the turn
  // cleanly, so the recovery path re-classifies it. That call site originally omitted the
  // freshness predicate, which meant a credential race arriving THIS way was still reported as
  // the user's key problem — the whole fix, bypassed by the harness that fails most quietly.
  beforeEach(enableDaytonaProvider);

  const REMOTE_CWD = "/home/sandbox";

  /**
   * A model connection whose key rides a Daytona Secret — an `opaque_http` credential plus the
   * exact-host endpoint the Secret is scoped to. Without BOTH the plan builds no model-secret
   * candidate, nothing arms `modelSecretDeliveredAt`, and the test would pass against the very
   * bug it exists to catch by never reaching the branch.
   */
  const DAYTONA_MODEL_CONNECTION = {
    provider: "anthropic",
    deployment: "direct",
    credentialMode: "env" as const,
    endpoint: { baseUrl: "https://api.anthropic.com" },
    credentials: [
      {
        binding: { kind: "environment" as const, name: "ANTHROPIC_API_KEY" },
        value: "sk-ant-fixture-value",
        usage: "opaque_http" as const,
      },
    ],
  };

  it("classifies a fresh-secret 401 recovered from the transcript as delivery", async () => {
    const { result, events } = await runSilentTurn(
      {
        harness: "pi_core",
        sandbox: "daytona",
        modelConnection: DAYTONA_MODEL_CONNECTION,
      },
      {
        cwd: REMOTE_CWD,
        sandboxTranscript: piTranscriptWithError(
          REMOTE_CWD,
          "API Error: 401 Invalid bearer token",
        ),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, DELIVERY_MESSAGE);
    // The playground renders the stream, not the envelope, so the honest copy has to be in both.
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, "no error event in the stream");
    assert.equal(errorEvent.message, DELIVERY_MESSAGE);
  });

  it("still blames nothing on the user when the transcript refusal is unrelated", async () => {
    // The guard in the other direction: the predicate must not turn every recovered failure into
    // a delivery fault.
    const { result } = await runSilentTurn(
      {
        harness: "pi_core",
        sandbox: "daytona",
        modelConnection: DAYTONA_MODEL_CONNECTION,
      },
      {
        cwd: REMOTE_CWD,
        sandboxTranscript: piTranscriptWithError(
          REMOTE_CWD,
          "Rate limit reached for gpt-5 in organization org-abc on tokens per min.",
        ),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      "Too many requests right now. Try again in a moment.",
    );
  });
});

describe("the fresh-Secret branch requires a provider 401 (CodeRabbit, #6408)", () => {
  // `AUTH_REFUSAL` is broad on purpose — it decides which advice to print, and bare
  // "unauthorized" appears in authorization failures all over the runner. That breadth is wrong
  // for this branch, which SPENDS the session's one credential-race report and tells the user to
  // retry. An unrelated "unauthorized" inside the propagation window would burn the report and
  // hand out retry guidance a retry cannot fix, leaving the genuine race that followed to get the
  // add-a-key copy.
  const UNRELATED = [
    "Unauthorized: the tool's own API rejected the request",
    "mount failed: unauthorized",
    "authentication required by the storage backend",
    "invalid api key for the analytics service",
  ];

  it("does not classify an unrelated authorization failure as a delivery race", () => {
    for (const raw of UNRELATED) {
      const r = classifyRunError(new Error(raw), "claude", "anthropic", {
        daytonaCredentialFresh: () => true,
      });
      assert.equal(r.code, "runner_error", raw);
      assert.doesNotMatch(
        r.message,
        /credentials from reaching the model/,
        raw,
      );
    }
  });

  it("does not let an unrelated authorization failure consume the session report", () => {
    const store = new SessionContinuityStore();
    const report = () =>
      store.noteCredentialRaceReport("session-x") <=
      CREDENTIAL_RACE_REPORTS_PER_SESSION;

    classifyRunError(new Error(UNRELATED[0]), "claude", "anthropic", {
      daytonaCredentialFresh: report,
    });
    assert.equal(store.credentialRaceReportCount("session-x"), 0);

    // The report is still available for the real race that follows.
    const r = classifyRunError(
      new Error(ANTHROPIC_DIRECT_401),
      "claude",
      "anthropic",
      {
        daytonaCredentialFresh: report,
      },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("still recognizes the 401 shapes providers actually send", () => {
    for (const raw of [
      "API Error: 401 Invalid bearer token",
      'HTTP 401: {"error":"unauthorized"}',
      '{"status_code": 401, "message": "no"}',
      "http-401 refused",
    ]) {
      const r = classifyRunError(new Error(raw), "claude", "anthropic", {
        daytonaCredentialFresh: () => true,
      });
      assert.equal(r.code, "credential_delivery_failed", raw);
    }
  });

  it("keeps the placeholder branches free of the report budget", () => {
    // A body that echoes the placeholder is self-evidencing: a real user key never contains
    // `dtn_`, so every such refusal IS a delivery failure however often it repeats. Capping it
    // would eventually tell a user with a good key to add one.
    const store = new SessionContinuityStore();
    const report = () =>
      store.noteCredentialRaceReport("session-y") <=
      CREDENTIAL_RACE_REPORTS_PER_SESSION;
    for (let i = 0; i < 5; i++) {
      const r = classifyRunError(
        new Error(LITELLM_PROXY_401),
        "claude",
        "anthropic",
        {
          daytonaCredentialFresh: report,
        },
      );
      assert.equal(r.code, "credential_delivery_failed");
    }
    assert.equal(store.credentialRaceReportCount("session-y"), 0);
  });
});

describe("a 401 the RUNNER produced is not the provider's (CodeRabbit Major, #6422)", () => {
  // This classifier reads one flattened error STRING; it never sees an HTTP response, so the
  // status it matches is whatever the throwing code wrote into the message. Several authenticated
  // calls the runner makes DURING a turn can answer 401 and reach the same catch. Left
  // unexcluded, any of them inside the propagation window spends the session's one report and
  // prints retry guidance for a failure a retry cannot fix — and the genuine race that follows
  // then gets the add-a-key copy, which is the original bug wearing a disguise.
  const RUNNER_401 = [
    "mount failed: HTTP 401",
    "tool call workflow.variant.summarizer failed: HTTP 401",
    "attachment fetch failed: HTTP 401",
    "attachment claim failed: HTTP 401",
    "session records query failed: HTTP 401",
    "session records persist failed: HTTP 401",
    "remount failed: HTTP 401",
  ];

  it("does not classify a runner-side 401 as a credential race", () => {
    for (const raw of RUNNER_401) {
      const r = classifyRunError(new Error(raw), "claude", "anthropic", {
        daytonaCredentialFresh: () => true,
      });
      assert.equal(r.code, "runner_error", raw);
      assert.doesNotMatch(
        r.message,
        /credentials from reaching the model/,
        raw,
      );
    }
  });

  it("does not let a runner-side 401 consume the session report", () => {
    // The load-bearing half. A consumed report is invisible at the time and only shows up later,
    // as the real race being told to add a key.
    const store = new SessionContinuityStore();
    const report = () =>
      store.noteCredentialRaceReport("session-z") <=
      CREDENTIAL_RACE_REPORTS_PER_SESSION;

    for (const raw of RUNNER_401) {
      classifyRunError(new Error(raw), "claude", "anthropic", {
        daytonaCredentialFresh: report,
      });
    }
    assert.equal(store.credentialRaceReportCount("session-z"), 0);

    // Still available for the genuine refusal that follows.
    const r = classifyRunError(
      new Error(ANTHROPIC_DIRECT_401),
      "claude",
      "anthropic",
      {
        daytonaCredentialFresh: report,
      },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("still classifies a provider 401 that merely mentions a tool", () => {
    // The exclusion keys on the runner's own failure PREFIX, not on any appearance of the word:
    // a model refusal whose body happens to say "tool" must not be excluded.
    const r = classifyRunError(
      new Error(
        'API Error: 401 {"message":"Invalid bearer token","request":"tool_use"}',
      ),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: () => true },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("keeps a self-evidencing placeholder echo classified inside a runner-side failure", () => {
    // The placeholder branch runs earlier and stands alone: a literal `dtn_secret_` in the body
    // means the placeholder really went out, whoever was calling, so the runner-side exclusion
    // must not suppress it.
    const r = classifyRunError(
      new Error("tool call x failed: HTTP 401 rejected dtn_secret_abc123"),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: () => true },
    );
    assert.equal(r.code, "credential_delivery_failed");
  });

  it("refuses a bare `dtn_****` mask with no LiteLLM phrasing", () => {
    // Not a regression: `Received=dtn_****` is evidence only via LiteLLM's quoted sentence. On
    // its own the mask has a zero-length stem, which the tightened signature rejects by design so
    // a literal glob cannot spoof it. Pinned here so the asymmetry is deliberate, not accidental.
    const r = classifyRunError(
      new Error("tool call x failed: HTTP 401 got dtn_**** instead"),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: () => true },
    );
    assert.equal(r.code, "runner_error");

    // With LiteLLM's own sentence in front of it, the same mask IS evidence.
    const withPhrase = classifyRunError(
      new Error(
        "LiteLLM Virtual Key expected. Received=dtn_****, expected sk-",
      ),
      "claude",
      "anthropic",
      { daytonaCredentialFresh: () => false },
    );
    assert.equal(withPhrase.code, "credential_delivery_failed");
  });
});
