/**
 * Unit tests for the session keep-alive pool and its fingerprints (slice 1).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-pool.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

// What `commitApplied` accepts: a lifecycle action's RESULT, both halves together.
type AppliedCommit = Parameters<AppliedState["commitApplied"]>[0];
import { inspect } from "node:util";

import type { AgentRunRequest } from "../../src/protocol.ts";
import { AppliedState } from "../../src/engines/sandbox_agent/applied-state.ts";
import {
  FACETS,
  type FacetDigests,
} from "../../src/lifecycle/desired-state.ts";

// The pool never reads facet digests; it only reads `configFingerprint`. So one constant
// stands in for every facet here, and a pool test that starts depending on facets will be
// visible as a test that had to stop using this.
const FAKE_FACETS: FacetDigests = Object.fromEntries(
  FACETS.map((facet) => [facet, "facet-digest"]),
) as FacetDigests;
import {
  approvalDecisionForToolCall,
  changedConfigFields,
  computeCredentialEpoch,
  configFieldDigests,
  configFingerprint,
  credentialEpochMismatch,
  credentialEpochValid,
  mountCredentialsExpired,
  sandboxCredentialsRotated,
  expectedNextHistoryFingerprint,
  historyFingerprint,
  poolKeyFor,
  priorConversation,
  readKeepaliveConfig,
  resolvesToLocalProvider,
  tailIsFreshUserMessage,
  type CredentialEpoch,
  CredentialMaterial,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";

describe("resolvesToLocalProvider (local/remote gate)", () => {
  it("is true when the request explicitly asks for local", () => {
    assert.equal(resolvesToLocalProvider("local", "local"), true);
  });

  it("is false when the request explicitly asks for daytona", () => {
    assert.equal(resolvesToLocalProvider("daytona", "local"), false);
  });

  it("falls back to the configured default when the request omits sandbox", () => {
    assert.equal(resolvesToLocalProvider(undefined, "daytona"), false);
    assert.equal(resolvesToLocalProvider(undefined, "local"), true);
  });

  it("the request value wins over the configured default", () => {
    assert.equal(resolvesToLocalProvider("local", "daytona"), true);
    assert.equal(resolvesToLocalProvider("daytona", "local"), false);
  });
});

// A fake environment: `destroy` and `appliedState` are what the pool touches. Destroys are
// counted. `teardown` is idempotent like the real engine `destroy()` closure (the pool's
// contract): a second call is a no-op.
//
// The environment now OWNS its applied configuration (lifecycle migration, step 2), so the fake
// carries a real `AppliedState`. The pool reads `configFingerprint` through it and no test can
// hand the pool a fingerprint of its own.
function fakeEnv(configFp = "cfg") {
  const state = { destroyed: 0, reasons: [] as string[] };
  const applied = new AppliedState(configFp, FAKE_FACETS, {});
  let done = false;
  return {
    state,
    get appliedState() {
      return applied.appliedState;
    },
    commitApplied: (result: AppliedCommit) => applied.commitApplied(result),
    teardown: async (reason: string) => {
      if (done) return;
      done = true;
      state.destroyed += 1;
      state.reasons.push(reason);
    },
  };
}

const epoch: CredentialEpoch = {
  secrets: new CredentialMaterial("h"),
  direct: new CredentialMaterial("d"),
};

function parkInput(key: string, env = fakeEnv()) {
  return {
    input: {
      key,
      environment: env,
      historyFingerprint: "hist",
      credentialEpoch: epoch,
      teardown: env.teardown,
    },
    env,
  };
}

describe("approvalDecisionForToolCall", () => {
  const req = (content: unknown[]): AgentRunRequest => ({
    messages: [
      { role: "user", content: "do X" },
      {
        role: "assistant",
        content: [
          { type: "tool_call", toolCallId: "tc-1", toolName: "commit" },
        ],
      },
      { role: "user", content: content as never },
    ],
  });

  it("returns allow for an {approved:true} envelope matching the gate's toolCallId", () => {
    const request = req([
      { type: "text", text: "ok" },
      { type: "tool_result", toolCallId: "tc-1", output: { approved: true } },
    ]);
    assert.equal(approvalDecisionForToolCall(request, "tc-1"), "allow");
  });

  it("returns deny for an {approved:false} envelope", () => {
    const request = req([
      { type: "tool_result", toolCallId: "tc-1", output: { approved: false } },
    ]);
    assert.equal(approvalDecisionForToolCall(request, "tc-1"), "deny");
  });

  it("returns undefined for a different toolCallId or a non-approval tool_result", () => {
    const other = req([
      { type: "tool_result", toolCallId: "tc-1", output: { approved: true } },
    ]);
    assert.equal(approvalDecisionForToolCall(other, "tc-OTHER"), undefined);
    const plain = req([
      { type: "tool_result", toolCallId: "tc-1", output: "browser result" },
    ]);
    assert.equal(approvalDecisionForToolCall(plain, "tc-1"), undefined);
  });

  it("returns undefined when the tail is a fresh user message (no approval)", () => {
    const request: AgentRunRequest = {
      messages: [
        { role: "user", content: "do X" },
        { role: "user", content: "changed my mind" },
      ],
    };
    assert.equal(approvalDecisionForToolCall(request, "tc-1"), undefined);
  });
});

describe("readKeepaliveConfig", () => {
  const KEYS = [
    "AGENTA_RUNNER_SESSION_KEEPALIVE",
    "AGENTA_RUNNER_SESSION_TTL_MS",
    "AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS",
    "AGENTA_RUNNER_SESSION_STOPPED_TTL_MS",
    "AGENTA_RUNNER_SESSION_POOL_MAX",
    "AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS",
    "AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults: on, 60s idle, 10m approval, cap 8", () => {
    // The approval window is the pending-interaction park: 10 minutes so a phone-latency
    // answer warm-resumes instead of cold-replaying (mobile approvals plan §4b-4).
    assert.deepEqual(readKeepaliveConfig("local"), {
      enabled: true,
      ttlMs: 60_000,
      approvalTtlMs: 600_000,
      // Defaults to the idle window, so the stopped-session field changes no timing on its own.
      // The open recommendation is to move it to the approval window; Mahmoud picks.
      stoppedTtlMs: 60_000,
      poolMax: 8,
    });
  });

  it("approval TTL stays env-overridable, with invalid values falling back", () => {
    process.env.AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS = "300000";
    assert.equal(readKeepaliveConfig("local").approvalTtlMs, 300_000);
    process.env.AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS = "0";
    assert.equal(readKeepaliveConfig("local").approvalTtlMs, 600_000);
    process.env.AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS = "nope";
    assert.equal(readKeepaliveConfig("local").approvalTtlMs, 600_000);
  });

  it("reads truthy spellings for the flag and positive ints for the numbers", () => {
    process.env.AGENTA_RUNNER_SESSION_KEEPALIVE = "true";
    process.env.AGENTA_RUNNER_SESSION_TTL_MS = "5000";
    process.env.AGENTA_RUNNER_SESSION_POOL_MAX = "3";
    const cfg = readKeepaliveConfig("local");
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.ttlMs, 5000);
    assert.equal(cfg.poolMax, 3);

    process.env.AGENTA_RUNNER_SESSION_KEEPALIVE = "off";
    assert.equal(readKeepaliveConfig("local").enabled, false);
    process.env.AGENTA_RUNNER_SESSION_KEEPALIVE = "not-a-boolean";
    assert.equal(readKeepaliveConfig("local").enabled, true);
    process.env.AGENTA_RUNNER_SESSION_TTL_MS = "-1";
    assert.equal(
      readKeepaliveConfig("local").ttlMs,
      60_000,
      "invalid falls back to default",
    );
  });

  it("ships Daytona enabled at the two-minute default; TTL zero is the off switch", () => {
    assert.deepEqual(readKeepaliveConfig("daytona"), {
      enabled: true,
      ttlMs: 120_000,
      // Daytona keeps its billed idle window for a stopped session unless an operator opts in.
      stoppedTtlMs: 120_000,
      approvalTtlMs: 120_000,
      poolMax: 20,
    });
    // 0 must disable, not fall back to the default: it is the documented off switch and
    // there is no separate enabled flag on purpose.
    process.env.AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS = "0";
    assert.deepEqual(readKeepaliveConfig("daytona"), {
      enabled: false,
      ttlMs: 0,
      approvalTtlMs: 0,
      stoppedTtlMs: 0,
      poolMax: 20,
    });
    process.env.AGENTA_RUNNER_DAYTONA_SESSION_IDLE_TTL_MS = "45000";
    assert.deepEqual(readKeepaliveConfig("daytona"), {
      enabled: true,
      ttlMs: 45_000,
      approvalTtlMs: 45_000,
      stoppedTtlMs: 45_000,
      poolMax: 20,
    });
    process.env.AGENTA_RUNNER_DAYTONA_SESSION_MAX_WARM = "7";
    assert.equal(readKeepaliveConfig("daytona").poolMax, 7);
  });
});

describe("configFingerprint", () => {
  const base: AgentRunRequest = {
    harness: "claude",
    model: "m1",
    messages: [{ role: "user", content: "hi" }],
  };

  it("names the changed fields on a config mismatch, values never", () => {
    // The `mismatch (config)` eviction line logs WHICH fields differ; each side is a digest
    // map, so no config value can reach a log through this path.
    const before = configFieldDigests(base);
    const after = configFieldDigests({
      ...base,
      permissions: { default: "deny" },
      mcpServers: [{ name: "gh" }],
    } as unknown as AgentRunRequest);
    assert.deepEqual(changedConfigFields(after, before), [
      "mcpServers",
      "permissions",
    ]);
    assert.deepEqual(changedConfigFields(after, undefined), []);
    for (const digest of Object.values(after)) {
      assert.match(digest, /^[0-9a-f]{64}$/);
    }
  });

  it("evicts when the agent artifact changes, and ignores the rest of runContext", () => {
    // Audit finding 4: the artifact id selects the agent mount, which is baked at acquire —
    // a warm sandbox must never serve a session whose storage folder changed. Every other
    // runContext field is per-turn metadata and must never evict (the step-1 rule).
    const withContext = (runContext: unknown): AgentRunRequest =>
      ({ ...base, runContext }) as AgentRunRequest;
    const artifactA = withContext({ workflow: { artifact: { id: "art-a" } } });
    assert.notEqual(
      configFingerprint(artifactA),
      configFingerprint(
        withContext({ workflow: { artifact: { id: "art-b" } } }),
      ),
      "a changed artifact id must evict",
    );
    assert.notEqual(
      configFingerprint(base),
      configFingerprint(artifactA),
      "absent-to-present must evict too (the mount appears)",
    );
    assert.equal(
      configFingerprint(artifactA),
      configFingerprint(
        withContext({
          workflow: {
            artifact: { id: "art-a" },
            revision: { id: "rev-9" },
            variant: { id: "var-9" },
          },
          trace: { trace_id: "xyz" },
        }),
      ),
      "revision/variant/trace identity stays per-turn metadata",
    );
  });

  it("excludes the derived gateway guidance, so an integration add never evicts", () => {
    // The guidance text carries the integration NAMES as examples and refreshes at
    // environment build. Hashing it would cold every warm session on each integration add —
    // the exact cost the separate field removes.
    const a = configFingerprint(base);
    const b = configFingerprint({
      ...base,
      gatewayGuidance: {
        text: "For instance, some of the integrations you have: github, slack.",
        carrier: "agentsMd",
      },
    } as unknown as AgentRunRequest);
    const c = configFingerprint({
      ...base,
      gatewayGuidance: {
        text: "For instance, some of the integrations you have: github.",
        carrier: "agentsMd",
      },
    } as unknown as AgentRunRequest);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("ignores per-turn volatiles and credential values", () => {
    const a = configFingerprint({
      ...base,
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.anthropic.com" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: "original",
            usage: "opaque_http",
          },
        ],
      },
    });
    const b = configFingerprint({
      ...base,
      messages: [{ role: "user", content: "totally different" }],
      turnId: "t-2",
      modelConnection: {
        provider: "anthropic",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.anthropic.com" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "ANTHROPIC_API_KEY" },
            value: "sekret",
            usage: "opaque_http",
          },
        ],
      },
      telemetry: {
        exporters: { otlp: { headers: { authorization: "Bearer x" } } },
      },
      context: { propagation: { traceparent: "00-abc-def-01" } },
    });
    assert.equal(
      a,
      b,
      "config fingerprint is stable across per-turn volatiles",
    );
  });

  it("ignores MCP credential values while retaining their binding contract", () => {
    const withMcp = (value: string): AgentRunRequest => ({
      ...base,
      mcpServers: [
        {
          name: "linear",
          connection: {
            type: "http",
            url: "https://mcp.linear.app/sse",
            credentials: [
              {
                binding: { kind: "header", name: "Authorization" },
                value,
                usage: "opaque_http",
              },
            ],
          },
          policy: { tools: { mode: "all" } },
        },
      ],
    });
    assert.equal(
      configFingerprint(withMcp("secret-a")),
      configFingerprint(withMcp("secret-b")),
    );
  });

  it("changes when a config-bearing field changes (model)", () => {
    assert.notEqual(
      configFingerprint(base),
      configFingerprint({ ...base, model: "m2" }),
    );
  });

  it("ignores the deprecated tools field", () => {
    // The runner activates every built-in regardless, so `tools` must not force a cold restart.
    assert.equal(
      configFingerprint(base),
      configFingerprint({ ...base, tools: ["read"] }),
    );
  });

  it("ignores resolved model capabilities (per-turn data that rides with the model)", () => {
    // Reversed 2026-08-30 (cold/warm audit finding 2): the modalities are read per turn by the
    // attachment chain and change WITH the model, so hashing them refused the live setModel
    // route on every cross-modality switch and rebuilt the sandbox for nothing.
    assert.equal(
      configFingerprint(base),
      configFingerprint({
        ...base,
        modelCapabilities: { inputModalities: ["text", "image"] },
      }),
    );
  });

  it("distinguishes different Codex harness modes", () => {
    const codex = { ...base, harness: "codex" };
    assert.notEqual(
      configFingerprint({ ...codex, harnessMode: "agent" }),
      configFingerprint({ ...codex, harnessMode: "read-only" }),
    );
  });

  it("treats omitted Codex mode as the explicit default", () => {
    const codex = { ...base, harness: "codex" };
    assert.equal(
      configFingerprint(codex),
      configFingerprint({ ...codex, harnessMode: "agent-full-access" }),
    );
  });

  it("ignores harness mode for non-Codex harnesses", () => {
    assert.equal(
      configFingerprint(base),
      configFingerprint({ ...base, harnessMode: "read-only" }),
    );
  });

  // Custom OpenAI-compatible warm-session safety (design Decision 7): a change to the connection,
  // model, or endpoint must cold-start rather than reuse a mismatched live session. No new
  // fingerprint field is needed — these already ride configFingerprint.
  it("changes when the connection changes (custom provider identity)", () => {
    const withConn: AgentRunRequest = {
      ...base,
      connection: { mode: "agenta", slug: "ollama-a" },
      modelConnection: {
        provider: "openai",
        deployment: "custom",
        endpoint: { baseUrl: "https://a.test/v1" },
        credentialMode: "none",
        credentials: [],
      },
    };
    assert.notEqual(
      configFingerprint(withConn),
      configFingerprint({
        ...withConn,
        connection: { mode: "agenta", slug: "ollama-b" },
      }),
    );
  });

  it("changes when the endpoint base URL changes", () => {
    const withEndpoint: AgentRunRequest = {
      ...base,
      connection: { mode: "agenta", slug: "ollama-a" },
      modelConnection: {
        provider: "openai",
        deployment: "custom",
        endpoint: { baseUrl: "https://a.test/v1" },
        credentialMode: "none",
        credentials: [],
      },
    };
    assert.notEqual(
      configFingerprint(withEndpoint),
      configFingerprint({
        ...withEndpoint,
        modelConnection: {
          ...withEndpoint.modelConnection!,
          endpoint: { baseUrl: "https://b.test/v1" },
        },
      }),
    );
  });
});

describe("historyFingerprint (pruned-array contract)", () => {
  const u1 = { role: "user", content: "hello" };
  const u2 = { role: "user", content: "again" };
  const assistantEmpty = { role: "assistant", content: "" };
  const assistantToolCall = {
    role: "assistant",
    content: [{ type: "tool_call", toolCallId: "tc-1", toolName: "edit" }],
  };

  it("an answer-less (empty) assistant turn is fingerprint-neutral: pruned == unpruned", () => {
    assert.equal(
      historyFingerprint([u1, assistantEmpty, u2]),
      historyFingerprint([u1, u2]),
      "assistant text is ignored, so pruning an empty assistant turn does not change the hash",
    );
  });

  it("a tool-call id in the assistant turn IS captured: unpruned != pruned", () => {
    assert.notEqual(
      historyFingerprint([u1, assistantToolCall, u2]),
      historyFingerprint([u1, u2]),
      "tool-call ids are part of the fingerprint (edit/tool detection)",
    );
  });

  it("edited user text changes the fingerprint", () => {
    assert.notEqual(
      historyFingerprint([u1]),
      historyFingerprint([{ role: "user", content: "hello!" }]),
    );
  });

  it("changes when ordered user attachment ids change", () => {
    const withAttachment = (attachmentId: string) => ({
      role: "user",
      content: [{ type: "attachment", attachmentId }],
    });
    assert.notEqual(
      historyFingerprint([
        withAttachment("019a52c2-14c0-7c14-b874-2f5798f9cd21"),
      ]),
      historyFingerprint([
        withAttachment("019a52c2-14c0-7c14-b874-2f5798f9cd22"),
      ]),
    );
  });

  it("changes when the order of user attachment ids changes", () => {
    const ids = [
      "019a52c2-14c0-7c14-b874-2f5798f9cd21",
      "019a52c2-14c0-7c14-b874-2f5798f9cd22",
    ];
    const withAttachments = (attachmentIds: string[]) => ({
      role: "user",
      content: attachmentIds.map((attachmentId) => ({
        type: "attachment",
        attachmentId,
      })),
    });
    assert.notEqual(
      historyFingerprint([withAttachments(ids)]),
      historyFingerprint([withAttachments([...ids].reverse())]),
    );
  });

  it("changes when a legacy inline image's content changes", () => {
    const withImage = (data: string) => ({
      role: "user",
      content: [
        { type: "image", uri: `data:image/png;base64,${data}` },
        { type: "text", text: "describe this" },
      ],
    });
    assert.notEqual(
      historyFingerprint([withImage("AQID")]),
      historyFingerprint([withImage("BAUG")]),
    );
    assert.equal(
      historyFingerprint([withImage("AQID")]),
      historyFingerprint([withImage("AQID")]),
    );
  });

  it("continuation symmetry: park(full [u1]) == check(prior of [u1,a1,u2]) for a plain turn", () => {
    const parked = historyFingerprint([u1]);
    const req: AgentRunRequest = {
      messages: [u1, assistantEmpty, u2],
    };
    const check = historyFingerprint(priorConversation(req));
    assert.equal(
      parked,
      check,
      "a plain conversational continuation matches its parked prefix",
    );
  });

  it("dedupes ids: a tool_call + tool_result PAIR sharing one id hashes like a single id", () => {
    // The wire folds one FE tool part into a tool_call block plus a tool_result block sharing
    // the toolCallId (vercel messages.py); the park-time prediction folds each emitted id in
    // once. Dedupe makes the two shapes agree.
    const pair = {
      role: "assistant",
      content: [
        { type: "tool_call", toolCallId: "tc-1", toolName: "read" },
        { type: "tool_result", toolCallId: "tc-1", output: "x" },
      ],
    };
    const single = {
      role: "assistant",
      content: [{ type: "tool_call", toolCallId: "tc-1" }],
    };
    assert.equal(
      historyFingerprint([u1, pair]),
      historyFingerprint([u1, single]),
    );
  });

  it("expectedNextHistoryFingerprint: park prediction matches the FE's next tool-turn shape", () => {
    // Park time: the turn ran on [u1] and emitted tc-1 + tc-2.
    const predicted = expectedNextHistoryFingerprint([u1], ["tc-1", "tc-2"]);
    // Next request's prior conversation as the FE sends it: the kept assistant turn carries a
    // call+result pair per tool plus answer text (text is not hashed).
    const nextPrior = [
      u1,
      {
        role: "assistant",
        content: [
          { type: "tool_call", toolCallId: "tc-1", toolName: "read" },
          { type: "tool_result", toolCallId: "tc-1", output: "a" },
          { type: "tool_call", toolCallId: "tc-2", toolName: "edit" },
          { type: "tool_result", toolCallId: "tc-2", output: "b" },
          { type: "text", text: "done" },
        ],
      },
    ];
    assert.equal(predicted, historyFingerprint(nextPrior));
    // No emitted ids => identical to the plain history fingerprint.
    assert.equal(
      expectedNextHistoryFingerprint([u1], []),
      historyFingerprint([u1]),
    );
    // A different id set still mismatches (the cold-fallback tripwire).
    assert.notEqual(
      expectedNextHistoryFingerprint([u1], ["tc-1"]),
      historyFingerprint(nextPrior),
    );
  });
});

describe("tailIsFreshUserMessage", () => {
  it("true for a plain trailing user message with text", () => {
    assert.equal(
      tailIsFreshUserMessage({ messages: [{ role: "user", content: "hi" }] }),
      true,
    );
  });
  it("false for an empty tail or non-user tail", () => {
    assert.equal(tailIsFreshUserMessage({ messages: [] }), false);
    assert.equal(
      tailIsFreshUserMessage({
        messages: [{ role: "assistant", content: "x" }],
      }),
      false,
    );
    assert.equal(
      tailIsFreshUserMessage({ messages: [{ role: "user", content: "  " }] }),
      false,
    );
  });
  it("true for an attachment-only trailing user message", () => {
    assert.equal(
      tailIsFreshUserMessage({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "attachment",
                attachmentId: "019a52c2-14c0-7c14-b874-2f5798f9cd21",
              },
            ],
          },
        ],
      } as unknown as AgentRunRequest),
      true,
    );
  });

  it("true for both legacy inline-image-only trailing user messages", () => {
    for (const block of [
      { type: "image", uri: "data:image/png;base64,AQID" },
      { type: "image", data: "AQID", mimeType: "image/webp" },
    ]) {
      assert.equal(
        tailIsFreshUserMessage({
          messages: [{ role: "user", content: [block] }],
        } as AgentRunRequest),
        true,
      );
    }
  });

  it("false when the tail user turn carries a tool_result (approval reply)", () => {
    assert.equal(
      tailIsFreshUserMessage({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "ok" },
              {
                type: "tool_result",
                toolCallId: "tc-1",
                output: { approved: true },
              },
            ],
          },
        ],
      }),
      false,
    );
  });
});

describe("credential epoch", () => {
  it("never surfaces the credential values, however it is turned into text", () => {
    // The epoch holds the real values so it can compare them, so the one thing that must be
    // impossible is a value reaching a log line. Every route from an object to a string is
    // pinned here, because a future refactor that drops one of these overrides would leak
    // silently: the code would still work and the key would appear in stderr.
    const epoch = computeCredentialEpoch({
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v1" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: "sk-should-never-be-printed",
            usage: "opaque_http",
          },
        ],
      },
    });

    const renderings = [
      String(epoch.secrets),
      `${epoch.secrets}`,
      JSON.stringify(epoch),
      inspect(epoch, { depth: null }),
      inspect(epoch.secrets),
    ];
    for (const rendering of renderings) {
      assert.equal(
        rendering.includes("sk-should-never-be-printed"),
        false,
        `leaked the credential value through: ${rendering}`,
      );
    }
  });

  // A typed model connection whose one credential carries `value` under env var `name`.
  const modelConnection = (
    value: string,
    name = "A",
  ): AgentRunRequest["modelConnection"] => ({
    provider: "test",
    deployment: "custom",
    endpoint: { baseUrl: "https://model.example" },
    credentialMode: "env",
    credentials: [
      {
        binding: { kind: "environment", name },
        value,
        usage: "opaque_http",
      },
    ],
  });

  it("same secrets hash equal; a changed secret value differs", () => {
    const a = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    const b = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    const c = computeCredentialEpoch({
      modelConnection: modelConnection("2"),
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    assert.equal(a.secrets.equals(b.secrets), true);
    assert.equal(
      a.secrets.equals(c.secrets),
      false,
      "a rotated same-slug secret changes the material",
    );
  });

  it("a rotated OPENAI_API_KEY invalidates the epoch (custom provider key rotation)", () => {
    // Rotating the custom OpenAI-compatible connection's key for the same slug must cold-start
    // with the fresh key rather than reuse a warm session baked with the old one (design
    // Decision 7 — the credential epoch already covers this; no new key is needed).
    const parked = computeCredentialEpoch({
      modelConnection: modelConnection("sk-old", "OPENAI_API_KEY"),
    });
    const rotated = computeCredentialEpoch({
      modelConnection: modelConnection("sk-new", "OPENAI_API_KEY"),
    });
    assert.equal(parked.secrets.equals(rotated.secrets), false);
    assert.equal(sandboxCredentialsRotated(parked, rotated), true);
    assert.equal(credentialEpochValid(parked, rotated, Date.now()), false);
  });

  it("a re-minted tool-callback bearer does NOT change the material (per-turn)", () => {
    // The backend re-mints the callback bearer on its auth-cache cadence (~60s); the turn's
    // relay always uses the incoming bearer, so a warm continue must not evict over it.
    const parked = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
      toolCallback: { endpoint: "e", authorization: "bearer-old" },
    });
    const incoming = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
      toolCallback: { endpoint: "e", authorization: "bearer-new" },
    });
    assert.equal(parked.secrets.equals(incoming.secrets), true);
    assert.equal(sandboxCredentialsRotated(parked, incoming), false);
    assert.equal(credentialEpochMismatch(parked, incoming), undefined);
  });

  it("rotates the epoch when an MCP header credential changes", () => {
    const withMcp = (value: string): AgentRunRequest => ({
      mcpServers: [
        {
          name: "linear",
          connection: {
            type: "http",
            url: "https://mcp.linear.app/sse",
            credentials: [
              {
                binding: { kind: "header", name: "Authorization" },
                value,
                usage: "opaque_http",
              },
            ],
          },
          policy: { tools: { mode: "all" } },
        },
      ],
    });
    assert.equal(
      computeCredentialEpoch(withMcp("secret-a")).secrets.equals(
        computeCredentialEpoch(withMcp("secret-b")).secrets,
      ),
      false,
    );
  });

  it("valid until the mount expiry elapses; invalid once expired", () => {
    const parked = {
      ...computeCredentialEpoch({ modelConnection: modelConnection("1") }),
      mountExpiresAtMs: Date.parse("2026-01-01T00:00:10.000Z"),
    };
    const incoming = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
    });
    const before = Date.parse("2026-01-01T00:00:05.000Z");
    const after = Date.parse("2026-01-01T00:00:15.000Z");
    assert.equal(credentialEpochValid(parked, incoming, before), true);
    assert.equal(
      credentialEpochValid(parked, incoming, after),
      false,
      "expired mount evicts",
    );
  });

  it("invalid when the secret material changed even if not expired", () => {
    const parked = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
    });
    const incoming = computeCredentialEpoch({
      modelConnection: modelConnection("2"),
    });
    assert.equal(credentialEpochValid(parked, incoming, Date.now()), false);
  });

  it("credentialEpochMismatch splits the reason: expired vs rotated vs none", () => {
    const parked = {
      ...computeCredentialEpoch({ modelConnection: modelConnection("1") }),
      mountExpiresAtMs: Date.parse("2026-01-01T00:00:10.000Z"),
    };
    const same = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
    });
    const rotated = computeCredentialEpoch({
      modelConnection: modelConnection("2"),
    });
    const before = Date.parse("2026-01-01T00:00:05.000Z");
    const after = Date.parse("2026-01-01T00:00:15.000Z");
    assert.equal(credentialEpochMismatch(parked, same, before), undefined);
    assert.equal(
      credentialEpochMismatch(parked, same, after),
      "credentials-expired",
    );
    assert.equal(
      credentialEpochMismatch(parked, rotated, before),
      "credentials-rotated",
    );
    // Expiry takes precedence over a rotation when both hold.
    assert.equal(
      credentialEpochMismatch(parked, rotated, after),
      "credentials-expired",
    );
  });

  it("mountCredentialsExpired checks only the mount lifetime, ignoring the secret hash", () => {
    const parked = {
      ...computeCredentialEpoch({ modelConnection: modelConnection("1") }),
      mountExpiresAtMs: Date.parse("2026-01-01T00:00:10.000Z"),
    };
    const before = Date.parse("2026-01-01T00:00:05.000Z");
    const after = Date.parse("2026-01-01T00:00:15.000Z");
    assert.equal(mountCredentialsExpired(parked, before), false);
    assert.equal(mountCredentialsExpired(parked, after), true);
    // No expiry recorded => never expired, regardless of the secret material.
    const noExpiry = computeCredentialEpoch({
      modelConnection: modelConnection("1"),
    });
    assert.equal(mountCredentialsExpired(noExpiry, after), false);
  });
});

describe("poolKeyFor", () => {
  it("prefers the run-context project scope over the mount scope", () => {
    // Both sources present: the service-stamped run-context id wins, and the source is reported.
    assert.deepEqual(
      poolKeyFor(
        { sessionId: "s1", runContext: { project: { id: "rc-proj" } } },
        "mount-proj",
      ),
      { key: "rc-proj:s1", source: "run-context" },
    );
  });
  it("uses the run-context project scope even when there is no mount scope", () => {
    assert.deepEqual(
      poolKeyFor(
        { sessionId: "s1", runContext: { project: { id: "rc-proj" } } },
        undefined,
      ),
      { key: "rc-proj:s1", source: "run-context" },
    );
  });
  it("falls back to the mount scope when the run context has no project", () => {
    assert.deepEqual(poolKeyFor({ sessionId: "s1" }, "mount-proj"), {
      key: "mount-proj:s1",
      source: "mount",
    });
    // An empty/whitespace run-context id does not count as a scope: fall back to the mount.
    assert.deepEqual(
      poolKeyFor(
        { sessionId: "s1", runContext: { project: { id: "  " } } },
        "mount-proj",
      ),
      { key: "mount-proj:s1", source: "mount" },
    );
  });
  it("is null when neither source yields a project scope (never park)", () => {
    assert.equal(poolKeyFor({ sessionId: "s1" }, undefined), null);
    assert.equal(
      poolKeyFor({ sessionId: "s1", runContext: { project: {} } }, undefined),
      null,
    );
  });
  it("is null without a session id even when a project scope exists (never park)", () => {
    assert.equal(poolKeyFor({}, "mount-proj"), null);
    assert.equal(
      poolKeyFor({ runContext: { project: { id: "rc-proj" } } }, undefined),
      null,
    );
  });
  it("the same sessionId under different projects produces different keys (kill scoping)", () => {
    // Backs the /kill contract: a same-session-id-different-project entry must not collide.
    const a = poolKeyFor(
      { sessionId: "s1", runContext: { project: { id: "proj-a" } } },
      undefined,
    );
    const b = poolKeyFor(
      { sessionId: "s1", runContext: { project: { id: "proj-b" } } },
      undefined,
    );
    assert.notEqual(a?.key, b?.key);
  });
});

describe("SessionPool destroy scoping (backs the /kill contract)", () => {
  it("destroying one project's key leaves a same-session-id different-project key parked", async () => {
    const pool = new SessionPool({ poolMax: 4 }, () => {});
    const a = parkInput("proj-a:s1");
    const b = parkInput("proj-b:s1");
    await pool.park(a.input, 10_000);
    await pool.park(b.input, 10_000);
    assert.equal(pool.size(), 2);

    await pool.destroy("proj-a:s1", "kill");

    assert.equal(a.env.state.destroyed, 1, "the scoped key was destroyed");
    assert.equal(
      b.env.state.destroyed,
      0,
      "a same-session-id different-project key survives",
    );
    assert.equal(pool.get("proj-a:s1"), undefined);
    assert.ok(pool.get("proj-b:s1"));
  });
});

describe("SessionPool", () => {
  const cfg = { poolMax: 2 };

  it("awaitingApproval finds an approval-parked session by session id, whatever the project scope", async () => {
    const pool = new SessionPool(cfg, () => {});
    const idle = parkInput("proj-a:s-idle");
    const parked = parkInput("proj-b:s-gated");
    assert.equal(await pool.park(idle.input, 10_000), true);
    assert.equal(
      await pool.park(parked.input, 10_000, "awaiting_approval"),
      true,
    );
    // Only the awaiting_approval entry matches, and only by its own session id.
    assert.equal(pool.awaitingApproval("s-idle"), undefined);
    assert.equal(pool.awaitingApproval("s-gated")?.environment, parked.env);
    assert.equal(pool.awaitingApproval("s-unknown"), undefined);
  });

  it("park then checkoutIdle returns the same session (busy) and clears the timer", async () => {
    const pool = new SessionPool(cfg, () => {});
    const { input, env } = parkInput("k1");
    assert.equal(await pool.park(input, 10_000), true);
    assert.equal(pool.size(), 1);
    const live = pool.checkoutIdle("k1");
    assert.ok(live);
    assert.equal(live!.environment, env);
    assert.equal(live!.state, "busy");
    // A busy session is not checked out again (would supersede at the dispatch).
    assert.equal(pool.checkoutIdle("k1"), undefined);
  });

  it("idle TTL expiry destroys the session", async () => {
    vi.useFakeTimers();
    try {
      const pool = new SessionPool(cfg, () => {});
      const { input, env } = parkInput("k1");
      pool.park(input, 1000);
      await vi.advanceTimersByTimeAsync(1001);
      assert.equal(env.state.destroyed, 1, "expired session is destroyed");
      assert.deepEqual(env.state.reasons, ["idle-expiry"]);
      assert.equal(pool.size(), 0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("LRU-evicts the oldest IDLE entry at the cap, never a busy one", async () => {
    const pool = new SessionPool({ poolMax: 2 }, () => {});
    const a = parkInput("a");
    const b = parkInput("b");
    const c = parkInput("c");
    pool.park(a.input, 10_000);
    // Make `a` busy so it can never be the LRU victim.
    pool.checkoutIdle("a");
    pool.park(b.input, 10_000);
    // Pool now holds a(busy) + b(idle); parking c must evict b (the only idle), not a.
    assert.equal(await pool.park(c.input, 10_000), true);
    await Promise.resolve();
    assert.equal(b.env.state.destroyed, 1, "the idle entry was evicted");
    assert.deepEqual(b.env.state.reasons, ["capacity-eviction"]);
    assert.equal(a.env.state.destroyed, 0, "the busy entry is never evicted");
    assert.deepEqual(pool.keys().sort(), ["a", "c"]);
  });

  it("strict capacity keeps a stopping seat and awaits teardown before inserting", async () => {
    let releaseTeardown: (() => void) | undefined;
    let teardownCompleted = false;
    const stoppingApplied = new AppliedState("cfg", FAKE_FACETS, {});
    const stoppingEnv = {
      state: { destroyed: 0, reasons: [] as string[] },
      get appliedState() {
        return stoppingApplied.appliedState;
      },
      commitApplied: (r: AppliedCommit) => stoppingApplied.commitApplied(r),
      teardown: async (reason: string) => {
        await new Promise<void>((resolve) => {
          releaseTeardown = resolve;
        });
        teardownCompleted = true;
        stoppingEnv.state.destroyed += 1;
        stoppingEnv.state.reasons.push(reason);
      },
    };
    const pool = new SessionPool({ poolMax: 1 }, () => {}, {
      strictCapacity: true,
    });
    await pool.park(parkInput("a", stoppingEnv).input, 10_000);

    const replacement = parkInput("b");
    const parked = pool.park(replacement.input, 10_000);
    await Promise.resolve();

    assert.equal(pool.size(), 1, "the stopping entry still consumes its seat");
    assert.equal(pool.get("a")?.state, "destroyed");
    assert.equal(pool.get("b"), undefined);
    assert.equal(pool.checkoutIdle("a"), undefined);
    assert.equal(pool.checkoutApproval("a"), undefined);

    releaseTeardown?.();
    assert.equal(await parked, true);
    assert.equal(
      teardownCompleted,
      true,
      "teardown completes before park resolves",
    );
    assert.equal(pool.get("a"), undefined);
    assert.equal(pool.get("b")?.state, "idle");
  });

  it("strict capacity returns false at cap when no idle entry exists", async () => {
    const pool = new SessionPool({ poolMax: 1 }, () => {}, {
      strictCapacity: true,
    });
    const busy = parkInput("busy");
    await pool.park(busy.input, 10_000);
    pool.checkoutIdle("busy");
    const overflow = parkInput("overflow");

    assert.equal(await pool.park(overflow.input, 10_000), false);
    assert.equal(pool.get("busy")?.state, "busy");
    assert.equal(busy.env.state.destroyed, 0);
    assert.equal(overflow.env.state.destroyed, 0);
  });

  it("strict approval checkout stays seated while it is busy", async () => {
    const pool = new SessionPool({ poolMax: 1 }, () => {}, {
      strictCapacity: true,
    });
    await pool.park(parkInput("approval").input, 10_000, "awaiting_approval");

    const live = pool.checkoutApproval("approval");

    assert.ok(live);
    assert.equal(live.state, "busy");
    assert.equal(pool.get("approval"), live);
    assert.equal(pool.size(), 1);
    assert.equal(pool.checkoutApproval("approval"), undefined);
  });

  it("a strict stopping entry cannot be checked out or reparked over", async () => {
    let releaseTeardown: (() => void) | undefined;
    const envApplied = new AppliedState("cfg", FAKE_FACETS, {});
    const environment = {
      state: { destroyed: 0, reasons: [] as string[] },
      get appliedState() {
        return envApplied.appliedState;
      },
      commitApplied: (r: AppliedCommit) => envApplied.commitApplied(r),
      teardown: async (_reason: string) =>
        new Promise<void>((resolve) => {
          releaseTeardown = resolve;
        }),
    };
    const pool = new SessionPool({ poolMax: 1 }, () => {}, {
      strictCapacity: true,
    });
    await pool.park(parkInput("a", environment).input, 10_000);
    const stopping = pool.get("a")!;
    const replacement = pool.park(parkInput("b").input, 10_000);
    await Promise.resolve();

    assert.equal(stopping.state, "destroyed");
    assert.equal(pool.checkoutIdle("a"), undefined);
    assert.equal(pool.checkoutApproval("a"), undefined);
    assert.equal(
      await pool.repark(
        stopping,
        {
          historyFingerprint: "new",
          credentialEpoch: epoch,
        },
        10_000,
      ),
      false,
    );
    assert.equal(
      pool.get("a"),
      stopping,
      "repark does not clobber the seated stop",
    );

    releaseTeardown?.();
    assert.equal(await replacement, true);
  });

  it("non-strict capacity still frees the seat before teardown completes", async () => {
    let releaseTeardown: (() => void) | undefined;
    let teardownCompleted = false;
    const nonStrictApplied = new AppliedState("cfg", FAKE_FACETS, {});
    const environment = {
      state: { destroyed: 0, reasons: [] as string[] },
      get appliedState() {
        return nonStrictApplied.appliedState;
      },
      commitApplied: (r: AppliedCommit) => nonStrictApplied.commitApplied(r),
      teardown: async (reason: string) => {
        await new Promise<void>((resolve) => {
          releaseTeardown = resolve;
        });
        teardownCompleted = true;
        environment.state.destroyed += 1;
        environment.state.reasons.push(reason);
      },
    };
    const pool = new SessionPool({ poolMax: 1 }, () => {});
    await pool.park(parkInput("a", environment).input, 10_000);

    assert.equal(await pool.park(parkInput("b").input, 10_000), true);
    assert.equal(teardownCompleted, false);
    assert.equal(pool.get("a"), undefined);
    assert.equal(pool.get("b")?.state, "idle");

    releaseTeardown?.();
    await Promise.resolve();
    assert.equal(teardownCompleted, true);
  });

  it("checkoutApproval REMOVES the session from the map (a racing request misses)", () => {
    const pool = new SessionPool(cfg, () => {});
    const { input } = parkInput("k1");
    pool.park(input, 10_000, "awaiting_approval");
    assert.equal(pool.get("k1")!.state, "awaiting_approval");
    // The idle checkout ignores an approval-parked session; the approval checkout takes it out.
    assert.equal(pool.checkoutIdle("k1"), undefined);
    const live = pool.checkoutApproval("k1");
    assert.ok(live, "the approval-parked session is checked out");
    assert.equal(live!.state, "busy");
    assert.equal(
      pool.get("k1"),
      undefined,
      "the resume turn owns it exclusively; a racing request misses the pool",
    );
    // A duplicate approval cannot check the gate out a second time.
    assert.equal(pool.checkoutApproval("k1"), undefined);
  });

  it("repark re-inserts a checked-out approval session into an EMPTY slot", async () => {
    const pool = new SessionPool(cfg, () => {});
    const { input, env } = parkInput("k1");
    pool.park(input, 10_000, "awaiting_approval");
    const live = pool.checkoutApproval("k1")!;
    const ok = await pool.repark(
      live,
      {
        historyFingerprint: "hist2",
        credentialEpoch: epoch,
      },
      10_000,
    );
    assert.equal(ok, true, "an empty slot accepts the returning session");
    assert.equal(
      pool.get("k1"),
      live,
      "the SAME session object is back in the map",
    );
    assert.equal(pool.get("k1")!.state, "idle");
    assert.equal(env.state.destroyed, 0);
  });

  it("repark refuses when a newer session occupies the slot (never clobbers it)", async () => {
    const pool = new SessionPool(cfg, () => {});
    const a = parkInput("k1");
    pool.park(a.input, 10_000, "awaiting_approval");
    const live = pool.checkoutApproval("k1")!;
    // A racing request parked a NEWER session under the same key while the resume ran.
    const b = parkInput("k1");
    pool.park(b.input, 10_000);
    const ok = await pool.repark(
      live,
      {
        historyFingerprint: "hist2",
        credentialEpoch: epoch,
      },
      10_000,
    );
    assert.equal(ok, false, "the caller must destroy the orphaned resumed env");
    assert.equal(
      pool.get("k1")!.environment,
      b.env,
      "the newer session is untouched",
    );
    await Promise.resolve();
    assert.equal(b.env.state.destroyed, 0);
  });

  it("repark never resurrects a destroyed session into an empty slot", async () => {
    const pool = new SessionPool(cfg, () => {});
    const { input, env } = parkInput("k1");
    pool.park(input, 10_000);
    const live = pool.checkoutIdle("k1")!;
    // A /kill drain destroys everything, including the checked-out-but-mapped busy session.
    await pool.destroyAll();
    assert.equal(env.state.destroyed, 1);
    const ok = await pool.repark(
      live,
      {
        historyFingerprint: "hist2",
        credentialEpoch: epoch,
      },
      10_000,
    );
    assert.equal(ok, false, "a destroyed session never returns to the pool");
    assert.equal(pool.size(), 0);
  });

  it("an awaiting_approval session is NEVER the LRU victim at the cap", async () => {
    const pool = new SessionPool({ poolMax: 2 }, () => {});
    const a = parkInput("a");
    const b = parkInput("b");
    const c = parkInput("c");
    // a is approval-parked (longer TTL), b is idle. Parking c at the cap must evict b, not a.
    pool.park(a.input, 600_000, "awaiting_approval");
    pool.park(b.input, 10_000);
    assert.equal(await pool.park(c.input, 10_000), true);
    await Promise.resolve();
    assert.equal(b.env.state.destroyed, 1, "the idle entry was evicted");
    assert.equal(
      a.env.state.destroyed,
      0,
      "the awaiting_approval entry is never LRU-evicted",
    );
    assert.deepEqual(pool.keys().sort(), ["a", "c"]);
  });

  it("approval TTL expiry destroys the session and logs approval-ttl-expire", async () => {
    vi.useFakeTimers();
    try {
      const logs: string[] = [];
      const pool = new SessionPool(cfg, (m) => logs.push(m));
      const { input, env } = parkInput("k1");
      pool.park(input, 5000, "awaiting_approval");
      await vi.advanceTimersByTimeAsync(5001);
      assert.equal(
        env.state.destroyed,
        1,
        "the expired approval session is destroyed",
      );
      assert.equal(pool.size(), 0);
      assert.ok(
        logs.some((l) => l.includes("approval-ttl-expire")),
        "the approval TTL expiry is greppable",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not park when the pool is full and nothing is idle to evict", async () => {
    const pool = new SessionPool({ poolMax: 1 }, () => {});
    const a = parkInput("a");
    pool.park(a.input, 10_000);
    pool.checkoutIdle("a"); // busy, not evictable
    const b = parkInput("b");
    assert.equal(
      await pool.park(b.input, 10_000),
      false,
      "park is best-effort; refused when full",
    );
    assert.equal(
      b.env.state.destroyed,
      0,
      "the pool did not take ownership, so it did not destroy",
    );
    assert.equal(pool.size(), 1);
  });

  it("repark returns a busy session to idle; a superseded session is not resurrected", async () => {
    const pool = new SessionPool(cfg, () => {});
    const a = parkInput("k1");
    pool.park(a.input, 10_000);
    const live = pool.checkoutIdle("k1")!;
    assert.equal(
      await pool.repark(
        live,
        {
          historyFingerprint: "h2",
          credentialEpoch: epoch,
        },
        10_000,
      ),
      true,
    );
    assert.equal(pool.get("k1")!.state, "idle");
    assert.equal(pool.get("k1")!.historyFingerprint, "h2");

    // Supersede: a new entry takes the slot; the old `live` must not be reparked.
    const live2 = pool.checkoutIdle("k1")!;
    await pool.evict("k1", "supersede", "failed-turn");
    assert.equal(
      await pool.repark(
        live2,
        {
          historyFingerprint: "h",
          credentialEpoch: epoch,
        },
        10_000,
      ),
      false,
      "a session whose slot was evicted is not resurrected",
    );
  });

  it("evict awaits the destroy, and evict/destroy are idempotent (double destroy is safe)", async () => {
    const pool = new SessionPool(cfg, () => {});
    const a = parkInput("k1");
    pool.park(a.input, 10_000);
    assert.equal(await pool.evict("k1", "test", "failed-turn"), true);
    // Awaited: the destroy has already completed by the time evict resolves.
    assert.equal(a.env.state.destroyed, 1);
    // Second evict/destroy is a no-op.
    assert.equal(await pool.evict("k1", "test", "failed-turn"), false);
    await pool.destroy("k1");
    assert.equal(
      a.env.state.destroyed,
      1,
      "the environment is destroyed exactly once",
    );
  });

  it("evict keeps its log label separate from the teardown reason", async () => {
    const pool = new SessionPool(cfg, () => {});
    const session = parkInput("k1");
    await pool.park(session.input, 10_000);
    await pool.evict("k1", "continuation-failed", "failed-turn");
    assert.deepEqual(session.env.state.reasons, ["failed-turn"]);
  });

  it("evictIfCurrent never clobbers a racing turn's freshly parked session (B supersedes busy A)", async () => {
    // The cross-turn interleaving from the review: A's continuation is in flight (busy) when B
    // arrives, supersedes A (key-based evict), and parks its OWN session under the same key.
    // A's failure cleanup must destroy only A's session — B's parked session must survive.
    const pool = new SessionPool({ poolMax: 4 }, () => {});
    const a = parkInput("k1");
    pool.park(a.input, 10_000);
    const liveA = pool.checkoutIdle("k1")!; // A's continuation begins (busy)

    // B arrives, supersedes the busy A, and parks its own session under k1.
    await pool.evict("k1", "supersede-busy", "failed-turn");
    assert.equal(a.env.state.destroyed, 1, "A was superseded and destroyed");
    const b = parkInput("k1");
    pool.park(b.input, 10_000);

    // A's continuation now fails; its cleanup is identity-checked.
    await pool.evictIfCurrent(liveA, "continuation-failed", "failed-turn");
    assert.deepEqual(a.env.state.reasons, ["failed-turn"]);

    assert.equal(pool.size(), 1, "B's parked session is still in the pool");
    assert.equal(
      pool.get("k1")!.environment,
      b.env,
      "the slot still holds B's session, not A's",
    );
    assert.equal(b.env.state.destroyed, 0, "B's session was NOT destroyed");
    assert.equal(
      a.env.state.destroyed,
      1,
      "A's own destroy is idempotent (no double teardown)",
    );
  });

  it("park AWAITS the replaced same-key session's teardown before taking the slot", async () => {
    // Two cold turns for the same key finish near each other: the second park replaces the first.
    // Both share the same durable cwd/mount, so the first's destroy (unmount/delete) must complete
    // BEFORE the successor is parked, or it could unmount the cwd out from under the new session.
    const pool = new SessionPool({ poolMax: 4 }, () => {});
    // A's destroy is gated: it does not resolve until we release it, standing in for a slow unmount.
    let releaseADestroy: (() => void) | undefined;
    const aState = { destroyed: 0, reasons: [] as string[] };
    const aApplied = new AppliedState("cfg", FAKE_FACETS, {});
    const aEnv = {
      state: aState,
      get appliedState() {
        return aApplied.appliedState;
      },
      commitApplied: (r: AppliedCommit) => aApplied.commitApplied(r),
      teardown: async (reason: string) => {
        await new Promise<void>((resolve) => {
          releaseADestroy = resolve;
        });
        aState.destroyed += 1;
        aState.reasons.push(reason);
      },
    };
    const a = parkInput("k1", aEnv);
    await pool.park(a.input, 10_000);

    const b = parkInput("k1");
    // The replacing park cannot resolve while A's teardown is still in flight.
    const parked = pool.park(b.input, 10_000);
    let settled = false;
    void parked.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(
      settled,
      false,
      "park is pending until the old destroy finishes",
    );
    assert.equal(aState.destroyed, 0, "A's destroy has not completed yet");
    assert.equal(
      pool.get("k1"),
      undefined,
      "the successor is NOT parked while the shared cwd is still being unmounted",
    );

    // Release A's teardown: only now does the successor take the slot.
    releaseADestroy?.();
    assert.equal(await parked, true);
    assert.equal(
      aState.destroyed,
      1,
      "the replaced session was destroyed first",
    );
    assert.equal(
      pool.get("k1")!.environment,
      b.env,
      "the successor holds the slot only after the old teardown completed",
    );
  });

  it("destroyAll drains every parked session", async () => {
    const pool = new SessionPool({ poolMax: 8 }, () => {});
    const inputs = ["a", "b", "c"].map((k) => parkInput(k));
    for (const p of inputs) {
      await pool.park(p.input, 10_000);
    }
    const envs = inputs.map((p) => p.env);
    assert.equal(pool.size(), 3);
    await pool.destroyAll(5000, "shutdown-idle", "shutdown-in-flight");
    assert.equal(pool.size(), 0);
    for (const env of envs) {
      assert.equal(env.state.destroyed, 1);
      assert.deepEqual(env.state.reasons, ["shutdown-idle"]);
    }
  });

  it("destroyAll gives busy sessions the in-flight shutdown reason", async () => {
    const pool = new SessionPool({ poolMax: 3 }, () => {});
    const idle = parkInput("idle");
    const busy = parkInput("busy");
    const approval = parkInput("approval");
    await pool.park(idle.input, 10_000);
    await pool.park(busy.input, 10_000);
    await pool.park(approval.input, 10_000, "awaiting_approval");
    pool.checkoutIdle("busy");
    await pool.destroyAll(5000, "shutdown-idle", "shutdown-in-flight");
    assert.deepEqual(idle.env.state.reasons, ["shutdown-idle"]);
    assert.deepEqual(busy.env.state.reasons, ["shutdown-in-flight"]);
    assert.deepEqual(approval.env.state.reasons, ["shutdown-in-flight"]);
  });

  it("destroyAll passes kill to every state for a kill drain", async () => {
    const pool = new SessionPool({ poolMax: 2 }, () => {});
    const idle = parkInput("idle");
    const busy = parkInput("busy");
    await pool.park(idle.input, 10_000);
    await pool.park(busy.input, 10_000);
    pool.checkoutIdle("busy");
    await pool.destroyAll(5000, "kill", "kill");
    assert.deepEqual(idle.env.state.reasons, ["kill"]);
    assert.deepEqual(busy.env.state.reasons, ["kill"]);
  });

  it("destroy(key, 'kill') tears down only the named tenant's session — a scoped /kill", async () => {
    // Regression for RUN-SEC-3: a scoped /kill must destroy exactly the caller's own
    // `<projectId>:<sessionId>` pool entry and leave every other tenant's parked session alone.
    const pool = new SessionPool({ poolMax: 8 }, () => {});
    const tenantA = parkInput("proj-a:sess-1");
    const tenantB = parkInput("proj-b:sess-1");
    await pool.park(tenantA.input, 10_000);
    await pool.park(tenantB.input, 10_000);
    assert.equal(pool.size(), 2);

    await pool.destroy("proj-a:sess-1", "kill");

    assert.equal(pool.size(), 1, "only tenant A's entry was removed");
    assert.deepEqual(tenantA.env.state.reasons, ["kill"]);
    assert.equal(tenantB.env.state.destroyed, 0, "tenant B is untouched");
    assert.equal(pool.get("proj-b:sess-1")?.environment, tenantB.env);
  });
});
