/**
 * Unit tests for the session keep-alive pool and its fingerprints (slice 1).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-pool.test.ts)
 */
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  approvalDecisionForToolCall,
  computeCredentialEpoch,
  configFingerprint,
  credentialEpochMismatch,
  credentialEpochValid,
  mountCredentialsExpired,
  expectedNextHistoryFingerprint,
  historyFingerprint,
  poolKeyFor,
  priorConversation,
  readKeepaliveConfig,
  SessionPool,
  tailIsFreshUserMessage,
  type CredentialEpoch,
} from "../../src/engines/sandbox_agent/session-pool.ts";

// A fake environment: only `destroy` matters to the pool; we count destroys. Idempotent like
// the real engine `destroy()` closure (the pool's contract): a second call is a no-op.
function fakeEnv() {
  const state = { destroyed: 0 };
  let done = false;
  return {
    state,
    destroy: async () => {
      if (done) return;
      done = true;
      state.destroyed += 1;
    },
  };
}

const epoch: CredentialEpoch = { secretsHash: "h" };

function parkInput(key: string, env = fakeEnv()) {
  return {
    input: {
      key,
      environment: env,
      configFingerprint: "cfg",
      historyFingerprint: "hist",
      credentialEpoch: epoch,
      destroy: env.destroy,
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
    "AGENTA_RUNNER_SESSION_POOL_MAX",
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

  it("defaults: off, 60s idle, 10m approval, cap 8", () => {
    assert.deepEqual(readKeepaliveConfig(), {
      enabled: false,
      ttlMs: 60_000,
      approvalTtlMs: 600_000,
      poolMax: 8,
    });
  });

  it("reads truthy spellings for the flag and positive ints for the numbers", () => {
    process.env.AGENTA_RUNNER_SESSION_KEEPALIVE = "true";
    process.env.AGENTA_RUNNER_SESSION_TTL_MS = "5000";
    process.env.AGENTA_RUNNER_SESSION_POOL_MAX = "3";
    const cfg = readKeepaliveConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.ttlMs, 5000);
    assert.equal(cfg.poolMax, 3);

    process.env.AGENTA_RUNNER_SESSION_KEEPALIVE = "off";
    assert.equal(readKeepaliveConfig().enabled, false);
    process.env.AGENTA_RUNNER_SESSION_TTL_MS = "-1";
    assert.equal(
      readKeepaliveConfig().ttlMs,
      60_000,
      "invalid falls back to default",
    );
  });
});

describe("configFingerprint", () => {
  const base: AgentRunRequest = {
    harness: "claude",
    model: "m1",
    messages: [{ role: "user", content: "hi" }],
  };

  it("ignores per-turn volatiles (messages, turnId, telemetry, secrets)", () => {
    const a = configFingerprint(base);
    const b = configFingerprint({
      ...base,
      messages: [{ role: "user", content: "totally different" }],
      turnId: "t-2",
      secrets: { ANTHROPIC_API_KEY: "sekret" },
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

  it("changes when a config-bearing field changes (model)", () => {
    assert.notEqual(
      configFingerprint(base),
      configFingerprint({ ...base, model: "m2" }),
    );
  });

  it("changes when tools change", () => {
    assert.notEqual(
      configFingerprint(base),
      configFingerprint({ ...base, tools: ["read"] }),
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
  it("same secrets + tool-callback auth hash equal; a changed secret value differs", () => {
    const a = computeCredentialEpoch({
      secrets: { A: "1" },
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    const b = computeCredentialEpoch({
      secrets: { A: "1" },
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    const c = computeCredentialEpoch({
      secrets: { A: "2" },
      toolCallback: { endpoint: "e", authorization: "z" },
    });
    assert.equal(a.secretsHash, b.secretsHash);
    assert.notEqual(
      a.secretsHash,
      c.secretsHash,
      "a rotated same-slug secret changes the hash",
    );
  });

  it("valid until the mount expiry elapses; invalid once expired", () => {
    const parked = computeCredentialEpoch(
      { secrets: { A: "1" } },
      "2026-01-01T00:00:10.000Z",
    );
    const incoming = computeCredentialEpoch({ secrets: { A: "1" } });
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
    const parked = computeCredentialEpoch({ secrets: { A: "1" } });
    const incoming = computeCredentialEpoch({ secrets: { A: "2" } });
    assert.equal(credentialEpochValid(parked, incoming, Date.now()), false);
  });

  it("credentialEpochMismatch splits the reason: expired vs rotated vs none", () => {
    const parked = computeCredentialEpoch(
      { secrets: { A: "1" } },
      "2026-01-01T00:00:10.000Z",
    );
    const same = computeCredentialEpoch({ secrets: { A: "1" } });
    const rotated = computeCredentialEpoch({ secrets: { A: "2" } });
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
    const parked = computeCredentialEpoch(
      { secrets: { A: "1" } },
      "2026-01-01T00:00:10.000Z",
    );
    const before = Date.parse("2026-01-01T00:00:05.000Z");
    const after = Date.parse("2026-01-01T00:00:15.000Z");
    assert.equal(mountCredentialsExpired(parked, before), false);
    assert.equal(mountCredentialsExpired(parked, after), true);
    // No expiry recorded => never expired, regardless of the secret material.
    const noExpiry = computeCredentialEpoch({ secrets: { A: "1" } });
    assert.equal(mountCredentialsExpired(noExpiry, after), false);
  });
});

describe("poolKeyFor", () => {
  it("is <projectId>:<sessionId> when both present", () => {
    assert.equal(poolKeyFor({ sessionId: "s1" }, "proj-1"), "proj-1:s1");
  });
  it("is null without a session id or a mount project id (never park)", () => {
    assert.equal(poolKeyFor({ sessionId: "s1" }, undefined), null);
    assert.equal(poolKeyFor({}, "proj-1"), null);
  });
});

describe("SessionPool", () => {
  const cfg = { poolMax: 2 };

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
    assert.equal(a.env.state.destroyed, 0, "the busy entry is never evicted");
    assert.deepEqual(pool.keys().sort(), ["a", "c"]);
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

  it("repark re-inserts a checked-out approval session into an EMPTY slot", () => {
    const pool = new SessionPool(cfg, () => {});
    const { input, env } = parkInput("k1");
    pool.park(input, 10_000, "awaiting_approval");
    const live = pool.checkoutApproval("k1")!;
    const ok = pool.repark(
      live,
      {
        configFingerprint: "cfg2",
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
    const ok = pool.repark(
      live,
      {
        configFingerprint: "cfg2",
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
    const ok = pool.repark(
      live,
      {
        configFingerprint: "cfg2",
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
      pool.repark(
        live,
        {
          configFingerprint: "c2",
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
    await pool.evict("k1", "supersede");
    assert.equal(
      pool.repark(
        live2,
        {
          configFingerprint: "c",
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
    assert.equal(await pool.evict("k1", "test"), true);
    // Awaited: the destroy has already completed by the time evict resolves.
    assert.equal(a.env.state.destroyed, 1);
    // Second evict/destroy is a no-op.
    assert.equal(await pool.evict("k1", "test"), false);
    await pool.destroy("k1");
    assert.equal(
      a.env.state.destroyed,
      1,
      "the environment is destroyed exactly once",
    );
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
    await pool.evict("k1", "supersede-busy");
    assert.equal(a.env.state.destroyed, 1, "A was superseded and destroyed");
    const b = parkInput("k1");
    pool.park(b.input, 10_000);

    // A's continuation now fails; its cleanup is identity-checked.
    await pool.evictIfCurrent(liveA, "continuation-failed");

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
    const aState = { destroyed: 0 };
    const aEnv = {
      state: aState,
      destroy: async () => {
        await new Promise<void>((resolve) => {
          releaseADestroy = resolve;
        });
        aState.destroyed += 1;
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
    const envs = ["a", "b", "c"].map((k) => {
      const p = parkInput(k);
      pool.park(p.input, 10_000);
      return p.env;
    });
    assert.equal(pool.size(), 3);
    await pool.destroyAll();
    assert.equal(pool.size(), 0);
    for (const env of envs) assert.equal(env.state.destroyed, 1);
  });
});
