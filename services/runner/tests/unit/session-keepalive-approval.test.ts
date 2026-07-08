/**
 * Slice 2 tests: keep-alive across approval pauses (Claude ACP permission gates only).
 *
 * Two seams:
 *  - Dispatch (`runWithKeepalive`) with a fake `KeepaliveEngine` that models a paused turn setting
 *    `env.parkedApproval`, so the pool/park/resume POLICY is exercised without a live harness.
 *  - Engine (`acquireEnvironment` / `runTurn`) with a pausable fake harness, so the real park +
 *    `respondPermission` resume MECHANICS are exercised (the gate is answered on the same live
 *    session, the held prompt continues, and the post-resume update streams to the new turn).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/session-keepalive-approval.test.ts)
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";

import type {
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
} from "../../src/protocol.ts";
import {
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/server.ts";
import {
  SessionPool,
  type KeepaliveConfig,
} from "../../src/engines/sandbox_agent/session-pool.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import {
  acquireEnvironment,
  runTurn,
  type ParkedApproval,
  type SandboxAgentDeps,
  type SessionEnvironment,
} from "../../src/engines/sandbox_agent.ts";
import { TOOL_NOT_EXECUTED_PAUSED } from "../../src/tracing/otel.ts";

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const auth = {
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
  },
};

// ---------------------------------------------------------------------------- //
// Dispatch seam: a fake engine whose runTurn scripts each turn (pause / resume). //
// ---------------------------------------------------------------------------- //

interface TurnScript {
  /** The turn pauses on a single Claude ACP permission gate (records parkedApproval). */
  approvalPause?: {
    permissionId: string;
    toolCallId: string;
    toolName?: string;
    /** How many gates pended (>1 = multi-gate; still records the first). Default 1. */
    gates?: number;
  };
  /** The turn pauses on a non-Claude gate (Pi relay / client tool): paused, no parkedApproval. */
  nonClaudePause?: boolean;
  /** Override the completed result. */
  result?: AgentRunResult;
  /** Tool-call ids the turn "emitted" (folded into the park fingerprint). */
  toolCallIds?: string[];
  /** Hold the turn pending until released (models an in-flight resume for the double-answer case). */
  hold?: boolean;
}

interface DispatchFakeEnv {
  id: number;
  destroyed: number;
  turnsCleared: number;
  lastTurnToolCallIds: string[];
  parkedApproval?: ParkedApproval;
  approvalGateCount: number;
  clearTurn: () => void;
  destroyImpl: () => Promise<void>;
  destroy: () => Promise<void>;
}

function makeApprovalEngine(
  scripts: TurnScript[] = [],
  mountOpts: { expiresAt?: string } = {},
) {
  const calls = {
    resolveMount: 0,
    acquire: 0,
    cold: 0,
    turns: [] as Array<{ env: DispatchFakeEnv; opts: any; idx: number }>,
    resumes: [] as Array<{
      permissionId: string;
      reply: string;
      toolCallId: string;
    }>,
    acquiredEnvs: [] as DispatchFakeEnv[],
    /** One control per approvalPause turn: settle the parked prompt promise from the test. */
    promptControls: [] as Array<{
      resolve: (value: unknown) => void;
      reject: (err: unknown) => void;
    }>,
  };
  const holds = new Map<number, () => void>();

  let nextEnvId = 1;
  const makeEnv = (): DispatchFakeEnv => {
    const env: DispatchFakeEnv = {
      id: nextEnvId++,
      destroyed: 0,
      turnsCleared: 0,
      lastTurnToolCallIds: [],
      parkedApproval: undefined,
      approvalGateCount: 0,
      clearTurn: () => {
        env.turnsCleared += 1;
      },
      destroyImpl: async () => {
        env.destroyed += 1;
      },
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
    expiresAt: mountOpts.expiresAt,
    projectId: "proj-1",
  });

  const applyScript = async (
    env: DispatchFakeEnv,
    opts: any,
  ): Promise<AgentRunResult> => {
    const idx = calls.turns.length;
    const script = scripts[idx] ?? {};
    // Mirror the real runTurn per-turn reset.
    env.parkedApproval = undefined;
    env.approvalGateCount = 0;
    env.lastTurnToolCallIds = script.toolCallIds ?? [];
    calls.turns.push({ env, opts, idx });
    if (opts?.resume) {
      calls.resumes.push({
        permissionId: opts.resume.permissionId,
        reply: opts.resume.reply,
        toolCallId: opts.resume.toolCallId,
      });
    }
    if (script.hold) {
      await new Promise<void>((resolve) => holds.set(idx, resolve));
    }
    if (script.approvalPause) {
      env.approvalGateCount = script.approvalPause.gates ?? 1;
      // The held original prompt: pending until the test settles it (mirrors the real Claude
      // prompt that never resolves on an unanswered gate). Carries the same swallowing catch
      // runTurn attaches, so a test-driven rejection is never unhandled.
      const promptPromise = new Promise((resolve, reject) => {
        calls.promptControls.push({ resolve, reject });
      });
      promptPromise.catch(() => {});
      env.parkedApproval = {
        gateType: "claude-acp-permission",
        permissionId: script.approvalPause.permissionId,
        toolCallId: script.approvalPause.toolCallId,
        toolName: script.approvalPause.toolName,
        args: {},
        interactionToken: script.approvalPause.toolCallId,
        promptPromise,
      };
      return { ok: true, stopReason: "paused" };
    }
    if (script.nonClaudePause) return { ok: true, stopReason: "paused" };
    return script.result ?? { ok: true, output: "ok", stopReason: "complete" };
  };

  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount(_request) {
      calls.resolveMount += 1;
      return signedMount();
    },
    async acquireEnvironment(_request, _signal, _presigned) {
      calls.acquire += 1;
      const env = makeEnv();
      calls.acquiredEnvs.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(env, _request, _emit, _signal, opts) {
      return applyScript(env as unknown as DispatchFakeEnv, opts);
    },
    async runCold(_request, _emit, _signal, _presigned) {
      calls.cold += 1;
      return { ok: true, output: "cold", stopReason: "complete" };
    },
  };

  return {
    engine,
    calls,
    releaseHold: (idx: number) => holds.get(idx)?.(),
  };
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

const POOL_KEY = "proj-1:s1";

/** A turn that pauses on a Claude ACP permission gate for tool-call `tc-gate`. */
function pauseTurn(sessionId = "s1"): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    ...auth,
    messages: [{ role: "user", content: "do X" }],
  };
}

/** The FE's approval resume: the gated assistant tool_call plus the {approved} envelope. */
function approveResume(
  approved = true,
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId: "s1",
    ...auth,
    messages: [
      { role: "user", content: "do X" },
      {
        role: "assistant",
        content: [
          { type: "tool_call", toolCallId: "tc-gate", toolName: "commit" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", toolCallId: "tc-gate", output: { approved } },
        ],
      },
    ],
    ...overrides,
  };
}

function captureStderr() {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: any) => {
    lines.push(String(chunk));
    return true;
  };
  return {
    lines,
    restore: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = orig;
    },
  };
}

describe("runWithKeepalive: approval park + resume", () => {
  it("parks a paused Claude gate in awaiting_approval, then answers it live on the resume (approve)", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
    ]);
    const ctx = makeCtx(engine);

    const r1 = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    assert.equal(r1.stopReason, "paused");
    assert.equal(ctx.pool.size(), 1, "the paused Claude gate parked");
    assert.equal(ctx.pool.get(POOL_KEY)!.state, "awaiting_approval");
    assert.equal(
      calls.acquiredEnvs[0].destroyed,
      0,
      "the parked session is kept alive, not destroyed",
    );

    const r2 = await runWithKeepalive(
      approveResume(true),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.acquire, 1, "the resume did NOT re-acquire");
    assert.equal(calls.resumes.length, 1, "the gate is answered exactly once");
    assert.equal(calls.resumes[0].permissionId, "perm-1");
    assert.equal(
      calls.resumes[0].reply,
      "once",
      "approve -> respondPermission once",
    );
    assert.equal(calls.resumes[0].toolCallId, "tc-gate");
    assert.equal(
      calls.turns[1].env,
      calls.turns[0].env,
      "the resume ran on the SAME live environment",
    );
    assert.equal(
      ctx.pool.get(POOL_KEY)!.state,
      "idle",
      "a completing resume re-parks idle",
    );
  });

  it("answers a denied gate live with reject on the resume", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    const r2 = await runWithKeepalive(
      approveResume(false),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.resumes.length, 1);
    assert.equal(
      calls.resumes[0].reply,
      "reject",
      "deny -> respondPermission reject",
    );
  });

  it("logs park-approval and resume-approve/reject", async () => {
    const cap = captureStderr();
    try {
      const { engine } = makeApprovalEngine([
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
          },
          toolCallIds: ["tc-gate"],
        },
      ]);
      const ctx = makeCtx(engine);
      await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      await runWithKeepalive(approveResume(true), undefined, undefined, ctx);
      assert.ok(cap.lines.some((l) => l.includes("park-approval")));
      assert.ok(cap.lines.some((l) => l.includes("resume-approve")));
    } finally {
      cap.restore();
    }
  });
});

describe("runWithKeepalive: never-park gate types stay cold", () => {
  it("a non-Claude gate pause (Pi relay / client-tool MCP) never parks, tears down cold", async () => {
    const cap = captureStderr();
    try {
      const { engine, calls } = makeApprovalEngine([{ nonClaudePause: true }]);
      const ctx = makeCtx(engine);
      const r = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      assert.equal(r.stopReason, "paused");
      assert.equal(
        calls.acquiredEnvs[0].destroyed,
        1,
        "no parked approval -> torn down as today",
      );
      assert.equal(ctx.pool.size(), 0, "nothing parked");
      assert.ok(cap.lines.some((l) => l.includes("non-claude-gate-no-park")));
    } finally {
      cap.restore();
    }
  });

  it("a multi-gate pause (parallel gates) never parks, tears down cold", async () => {
    const cap = captureStderr();
    try {
      const { engine, calls } = makeApprovalEngine([
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
            gates: 2,
          },
          toolCallIds: ["tc-gate"],
        },
      ]);
      const ctx = makeCtx(engine);
      const r = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      assert.equal(r.stopReason, "paused");
      assert.equal(
        calls.acquiredEnvs[0].destroyed,
        1,
        "the single-gate resume cannot answer >1 gate -> cold",
      );
      assert.equal(ctx.pool.size(), 0);
      assert.ok(cap.lines.some((l) => l.includes("multi-gate-no-park")));
    } finally {
      cap.restore();
    }
  });
});

describe("runWithKeepalive: approval resume validation degrades to cold", () => {
  async function parkThenResume(resume: AgentRunRequest) {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
      { result: { ok: true, output: "cold", stopReason: "complete" } },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    await runWithKeepalive(resume, undefined, undefined, ctx);
    return { calls, env1, ctx };
  }

  it("an edited history evicts the parked approval and cold-starts", async () => {
    const edited = approveResume(true, {
      messages: [
        { role: "user", content: "do X EDITED" },
        {
          role: "assistant",
          content: [
            { type: "tool_call", toolCallId: "tc-gate", toolName: "commit" },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-gate",
              output: { approved: true },
            },
          ],
        },
      ],
    });
    const { calls, env1 } = await parkThenResume(edited);
    assert.equal(env1.destroyed, 1, "the parked approval session is destroyed");
    assert.equal(calls.acquire, 2, "cold-started a fresh env");
    assert.equal(
      calls.resumes.length,
      0,
      "no live respondPermission on a mismatch",
    );
  });

  it("a changed config evicts the parked approval and cold-starts", async () => {
    const { calls, env1 } = await parkThenResume(
      approveResume(true, { model: "m2" }),
    );
    assert.equal(env1.destroyed, 1);
    assert.equal(calls.acquire, 2);
    assert.equal(calls.resumes.length, 0);
  });

  it("an approval for a different toolCallId (no match) evicts to cold", async () => {
    const wrongId = approveResume(true, {
      messages: [
        { role: "user", content: "do X" },
        {
          role: "assistant",
          content: [
            { type: "tool_call", toolCallId: "tc-gate", toolName: "commit" },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              toolCallId: "tc-OTHER",
              output: { approved: true },
            },
          ],
        },
      ],
    });
    const { calls, env1 } = await parkThenResume(wrongId);
    assert.equal(env1.destroyed, 1);
    assert.equal(calls.acquire, 2);
    assert.equal(calls.resumes.length, 0);
  });
});

describe("runWithKeepalive: approval lifecycle edges", () => {
  it("approval TTL expiry destroys the parked session; the next request runs cold", async () => {
    vi.useFakeTimers();
    try {
      const { engine, calls } = makeApprovalEngine([
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
          },
          toolCallIds: ["tc-gate"],
        },
        { result: { ok: true, output: "recovered", stopReason: "complete" } },
      ]);
      const ctx = makeCtx(engine, { approvalTtlMs: 5000 });
      await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      assert.equal(ctx.pool.get(POOL_KEY)!.state, "awaiting_approval");

      await vi.advanceTimersByTimeAsync(5001);
      assert.equal(
        calls.acquiredEnvs[0].destroyed,
        1,
        "the expired approval park is destroyed",
      );
      assert.equal(ctx.pool.size(), 0);

      const r2 = await runWithKeepalive(
        approveResume(true),
        undefined,
        undefined,
        ctx,
      );
      assert.equal(r2.ok, true);
      assert.equal(
        calls.acquire,
        2,
        "the next request cold-starts (pool missed)",
      );
      assert.equal(
        calls.resumes.length,
        0,
        "the cold decision-map path answers it, not respondPermission",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a client disconnect after the pause frame STILL parks the approval (the human is waiting)", async () => {
    // Slice 1 destroys a disconnected client's session; an approval park is the exception, because
    // the pause happened before the disconnect and the HUMAN who must click is still on the page.
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
    ]);
    const ctx = makeCtx(engine, {}, () => true /* clientGone */);
    const r = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    assert.equal(r.stopReason, "paused");
    assert.equal(
      calls.acquiredEnvs[0].destroyed,
      0,
      "the approval park ignores clientGone",
    );
    assert.equal(ctx.pool.get(POOL_KEY)!.state, "awaiting_approval");
  });

  it("a second identical approval while the first resume is in flight does not double-respond and does not destroy the in-flight env", async () => {
    const { engine, calls, releaseHold } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
      {
        hold: true,
        result: { ok: true, output: "resumed", stopReason: "complete" },
      },
      { result: { ok: true, output: "cold", stopReason: "complete" } },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];

    // First resume: checks the session OUT of the map (the resume turn owns it) and holds.
    const p1 = runWithKeepalive(approveResume(true), undefined, undefined, ctx);
    await flush();
    assert.equal(
      ctx.pool.get(POOL_KEY),
      undefined,
      "the checked-out session left the map; a racing request misses",
    );

    // A duplicate approval arrives mid-resume: it must NOT answer the parked gate a second
    // time, and it must NOT destroy the environment the resume is executing the tool on.
    await runWithKeepalive(approveResume(true), undefined, undefined, ctx);
    assert.equal(
      env1.destroyed,
      0,
      "the in-flight resume environment stays alive through the racing request",
    );
    releaseHold(1);
    await p1;

    assert.equal(
      calls.resumes.length,
      1,
      "respondPermission-equivalent resume happened exactly once",
    );
    assert.equal(
      calls.turns[2]?.opts?.resume,
      undefined,
      "the duplicate ran as a cold turn, not a second live resume",
    );
    // The duplicate's cold turn completed and parked a NEWER session into the slot; the resumed
    // env must not clobber it — it is destroyed only AFTER its turn finished.
    assert.equal(
      env1.destroyed,
      1,
      "the resumed env is destroyed post-turn (occupied slot), never mid-flight",
    );
    assert.equal(
      ctx.pool.get(POOL_KEY)!.environment,
      calls.acquiredEnvs[1] as unknown as SessionEnvironment,
      "the newer session parked by the duplicate keeps the slot",
    );
  });

  it("a parked prompt rejection while parked evicts the dead session; the next request runs cold", async () => {
    const cap = captureStderr();
    try {
      const { engine, calls } = makeApprovalEngine([
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
          },
          toolCallIds: ["tc-gate"],
        },
        { result: { ok: true, output: "cold", stopReason: "complete" } },
      ]);
      const ctx = makeCtx(engine);
      await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      assert.equal(ctx.pool.get(POOL_KEY)!.state, "awaiting_approval");

      // The sandbox dies mid-park: the held prompt rejects while the session is parked.
      calls.promptControls[0].reject(new Error("sandbox died mid-park"));
      await flush();
      assert.equal(
        calls.acquiredEnvs[0].destroyed,
        1,
        "the dead parked session is destroyed promptly, not at the approval TTL",
      );
      assert.equal(ctx.pool.size(), 0, "the pool slot is freed");
      assert.ok(
        cap.lines.some((l) => l.includes("parked-prompt-rejected")),
        "the rejection eviction is greppable",
      );

      const r2 = await runWithKeepalive(
        approveResume(true),
        undefined,
        undefined,
        ctx,
      );
      assert.equal(r2.ok, true);
      assert.equal(calls.acquire, 2, "the next request cold-starts");
      assert.equal(calls.resumes.length, 0, "no live resume on a dead park");
    } finally {
      cap.restore();
    }
  });

  it("a prompt rejection AFTER checkout (resume in flight) does nothing (no double-destroy)", async () => {
    const { engine, calls, releaseHold } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
        },
        toolCallIds: ["tc-gate"],
      },
      {
        hold: true,
        result: { ok: true, output: "resumed", stopReason: "complete" },
      },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];

    // The resume checks the session out, then the (already-answered) prompt rejects.
    const p1 = runWithKeepalive(approveResume(true), undefined, undefined, ctx);
    await flush();
    calls.promptControls[0].reject(new Error("late failure"));
    await flush();
    assert.equal(
      env1.destroyed,
      0,
      "the rejection watcher does not touch a checked-out session (the resume owns it)",
    );

    releaseHold(1);
    await p1;
    // The slot stayed empty, so the completed resume reparked; nothing was double-destroyed.
    assert.equal(env1.destroyed, 0);
    assert.equal(ctx.pool.get(POOL_KEY)!.state, "idle");
    assert.equal(calls.resumes.length, 1);
  });
});

// ---------------------------------------------------------------------------- //
// Engine seam: the real park + respondPermission resume mechanics.             //
// ---------------------------------------------------------------------------- //

interface FakeRun {
  id: number;
  handled: any[];
  emitted: AgentEvent[];
  /** Tool-call ids announced but not yet completed (models the real otel toolSpans map). */
  open: Set<string>;
  /** What settleOpenToolCalls settled: the orphaned-sibling record (F-024). */
  settled: Array<{ id: string; message: string }>;
}

function pausableHarness(opts: { clientTool?: boolean } = {}) {
  const calls = {
    permissionReplies: [] as Array<{ id: string; reply: string }>,
    runs: [] as FakeRun[],
    sandboxDestroyed: 0,
    sandboxDisposed: 0,
    sessionDestroyed: 0,
    logs: [] as string[],
    resolvePrompt: undefined as ((value: unknown) => void) | undefined,
    promptCount: 0,
  };
  const captured = {
    onEvent: undefined as ((event: any) => void) | undefined,
    onPermissionRequest: undefined as ((req: any) => void) | undefined,
  };

  const session = {
    id: "session-1",
    onEvent(handler: (event: any) => void) {
      captured.onEvent = handler;
    },
    onPermissionRequest(handler: (req: any) => void) {
      captured.onPermissionRequest = handler;
    },
    async respondPermission(id: string, reply: string) {
      calls.permissionReplies.push({ id, reply });
    },
    prompt(_blocks: any) {
      calls.promptCount += 1;
      // Stays pending (Claude never resolves prompt on an unanswered gate) until the test resolves
      // it — modelling the ORIGINAL prompt continuing after the parked gate is answered.
      return new Promise((resolve) => {
        calls.resolvePrompt = resolve;
      });
    },
  };

  const sandbox = {
    async createSession(_opts: any) {
      return session;
    },
    async destroySession(_id: string) {
      calls.sessionDestroyed += 1;
    },
    async destroySandbox() {
      calls.sandboxDestroyed += 1;
    },
    async dispose() {
      calls.sandboxDisposed += 1;
    },
  };

  const makeRun = (): FakeRun & Record<string, any> => {
    const run: FakeRun & Record<string, any> = {
      id: calls.runs.length + 1,
      handled: [],
      emitted: [],
      open: new Set<string>(),
      settled: [],
      start() {},
      // Track open tool calls the way the real otel run does, so settleOpenToolCalls is
      // meaningful: a tool_call opens an id, a completed/failed tool_call_update closes it.
      handleUpdate(update: any) {
        run.handled.push(update);
        const kind = update?.sessionUpdate;
        if (kind === "tool_call" && typeof update.toolCallId === "string") {
          run.open.add(update.toolCallId);
        }
        if (
          kind === "tool_call_update" &&
          (update.status === "completed" || update.status === "failed")
        ) {
          run.open.delete(update.toolCallId);
        }
      },
      emitEvent(event: AgentEvent) {
        run.emitted.push(event);
      },
      usage() {
        return { input: 0, output: 0, total: 0, cost: 0 };
      },
      setUsage() {},
      finish() {
        return "assistant output";
      },
      recordError() {},
      output() {
        return "assistant output";
      },
      async flush() {},
      events() {
        return run.emitted;
      },
      settleOpenToolCalls(
        isExcluded: (id: string) => boolean,
        message: string,
      ) {
        for (const id of [...run.open]) {
          if (isExcluded(id)) continue;
          run.open.delete(id);
          run.settled.push({ id, message });
        }
      },
      traceId() {
        return "trace-1";
      },
    };
    calls.runs.push(run);
    return run;
  };

  const deps: SandboxAgentDeps = {
    log: (message) => calls.logs.push(message),
    createLocalCwd: (durable?: string) => durable ?? "/tmp/agenta-fake-cwd",
    createDaytonaCwd: (durable?: string) =>
      durable ?? "/home/sandbox/agenta-fake-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as any,
    createPersist: () => ({}) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async () => ({ cleanup: async () => {} })) as any,
    probeCapabilities: async () =>
      ({
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
        },
      }) as any,
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: (() => makeRun()) as any,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    localRelayHost: (() => "local-relay-host") as any,
    sandboxRelayHost: (() => "sandbox-relay-host") as any,
    // A permission gate pends approval (needs a human); a client-tool gate pends via onClientTool.
    responderFactory: () => ({
      async onPermission() {
        return { kind: "pendingApproval" } as const;
      },
      async onClientTool() {
        return opts.clientTool
          ? ({ kind: "pendingApproval" } as const)
          : ({ kind: "deny" } as const);
      },
    }),
  };

  return { calls, deps, captured };
}

const engineReq: AgentRunRequest = {
  harness: "claude",
  messages: [{ role: "user", content: "do X" }],
};

function updateEvent(update: Record<string, unknown>) {
  return { payload: { update } };
}

describe("runTurn: real approval park + respondPermission resume", () => {
  it("parks a Claude ACP gate (session alive), then answers it live and streams the continuation", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    // Turn 1: the prompt runs, a Claude ACP permission gate fires, the turn pauses.
    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-gate",
        title: "commit",
        rawInput: { message: "hi" },
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tc-gate",
        name: "commit",
        rawInput: { message: "hi" },
      },
    });
    await flush();
    const r1 = await p1;

    assert.equal(r1.stopReason, "paused");
    assert.ok(env.parkedApproval, "the parked approval was recorded");
    assert.equal(env.parkedApproval!.gateType, "claude-acp-permission");
    assert.equal(env.parkedApproval!.permissionId, "perm-1");
    assert.equal(env.parkedApproval!.toolCallId, "tc-gate");
    assert.ok(
      env.parkedApproval!.promptPromise,
      "the held prompt promise is captured",
    );
    assert.deepEqual(env.lastTurnToolCallIds, ["tc-gate"]);
    assert.equal(
      calls.sessionDestroyed,
      0,
      "the parked session is NOT destroyed",
    );
    assert.equal(calls.sandboxDestroyed, 0);

    // Turn 2 (resume): the dispatch cleared the sink; answer the parked gate live.
    env.clearTurn();
    const held = env.parkedApproval!.promptPromise!;
    const p2 = runTurn(env, approveResume(true), undefined, undefined, {
      approvalParkMode: true,
      resume: {
        permissionId: "perm-1",
        reply: "once",
        toolCallId: "tc-gate",
        toolName: "commit",
        args: { message: "hi" },
        interactionToken: "tc-gate",
        promptPromise: held,
      },
    });
    await flush();
    assert.deepEqual(
      calls.permissionReplies,
      [{ id: "perm-1", reply: "once" }],
      "the gate was answered on the live session exactly once",
    );

    // The resumed tool completes: its update streams to the NEW run (pausedToolCallIds cleared).
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-gate",
        status: "completed",
        content: "committed",
      }),
    );
    // The held ORIGINAL prompt now resolves (the tool ran with its original args).
    calls.resolvePrompt!({
      stopReason: "complete",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const r2 = await p2;

    assert.equal(r2.ok, true);
    assert.equal(r2.stopReason, "complete");
    assert.equal(
      calls.promptCount,
      1,
      "no new prompt was sent; the original continued",
    );
    assert.equal(
      env.parkedApproval,
      undefined,
      "the consumed approval was reset",
    );
    assert.equal(
      calls.sessionDestroyed,
      0,
      "the live session was reused, never destroyed",
    );

    const run2 = calls.runs[1];
    assert.ok(
      run2.handled.some(
        (u: any) =>
          u.sessionUpdate === "tool_call" && u.toolCallId === "tc-gate",
      ),
      "the resume seeded the parked tool call into the new run's trace",
    );
    assert.ok(
      run2.handled.some(
        (u: any) =>
          u.sessionUpdate === "tool_call_update" && u.toolCallId === "tc-gate",
      ),
      "the post-resume tool_call_update streamed (not suppressed) into the new run",
    );

    await env.destroy();
  });

  it("forwards a reject on the resume when the decision is deny", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    captured.onPermissionRequest!({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-gate", name: "commit", rawInput: {} },
    });
    await flush();
    await p1;

    env.clearTurn();
    const held = env.parkedApproval!.promptPromise!;
    const p2 = runTurn(env, approveResume(false), undefined, undefined, {
      approvalParkMode: true,
      resume: {
        permissionId: "perm-1",
        reply: "reject",
        toolCallId: "tc-gate",
        toolName: "commit",
        args: {},
        interactionToken: "tc-gate",
        promptPromise: held,
      },
    });
    await flush();
    calls.resolvePrompt!({ stopReason: "complete" });
    await p2;

    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "reject" },
    ]);
    await env.destroy();
  });

  it("a client-tool MCP pause is NOT parkable and tears down cold, even in park mode", async () => {
    const { calls, deps, captured } = pausableHarness({ clientTool: true });
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    // A client-executor gate (spec.kind === "client") routes through pauseClientTool, which never
    // fires onUserApprovalGate, so no parkedApproval is recorded and the pause tears down as today.
    captured.onPermissionRequest!({
      id: "perm-c",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tc-client",
        name: "browser",
        spec: { kind: "client", name: "browser" },
      },
    });
    await flush();
    const r1 = await p1;

    assert.equal(r1.stopReason, "paused");
    assert.equal(
      env.parkedApproval,
      undefined,
      "a client-tool pause is not parkable",
    );
    assert.equal(
      calls.sessionDestroyed,
      1,
      "the non-parkable pause destroyed the session, exactly as today",
    );

    await env.destroy();
  });

  it("the F-024 sibling settle runs on a PARKABLE pause: the sibling settles, the gated call stays open", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    // A latch-loser sibling tool call announced BEFORE the winning gate: it can never execute
    // this turn and must be settled with the deterministic paused result, park or no park.
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-sib",
        title: "read",
        rawInput: { path: "a" },
      }),
    );
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-gate",
        title: "commit",
        rawInput: { message: "hi" },
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: {
        toolCallId: "tc-gate",
        name: "commit",
        rawInput: { message: "hi" },
      },
    });
    await flush();
    const r1 = await p1;

    assert.equal(r1.stopReason, "paused");
    assert.ok(env.parkedApproval, "the gate parked (park path)");
    const run1 = calls.runs[0];
    assert.deepEqual(
      run1.settled,
      [{ id: "tc-sib", message: TOOL_NOT_EXECUTED_PAUSED }],
      "the orphaned sibling was settled with TOOL_NOT_EXECUTED_PAUSED despite the park",
    );
    assert.ok(
      run1.open.has("tc-gate"),
      "the gated (paused) call itself stays OPEN for the live resume",
    );
    assert.equal(calls.sessionDestroyed, 0, "the park kept the session alive");

    await env.destroy();
  });

  it("the sibling settle also covers the multi-gate case the dispatch then destroys", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    // Two parallel gates: gate 1 wins the latch and pauses; at pause time gate 2's call is an
    // open non-paused sibling, so the UNCONDITIONAL settle covers it even though parkedApproval
    // is already set (the exact case an early-return-before-settle would orphan).
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-g1",
        title: "commit",
      }),
    );
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-g2",
        title: "deploy",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-1",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-g1", name: "commit", rawInput: {} },
    });
    captured.onPermissionRequest!({
      id: "perm-2",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-g2", name: "deploy", rawInput: {} },
    });
    await flush();
    const r1 = await p1;

    assert.equal(r1.stopReason, "paused");
    assert.equal(env.approvalGateCount, 2, "both pending gates were counted");
    const run1 = calls.runs[0];
    assert.deepEqual(
      run1.settled,
      [{ id: "tc-g2", message: TOOL_NOT_EXECUTED_PAUSED }],
      "the second gate's call settled as a sibling at pause time",
    );
    assert.ok(run1.open.has("tc-g1"), "the winning gate's call stays open");

    // The dispatch refuses to park a multi-gate pause and destroys: the teardown the park
    // skipped (destroySession, sandbox teardown) runs through env.destroy().
    await env.destroy();
    assert.equal(calls.sessionDestroyed, 1, "destroy tore the session down");
    assert.equal(calls.sandboxDestroyed, 1);
  });
});
