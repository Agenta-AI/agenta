/**
 * Unit tests for the keep-alive dispatch (`runWithKeepalive`) via a fake engine seam.
 *
 * The dispatch owns the pool policy: continue a live environment on a validated hit, otherwise
 * evict as needed and run the cold path. These tests inject a fake `KeepaliveEngine` (no live
 * harness) and a real `SessionPool`, so they exercise the real orchestration + pool.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-keepalive-dispatch.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type {
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
} from "../../src/protocol.ts";
import {
  resolveKeepaliveDispatch,
  resolveKeepaliveProvider,
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/server.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import type { KeepaliveConfig } from "../../src/engines/sandbox_agent/session-identity.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface EngineOptions {
  mountProjectId?: string | null; // null => the signed mount carries no project id
  signReturnsNull?: boolean; // resolveKeepaliveMount resolves null (no mount at all)
  mountExpiresAt?: string;
  /** Per-call runTurn results (by 0-based call index); default ok/complete. */
  turnResults?: AgentRunResult[];
  /** Per-call emitted tool-call ids the fake runTurn records on the env (by call index). */
  turnToolCallIds?: string[][];
  /** Per-call: when true, the fake runTurn streams one event through `emit` before returning
   *  its result (models a live turn that reached the client before failing). */
  turnEmits?: boolean[];
  onParkedLive?: boolean;
}

interface FakeEnv {
  id: number;
  destroyed: number;
  turnsCleared: number;
  lastTurnToolCallIds: string[];
  parkedApprovals: Map<string, unknown>;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  clearTurn: () => void;
  /** Replaceable body so a test can slow the teardown down; `destroy` stays a stable closure. */
  destroyImpl: () => Promise<void>;
  destroy: () => Promise<void>;
}

function makeEngine(options: EngineOptions = {}) {
  const calls = {
    resolveMount: 0,
    acquire: 0,
    cold: 0,
    coldPresigned: [] as Array<MountCredentials | null | undefined>,
    turns: [] as Array<{
      env: FakeEnv;
      continuation: boolean;
    }>,
    acquiredEnvs: [] as FakeEnv[],
    parkedLive: [] as FakeEnv[],
  };

  let nextEnvId = 1;
  const makeEnv = (): FakeEnv => {
    const env: FakeEnv = {
      id: nextEnvId++,
      destroyed: 0,
      turnsCleared: 0,
      lastTurnToolCallIds: [],
      parkedApprovals: new Map(),
      approvalGateCount: 0,
      nonParkablePauseCount: 0,
      clearTurn: () => {
        env.turnsCleared += 1;
      },
      destroyImpl: async () => {
        env.destroyed += 1;
      },
      // Stable closure delegating to the replaceable body — the pool captures `destroy` at
      // park time, so a test that swaps `destroyImpl` later still takes effect.
      destroy: () => env.destroyImpl(),
    };
    return env;
  };

  const signedMount = (): MountCredentials => ({
    region: "us-east-1",
    bucket: "b",
    prefix: "mounts/proj/mount",
    accessKey: "AK",
    secretKey: "SK",
    expiresAt: options.mountExpiresAt,
    projectId:
      options.mountProjectId === null
        ? undefined
        : (options.mountProjectId ?? "proj-1"),
  });

  const runOneTurn = async (
    env: FakeEnv,
    continuation: boolean,
    emit: EmitEvent | undefined,
  ): Promise<AgentRunResult> => {
    const idx = calls.turns.length;
    calls.turns.push({ env, continuation });
    env.lastTurnToolCallIds = options.turnToolCallIds?.[idx] ?? [];
    if (options.turnEmits?.[idx])
      emit?.({ type: "message_delta", id: "d1", delta: "partial" });
    return (
      options.turnResults?.[idx] ?? {
        ok: true,
        output: "ok",
        stopReason: "complete",
      }
    );
  };

  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount(_request) {
      calls.resolveMount += 1;
      if (options.signReturnsNull) return null;
      return signedMount();
    },
    async acquireEnvironment(_request, _signal, _presigned) {
      calls.acquire += 1;
      const env = makeEnv();
      calls.acquiredEnvs.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(env, _request, emit, _signal, opts) {
      return runOneTurn(env as unknown as FakeEnv, !!opts.continuation, emit);
    },
    async runCold(_request, _emit, _signal, presignedMount) {
      calls.cold += 1;
      calls.coldPresigned.push(presignedMount);
      return { ok: true, output: "cold", stopReason: "complete" };
    },
    ...(options.onParkedLive
      ? {
          async onParkedLive(env: SessionEnvironment) {
            calls.parkedLive.push(env as unknown as FakeEnv);
          },
        }
      : {}),
  };

  return { engine, calls };
}

function makeCtx(
  engine: KeepaliveEngine,
  overrides: Partial<KeepaliveConfig> = {},
  clientGone?: () => boolean,
) {
  const config: KeepaliveConfig = {
    enabled: true,
    ttlMs: 60_000,
    approvalTtlMs: 600_000,
    poolMax: 8,
    ...overrides,
  };
  const pool = new SessionPool<SessionEnvironment>(
    { poolMax: config.poolMax },
    () => {},
  );
  return { engine, pool, config, clientGone } satisfies KeepaliveContext;
}

const auth = {
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
  },
};

function turn1(sessionId = "s1"): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    ...auth,
    messages: [{ role: "user", content: "hello" }],
  };
}

// A plain continuation: turn-1 conversation + an (empty) assistant turn + a new user message.
function turn2(
  sessionId = "s1",
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    ...auth,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "more" },
    ],
    ...overrides,
  };
}

describe("runWithKeepalive: park + hit", () => {
  it("calls the live-park hook once for Daytona, never for local", async () => {
    const daytona = makeEngine({ onParkedLive: true });
    const daytonaContext = makeCtx(daytona.engine);
    await runWithKeepalive(
      { ...turn1("daytona-session"), sandbox: "daytona" },
      undefined,
      undefined,
      daytonaContext,
    );
    assert.equal(daytona.calls.parkedLive.length, 1);

    const local = makeEngine({ onParkedLive: true });
    await runWithKeepalive(
      { ...turn1("local-session"), sandbox: "local" },
      undefined,
      undefined,
      makeCtx(local.engine),
    );
    assert.equal(local.calls.parkedLive.length, 0);
  });

  it("a failing live-park hook does not fail the parked turn", async () => {
    const daytona = makeEngine({ onParkedLive: true });
    daytona.engine.onParkedLive = async () => {
      throw new Error("activity refresh boom");
    };

    const result = await runWithKeepalive(
      { ...turn1("daytona-hook-throw"), sandbox: "daytona" },
      undefined,
      undefined,
      makeCtx(daytona.engine),
    );

    assert.equal(result.ok, true, "the session is already parked; the hook is best-effort");
  });

  it("does not call the live-park hook when Daytona park overflows", async () => {
    const { engine, calls } = makeEngine({ onParkedLive: true });
    const config: KeepaliveConfig = {
      enabled: true,
      ttlMs: 60_000,
      approvalTtlMs: 60_000,
      poolMax: 1,
    };
    const pool = new SessionPool<SessionEnvironment>(
      { poolMax: 1 },
      () => {},
      { strictCapacity: true },
    );
    const context = { engine, pool, config };
    await runWithKeepalive(
      { ...turn1("occupied"), sandbox: "daytona" },
      undefined,
      undefined,
      context,
    );
    pool.checkoutIdle("proj-1:occupied");
    calls.parkedLive.length = 0;

    await runWithKeepalive(
      { ...turn1("overflow"), sandbox: "daytona" },
      undefined,
      undefined,
      context,
    );

    assert.equal(calls.parkedLive.length, 0);
    assert.equal(calls.acquiredEnvs[1].destroyed, 1);
  });

  it("parks after a cold miss and continues the SAME env on the next turn (no re-acquire)", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);

    const r1 = await runWithKeepalive(turn1(), undefined, undefined, ctx);
    assert.equal(r1.ok, true);
    assert.equal(calls.acquire, 1, "cold miss acquires once");
    assert.equal(calls.turns[0].continuation, false, "cold turn replays");
    assert.equal(ctx.pool.size(), 1, "the successful turn parked");

    const r2 = await runWithKeepalive(turn2(), undefined, undefined, ctx);
    assert.equal(r2.ok, true);
    assert.equal(calls.acquire, 1, "the continuation does NOT re-acquire");
    assert.equal(calls.turns.length, 2);
    assert.equal(
      calls.turns[1].continuation,
      true,
      "the continuation sends only the new text",
    );
    assert.equal(
      calls.turns[1].env,
      calls.turns[0].env,
      "the second turn runs on the same live environment",
    );
    assert.equal(
      calls.acquiredEnvs[0].destroyed,
      0,
      "the live env is kept alive, not destroyed",
    );
    assert.equal(ctx.pool.size(), 1, "re-parked for the next turn");
  });

  it("a tool-using turn parks and the FE's next request (assistant tool parts kept) HITS live", async () => {
    // The FE keeps an assistant turn iff it has an answer part; tool parts count, so a
    // tool-calling turn's ids ALWAYS come back in the next request. The park folds the emitted
    // ids into the expected fingerprint, so this — the feature's main audience — continues live.
    const { engine, calls } = makeEngine({
      turnToolCallIds: [["tc-1", "tc-2"]],
    });
    const ctx = makeCtx(engine);

    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    assert.equal(ctx.pool.size(), 1, "the tool-using turn parked");

    // The next request as the FE would send it: the assistant turn carries the tool parts
    // (each folding to a tool_call + tool_result block pair sharing the id) plus text.
    const next = turn2("s1", {
      messages: [
        { role: "user", content: "hello" },
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
        { role: "user", content: "more" },
      ],
    });
    const r2 = await runWithKeepalive(next, undefined, undefined, ctx);
    assert.equal(r2.ok, true);
    assert.equal(
      calls.acquire,
      1,
      "the tool-turn continuation did NOT re-acquire",
    );
    assert.equal(calls.turns[1].continuation, true, "continued live");
    assert.equal(calls.turns[1].env, calls.turns[0].env);
  });

  it("an emitted-id mismatch (history edited or ids diverged) still evicts to cold", async () => {
    const { engine, calls } = makeEngine({
      turnToolCallIds: [["tc-1", "tc-2"]],
    });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];

    const next = turn2("s1", {
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "tool_call", toolCallId: "tc-1", toolName: "read" },
            { type: "tool_call", toolCallId: "tc-DIFFERENT", toolName: "edit" },
          ],
        },
        { role: "user", content: "more" },
      ],
    });
    const r2 = await runWithKeepalive(next, undefined, undefined, ctx);
    assert.equal(r2.ok, true);
    assert.equal(env1.destroyed, 1, "the mismatched live env is destroyed");
    assert.equal(calls.acquire, 2, "cold-started a fresh env");
  });

  it("a fully empty assistant turn pruned by the FE still hits (no ids, no text)", async () => {
    // The park predicted no ids (the turn emitted none); the FE prunes the answer-less
    // assistant turn, so the next request carries neither text nor ids for it. Deterministic hit.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);

    const prunedNext = turn2("s1", {
      messages: [
        { role: "user", content: "hello" },
        { role: "user", content: "more" },
      ],
    });
    const r2 = await runWithKeepalive(prunedNext, undefined, undefined, ctx);
    assert.equal(r2.ok, true);
    assert.equal(
      calls.acquire,
      1,
      "the pruned continuation did NOT re-acquire",
    );
    assert.equal(calls.turns[1].continuation, true);
  });

  it("a different session id misses and cold-starts a separate env", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);

    await runWithKeepalive(turn1("sA"), undefined, undefined, ctx);
    await runWithKeepalive(turn2("sB"), undefined, undefined, ctx);

    assert.equal(calls.acquire, 2, "different session ids each cold-start");
    assert.equal(
      calls.turns.every((t) => t.continuation === false),
      true,
    );
    assert.equal(ctx.pool.size(), 2);
  });
});

describe("runWithKeepalive: validation mismatches degrade to cold", () => {
  async function parkThen(
    second: AgentRunRequest,
    engineOpts: EngineOptions = {},
  ) {
    const { engine, calls } = makeEngine(engineOpts);
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    await runWithKeepalive(second, undefined, undefined, ctx);
    await flush();
    return { calls, ctx, env1 };
  }

  it("config fingerprint mismatch evicts the live env and cold-starts", async () => {
    const { calls, env1 } = await parkThen(turn2("s1", { model: "m2" }));
    assert.equal(env1.destroyed, 1, "the mismatched live env is destroyed");
    assert.equal(calls.acquire, 2, "cold-started a fresh env");
  });

  it("history fingerprint mismatch (edited history) evicts to cold", async () => {
    const edited = turn2("s1", {
      messages: [
        { role: "user", content: "HELLO EDITED" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "more" },
      ],
    });
    const { calls, env1 } = await parkThen(edited);
    assert.equal(env1.destroyed, 1);
    assert.equal(calls.acquire, 2);
  });

  it("credential-epoch expiry evicts to cold", async () => {
    // The parked mount expiry is in the past, so the next turn's epoch check fails.
    const { calls, env1 } = await parkThen(turn2(), {
      mountExpiresAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(env1.destroyed, 1, "expired-credential session is destroyed");
    assert.equal(calls.acquire, 2);
  });

  it("a changed secret value evicts to cold (same config, same history)", async () => {
    const withSecret = turn2("s1", {
      secrets: { ANTHROPIC_API_KEY: "rotated" },
    });
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    // Turn 1 with the original secret.
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    await runWithKeepalive(withSecret, undefined, undefined, ctx);
    await flush();
    assert.equal(
      env1.destroyed,
      1,
      "a rotated secret invalidates the parked epoch",
    );
    assert.equal(calls.acquire, 2);
  });

  it("an approval-reply tail (not a fresh user message) stays cold", async () => {
    const approvalTail = turn2("s1", {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
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
    });
    const { calls, env1 } = await parkThen(approvalTail);
    assert.equal(env1.destroyed, 1);
    assert.equal(calls.acquire, 2);
  });
});

describe("runWithKeepalive: never-park rules", () => {
  it("no mount at all => never parks; runs cold with the null sign threaded (no re-sign)", async () => {
    const { engine, calls } = makeEngine({ signReturnsNull: true });
    const ctx = makeCtx(engine);
    const r = await runWithKeepalive(turn1(), undefined, undefined, ctx);
    assert.equal(r.output, "cold");
    assert.equal(calls.resolveMount, 1, "signed exactly once");
    assert.equal(calls.cold, 1);
    assert.equal(
      calls.coldPresigned[0],
      null,
      "the null sign result is threaded so the cold acquire does not sign again",
    );
    assert.equal(calls.acquire, 0);
    assert.equal(ctx.pool.size(), 0, "nothing parked without a safe key");
  });

  it("no mount but a run-context project scope => the turn parks mount-less (never fails)", async () => {
    // resolveKeepaliveMount legitimately returns null (store unconfigured / 503) while the
    // request carries the service-stamped runContext.project.id, so poolKeyFor still yields a
    // key. Regression (F5 review B1): the dispatch used to dereference the null mount
    // (`signed!`.expiresAt) and throw, FAILING the turn — but a keep-alive gap may only ever
    // cost a cold restart, never a failed turn. Mount-less parking is the design-correct
    // behavior: the epoch just has no mount expiry and the acquire runs on an ephemeral cwd.
    const { engine, calls } = makeEngine({ signReturnsNull: true });
    const ctx = makeCtx(engine);
    const req: AgentRunRequest = {
      ...turn1(),
      runContext: { project: { id: "proj-rc" } },
    };
    const r = await runWithKeepalive(req, undefined, undefined, ctx);
    assert.equal(r.ok, true, "the turn must not fail on a missing mount");
    assert.equal(r.output, "ok", "ran via the park path, not runCold");
    assert.equal(calls.resolveMount, 1, "signed exactly once");
    assert.equal(calls.cold, 0, "not the cold never-park path");
    assert.equal(calls.acquire, 1, "acquired through the park path");
    assert.equal(ctx.pool.size(), 1, "the session parked without a mount");
    assert.ok(
      ctx.pool.get("proj-rc:s1"),
      "the pool key scope is the run-context project id",
    );
  });

  it("a mount without a project id => never parks; the presigned creds are threaded (single sign)", async () => {
    const { engine, calls } = makeEngine({ mountProjectId: null });
    const ctx = makeCtx(engine);
    const r = await runWithKeepalive(turn1(), undefined, undefined, ctx);
    assert.equal(r.output, "cold");
    assert.equal(calls.resolveMount, 1, "signed exactly once");
    assert.equal(calls.cold, 1);
    assert.ok(
      calls.coldPresigned[0],
      "the signed creds are threaded into the cold path",
    );
    assert.equal(calls.coldPresigned[0]?.accessKey, "AK");
    assert.equal(ctx.pool.size(), 0);
  });

  it("a request without a session id runs cold, never parks", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      { ...turn1(), sessionId: undefined },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.cold, 1);
    assert.equal(
      calls.resolveMount,
      0,
      "eligibility is checked before signing",
    );
    assert.equal(
      calls.coldPresigned[0],
      undefined,
      "no up-front sign happened, so the cold acquire signs itself (still once)",
    );
    assert.equal(ctx.pool.size(), 0);
  });

  it("a Daytona provider pool can park a Daytona request", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      { ...turn1(), sandbox: "daytona" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.cold, 0);
    assert.equal(ctx.pool.size(), 1);
  });

  it("resolves local and Daytona pools and fails unknown providers closed", () => {
    assert.equal(resolveKeepaliveProvider({ sandbox: "local" }), "local");
    assert.equal(resolveKeepaliveProvider({ sandbox: "daytona" }), "daytona");
    assert.equal(resolveKeepaliveProvider({ sandbox: "e2b" }), undefined);
  });

  it("dispatches only to an enabled provider pool", () => {
    const disabled = { enabled: false, ttlMs: 0, approvalTtlMs: 0, poolMax: 20 };
    const enabled = { ...disabled, enabled: true, ttlMs: 120_000 };
    const local = { enabled: true, ttlMs: 60_000, approvalTtlMs: 300_000, poolMax: 8 };
    assert.equal(
      resolveKeepaliveDispatch(
        { sandbox: "daytona" },
        { local, daytona: disabled },
      ),
      undefined,
    );
    assert.equal(
      resolveKeepaliveDispatch(
        { sandbox: "daytona" },
        { local, daytona: enabled },
      ),
      "daytona",
    );
    assert.equal(
      resolveKeepaliveDispatch({ sandbox: "local" }, { local, daytona: enabled }),
      "local",
    );
    assert.equal(
      resolveKeepaliveDispatch({ sandbox: "e2b" }, { local, daytona: enabled }),
      undefined,
    );
  });

  it("a paused turn is NOT parked in slice 1 (destroyed as today)", async () => {
    const { engine, calls } = makeEngine({
      turnResults: [{ ok: true, stopReason: "paused" }],
    });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    await flush();
    assert.equal(calls.acquire, 1);
    assert.equal(
      calls.acquiredEnvs[0].destroyed,
      1,
      "a paused session is torn down, not parked",
    );
    assert.equal(ctx.pool.size(), 0);
  });

  it("an aborted run signal is not parked (destroy, do not park)", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    const controller = new AbortController();
    controller.abort();
    await runWithKeepalive(turn1(), undefined, controller.signal, ctx);
    await flush();
    assert.equal(calls.acquiredEnvs[0].destroyed, 1);
    assert.equal(ctx.pool.size(), 0);
  });

  it("a session-owned client disconnect (clientGone, signal NOT aborted) completes the turn but is NOT parked", async () => {
    // Session-owned streams survive disconnect: the run signal is never aborted, so the park
    // decision consults the separate clientGone flag the HTTP edge flips on response close.
    let gone = false;
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine, {}, () => gone);
    // The client drops mid-turn: the flag flips while the turn is in flight.
    const origRunTurn = engine.runTurn.bind(engine);
    engine.runTurn = async (env, request, emit, signal, opts) => {
      gone = true; // disconnect lands during the turn
      return origRunTurn(env, request, emit, signal, opts);
    };
    const r = await runWithKeepalive(turn1(), undefined, undefined, ctx);
    await flush();
    assert.equal(r.ok, true, "the turn still completes as today");
    assert.equal(
      calls.acquiredEnvs[0].destroyed,
      1,
      "the disconnected client's session is destroyed, not parked",
    );
    assert.equal(ctx.pool.size(), 0);
  });
});

describe("runWithKeepalive: races and failures", () => {
  it("a busy session is superseded (destroyed, awaited) and the new turn cold-starts", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    // Simulate an in-flight turn on the same session by checking the session out (busy).
    const key = "proj-1:s1";
    ctx.pool.checkoutIdle(key);
    assert.equal(ctx.pool.get(key)!.state, "busy");

    await runWithKeepalive(turn2(), undefined, undefined, ctx);
    assert.equal(
      env1.destroyed,
      1,
      "the busy (racing) session is superseded/destroyed (awaited, no flush needed)",
    );
    assert.equal(calls.acquire, 2, "the new turn cold-starts");
  });

  it("a continuation that returns a failed result destroys the session and retries once cold", async () => {
    const { engine, calls } = makeEngine({
      // turn 0 (cold) ok; turn 1 (continuation) fails; turn 2 (cold retry) ok.
      turnResults: [
        { ok: true, stopReason: "complete" },
        { ok: false, error: "session died" },
        { ok: true, output: "recovered", stopReason: "complete" },
      ],
    });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    const r2 = await runWithKeepalive(turn2(), undefined, undefined, ctx);
    assert.equal(env1.destroyed, 1, "the broken live session is destroyed");
    assert.equal(calls.acquire, 2, "retried once cold");
    assert.equal(r2.ok, true);
    assert.equal(r2.output, "recovered");
    assert.equal(ctx.pool.size(), 1, "the cold retry re-parked");
  });

  it("does NOT retry cold when a failed continuation already streamed to the client", async () => {
    // Streaming edge (emit defined): the continuation emits a partial answer, then fails. A cold
    // retry would push a second, successful answer after the client already saw the failed live
    // stream — a duplicate. The broken session is still evicted, but the failure is returned as-is.
    const { engine, calls } = makeEngine({
      turnResults: [
        { ok: true, stopReason: "complete" },
        { ok: false, error: "session died mid-stream" },
        { ok: true, output: "recovered", stopReason: "complete" }, // must NOT run
      ],
      turnEmits: [false, true], // the continuation streams before failing
    });
    const ctx = makeCtx(engine);
    const seen: AgentEvent[] = [];
    const emit: EmitEvent = (event) => {
      seen.push(event);
    };
    await runWithKeepalive(turn1(), emit, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    const r2 = await runWithKeepalive(turn2(), emit, undefined, ctx);

    assert.equal(
      env1.destroyed,
      1,
      "the broken live session is still destroyed",
    );
    assert.equal(
      calls.acquire,
      1,
      "no cold reacquire after the client already streamed",
    );
    assert.equal(calls.cold, 0, "no cold retry");
    assert.equal(
      r2.ok,
      false,
      "the failure is returned, not masked by a cold answer",
    );
    assert.equal(
      seen.filter((e) => e.type === "message_delta").length,
      1,
      "the client saw exactly the one live delta — no duplicated cold answer",
    );
  });

  it("eviction before a cold reacquire is AWAITED (teardown cannot overlap the new acquire)", async () => {
    // The mismatch path evicts the old env (unmounting the shared durable cwd) and then
    // cold-starts the same key. The acquire must observe the destroy as already complete.
    let destroyResolved = false;
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    // Make env1's destroy slow, and record its completion (the pool captured env1.destroy at
    // park time; the stable closure delegates to this replaceable body).
    env1.destroyImpl = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      env1.destroyed += 1;
      destroyResolved = true;
    };
    let destroyDoneAtAcquire: boolean | undefined;
    const origAcquire = engine.acquireEnvironment.bind(engine);
    engine.acquireEnvironment = async (request, signal, presigned) => {
      destroyDoneAtAcquire ??= destroyResolved;
      return origAcquire(request, signal, presigned);
    };

    await runWithKeepalive(
      turn2("s1", { model: "m2" }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      destroyDoneAtAcquire,
      true,
      "the old env's destroy completed BEFORE the cold acquire started",
    );
  });
});
