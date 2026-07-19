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
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import type { KeepaliveConfig } from "../../src/engines/sandbox_agent/session-identity.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import {
  acquireEnvironment,
  runTurn,
  type ParkedApproval,
  type SandboxAgentDeps,
  type SessionEnvironment,
} from "../../src/engines/sandbox_agent.ts";
import {
  APPROVED_EXECUTION_RESULT_UNKNOWN,
  createSandboxAgentOtel,
  DEFERRED_NOT_EXECUTED_PREFIX,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../src/tracing/otel.ts";

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
  /** The turn pauses on one or more parkable permission gates (records parkedApprovals). */
  approvalPause?: {
    permissionId: string;
    toolCallId: string;
    toolName?: string;
    /** Additional parkable gates in the same turn (parallel gated tool calls). */
    extraGates?: Array<{
      permissionId: string;
      toolCallId: string;
      toolName?: string;
    }>;
    /**
     * Override `approvalGateCount`. Defaults to the number of recorded gates. Set LARGER than the
     * recorded gates to model a gate that lacked a resumable id (count > map size -> unresumable,
     * no park).
     */
    gates?: number;
    /** Also flag a non-parkable (client-tool) pause this turn, so the mixed set stays cold. */
    nonParkable?: boolean;
    /** The parked gate plane; default the Claude ACP gate. */
    gateType?: ParkedApproval["gateType"];
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
  parkedApprovals: Map<string, ParkedApproval>;
  parkedApproval?: ParkedApproval;
  approvalGateCount: number;
  nonParkablePauseCount: number;
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
      parkedApprovals: new Map(),
      parkedApproval: undefined,
      approvalGateCount: 0,
      nonParkablePauseCount: 0,
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
    env.parkedApprovals = new Map();
    env.parkedApproval = undefined;
    env.approvalGateCount = 0;
    env.nonParkablePauseCount = 0;
    env.lastTurnToolCallIds = script.toolCallIds ?? [];
    calls.turns.push({ env, opts, idx });
    if (opts?.resume) {
      // The warm resume carries a LIST of decisions (one per parked gate).
      for (const decision of opts.resume.decisions) {
        calls.resumes.push({
          permissionId: decision.permissionId,
          reply: decision.reply,
          toolCallId: decision.toolCallId,
        });
      }
    }
    if (script.hold) {
      await new Promise<void>((resolve) => holds.set(idx, resolve));
    }
    if (script.approvalPause) {
      const gateType =
        script.approvalPause.gateType ?? "claude-acp-permission";
      const parkableGates = [
        {
          permissionId: script.approvalPause.permissionId,
          toolCallId: script.approvalPause.toolCallId,
          toolName: script.approvalPause.toolName,
        },
        ...(script.approvalPause.extraGates ?? []),
      ];
      // approvalGateCount defaults to the recorded-gate count; a larger override models a gate
      // that lacked a resumable id (count > map size -> the dispatch treats the set as unresumable).
      env.approvalGateCount = script.approvalPause.gates ?? parkableGates.length;
      env.nonParkablePauseCount = script.approvalPause.nonParkable ? 1 : 0;
      // The held original prompt: pending until the test settles it (mirrors the real Claude
      // prompt that never resolves on an unanswered gate). One prompt per turn, shared by every
      // parked gate. Carries the same swallowing catch runTurn attaches, so a test-driven
      // rejection is never unhandled.
      const promptPromise = new Promise((resolve, reject) => {
        calls.promptControls.push({ resolve, reject });
      });
      promptPromise.catch(() => {});
      for (const gate of parkableGates) {
        const record: ParkedApproval = {
          gateType,
          permissionId: gate.permissionId,
          toolCallId: gate.toolCallId,
          toolName: gate.toolName,
          args: {},
          interactionToken: gate.toolCallId,
          promptPromise,
        };
        env.parkedApprovals.set(gate.toolCallId, record);
        env.parkedApproval ??= record;
      }
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

/** A resume that answers several parked gates at once: one tool_call + one {approved} envelope
 *  per gate, exactly as the frontend sends once every card is answered. */
function approveResumeMulti(
  gates: Array<{ toolCallId: string; toolName?: string; approved: boolean }>,
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
        content: gates.map((g) => ({
          type: "tool_call",
          toolCallId: g.toolCallId,
          toolName: g.toolName ?? "commit",
        })),
      },
      {
        role: "user",
        content: gates.map((g) => ({
          type: "tool_result",
          toolCallId: g.toolCallId,
          output: { approved: g.approved },
        })),
      },
    ],
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

  it("parks and resumes a Pi DIALOG gate exactly like the Claude gate (server guard accepts it)", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-gate",
          toolName: "commit",
          gateType: "pi-acp-permission",
        },
        toolCallIds: ["tc-gate"],
      },
    ]);
    const ctx = makeCtx(engine);

    const r1 = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    assert.equal(r1.stopReason, "paused");
    assert.equal(
      ctx.pool.get(POOL_KEY)!.state,
      "awaiting_approval",
      "the Pi dialog gate parked (not rejected as an unrecognized gate type)",
    );

    const r2 = await runWithKeepalive(
      approveResume(true),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.acquire, 1, "the resume did NOT re-acquire cold");
    assert.equal(calls.resumes.length, 1, "the Pi gate is answered live once");
    assert.equal(calls.resumes[0].reply, "once");
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
      assert.ok(
        cap.lines.some((l) => l.includes("resume ") && l.includes("approve=1")),
      );
    } finally {
      cap.restore();
    }
  });

  it("parks a two-gate turn and answers BOTH gates live on one resume", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-1",
          toolName: "read_a",
          extraGates: [
            { permissionId: "perm-2", toolCallId: "tc-2", toolName: "read_b" },
          ],
        },
        toolCallIds: ["tc-1", "tc-2"],
      },
    ]);
    const ctx = makeCtx(engine);

    const r1 = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    assert.equal(r1.stopReason, "paused");
    assert.equal(
      ctx.pool.get(POOL_KEY)!.state,
      "awaiting_approval",
      "a two-gate turn parks (no longer forced cold)",
    );

    const r2 = await runWithKeepalive(
      approveResumeMulti([
        { toolCallId: "tc-1", toolName: "read_a", approved: true },
        { toolCallId: "tc-2", toolName: "read_b", approved: true },
      ]),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.acquire, 1, "the resume did NOT re-acquire cold");
    assert.equal(
      calls.resumes.length,
      2,
      "respondPermission is called once per parked gate",
    );
    assert.deepEqual(
      calls.resumes.map((r) => `${r.toolCallId}:${r.reply}`).sort(),
      ["tc-1:once", "tc-2:once"],
    );
  });

  it("resumes a two-gate turn with deny-one-approve-one, each gate answered on its own id", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-1",
          toolName: "read_a",
          extraGates: [
            { permissionId: "perm-2", toolCallId: "tc-2", toolName: "read_b" },
          ],
        },
        toolCallIds: ["tc-1", "tc-2"],
      },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);

    const r2 = await runWithKeepalive(
      approveResumeMulti([
        { toolCallId: "tc-1", toolName: "read_a", approved: false },
        { toolCallId: "tc-2", toolName: "read_b", approved: true },
      ]),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.resumes.length, 2);
    assert.deepEqual(
      calls.resumes.map((r) => `${r.toolCallId}:${r.reply}`).sort(),
      ["tc-1:reject", "tc-2:once"],
      "the denied gate rejects and the approved gate runs, each by its own id",
    );
  });

  it("keeps a partly-answered two-gate turn paused (only one card answered -> cold)", async () => {
    const { engine, calls } = makeApprovalEngine([
      {
        approvalPause: {
          permissionId: "perm-1",
          toolCallId: "tc-1",
          toolName: "read_a",
          extraGates: [
            { permissionId: "perm-2", toolCallId: "tc-2", toolName: "read_b" },
          ],
        },
        toolCallIds: ["tc-1", "tc-2"],
      },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);

    // Only tc-1 answered; tc-2 still pending. The whole-set requirement is not met, so the resume
    // does not answer any gate live and degrades to cold.
    const r2 = await runWithKeepalive(
      approveResumeMulti([
        { toolCallId: "tc-1", toolName: "read_a", approved: true },
      ]),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.resumes.length, 0, "no gate answered live");
    assert.equal(calls.acquire, 2, "the partial answer degraded to cold (re-acquired)");
  });
});

describe("runWithKeepalive: never-park gate types stay cold", () => {
  it("a non-parkable gate pause (Pi file relay / client-tool MCP) never parks, tears down cold", async () => {
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
      assert.ok(cap.lines.some((l) => l.includes("non-parkable-gate-no-park")));
    } finally {
      cap.restore();
    }
  });

  it("a turn with an unresumable gate (pending count exceeds recorded gates) stays cold", async () => {
    const cap = captureStderr();
    try {
      // Two gates pended but only one carried a resumable id (map size 1, count 2): the set is not
      // fully resumable, so the whole turn falls to the cold path.
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
        "a gate that cannot be resumed live -> cold",
      );
      assert.equal(ctx.pool.size(), 0);
      assert.ok(cap.lines.some((l) => l.includes("unresumable-gate-no-park")));
    } finally {
      cap.restore();
    }
  });

  it("a mixed set (an approval gate plus a client-tool pause) stays cold", async () => {
    const cap = captureStderr();
    try {
      // One parkable approval gate AND one non-parkable client-tool pause in the same turn: only
      // the cold path can multiplex the mixed set, so the whole turn stays cold.
      const { engine, calls } = makeApprovalEngine([
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
            nonParkable: true,
          },
          toolCallIds: ["tc-gate"],
        },
      ]);
      const ctx = makeCtx(engine);
      const r = await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
      assert.equal(r.stopReason, "paused");
      assert.equal(calls.acquiredEnvs[0].destroyed, 1, "mixed set -> cold");
      assert.equal(ctx.pool.size(), 0);
      assert.ok(cap.lines.some((l) => l.includes("mixed-gate-no-park")));
    } finally {
      cap.restore();
    }
  });
});

describe("runWithKeepalive: approval resume validation degrades to cold", () => {
  async function parkThenResume(
    resume: AgentRunRequest,
    mountOpts: { expiresAt?: string } = {},
  ) {
    const { engine, calls } = makeApprovalEngine(
      [
        {
          approvalPause: {
            permissionId: "perm-1",
            toolCallId: "tc-gate",
            toolName: "commit",
          },
          toolCallIds: ["tc-gate"],
        },
        { result: { ok: true, output: "cold", stopReason: "complete" } },
      ],
      mountOpts,
    );
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

  it("an expired parked mount evicts the approval and cold-starts (hard mount-expiry bound)", async () => {
    // The parked session's mount credentials are already past expiry: its durable cwd can no longer
    // be written, so even a matching decision + history must degrade to cold.
    const { calls, env1 } = await parkThenResume(approveResume(true), {
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    assert.equal(env1.destroyed, 1, "the expired parked session is destroyed");
    assert.equal(calls.acquire, 2, "cold-started a fresh env");
    assert.equal(
      calls.resumes.length,
      0,
      "no live respondPermission on an expired mount",
    );
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

describe("runWithKeepalive: approval resume ignores re-minted credentials/config", () => {
  // The "approve twice" bug: every approval reply is a fresh /run carrying freshly minted
  // short-lived material (gateway/Composio secret VALUES, a per-turn tool-callback bearer), so its
  // credential epoch — and often its config fingerprint (per-turn tokens embed in it) — never match
  // the parked session's. The parked live process already holds its own baked credentials; the
  // resume only delivers the human's yes/no, so a mismatch there must NOT evict the live session.
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
      { result: { ok: true, output: "resumed", stopReason: "complete" } },
    ]);
    const ctx = makeCtx(engine);
    await runWithKeepalive(pauseTurn(), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    const r2 = await runWithKeepalive(resume, undefined, undefined, ctx);
    return { calls, env1, ctx, r2 };
  }

  it("resumes LIVE when the resume carries a DIFFERENT credential epoch AND config fingerprint but a matching decision + history", async () => {
    // The resume request re-mints a fresh tool-callback bearer (changes both the config fingerprint
    // via toolCallback.endpoint and the credential epoch via secrets + toolCallback.authorization).
    const { calls, env1, r2 } = await parkThenResume(
      approveResume(true, {
        toolCallback: {
          endpoint: "https://gateway/tools/call",
          authorization: "fresh-per-turn-bearer",
        },
        secrets: { OPENAI_API_KEY: "sk-freshly-minted" },
      }),
    );
    assert.equal(r2.ok, true);
    assert.equal(
      calls.acquire,
      1,
      "no cold re-acquire; the live parked session was reused",
    );
    assert.equal(env1.destroyed, 0, "the parked session was NOT evicted");
    assert.equal(
      calls.resumes.length,
      1,
      "the gate was answered live exactly once (respondPermission)",
    );
    assert.equal(calls.resumes[0].reply, "once");
    assert.equal(calls.resumes[0].permissionId, "perm-1");
  });

  it("a changed model on the resume still resumes live (config fingerprint no longer gates the approval branch)", async () => {
    const { calls, env1, r2 } = await parkThenResume(
      approveResume(true, { model: "m2" }),
    );
    assert.equal(r2.ok, true);
    assert.equal(calls.acquire, 1, "no cold re-acquire");
    assert.equal(env1.destroyed, 0, "the parked session was reused");
    assert.equal(calls.resumes.length, 1, "answered live exactly once");
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
  sweeps: Array<{
    message: string;
    isExcluded: (id: string) => boolean;
  }>;
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
      sweeps: [],
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
        run.sweeps.push({ message, isExcluded });
        for (const id of [...run.open]) {
          if (isExcluded(id)) continue;
          run.open.delete(id);
          run.settled.push({ id, message });
        }
      },
      openToolCallIds() {
        return [...run.open];
      },
      denied: [] as string[],
      markToolCallDenied(id: string | undefined) {
        if (id) run.denied.push(id);
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
        decisions: [
          {
            permissionId: "perm-1",
            reply: "once",
            toolCallId: "tc-gate",
            toolName: "commit",
            args: { message: "hi" },
            interactionToken: "tc-gate",
            promptPromise: held,
          },
        ],
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

    assert.deepEqual(
      run2.emitted.filter((event) => event.type === "interaction_response"),
      [
        {
          type: "interaction_response",
          id: "tc-gate",
          kind: "user_approval",
          payload: { toolCallId: "tc-gate", approved: true },
        },
      ],
    );

    await env.destroy();
  });

  it("excludes an allowed execution from both pause sweeps", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const firstTurn = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-approved",
        title: "commit",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-approved",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-approved", name: "commit" },
    });
    await firstTurn;

    const held = env.parkedApproval!.promptPromise!;
    env.clearTurn();
    const resumeTurn = runTurn(env, approveResume(true), undefined, undefined, {
      approvalParkMode: true,
      resume: {
        decisions: [
          {
            permissionId: "perm-approved",
            reply: "once",
            toolCallId: "tc-approved",
            toolName: "commit",
            args: {},
            interactionToken: "tc-approved",
            promptPromise: held,
          },
        ],
      },
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-gate-2",
        title: "deploy",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-2",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-gate-2", name: "deploy" },
    });
    for (let i = 0; i < 5 && !env.currentTurn?.pause.active; i += 1) {
      await Promise.resolve();
    }
    assert.equal(env.currentTurn?.pause.active, true);
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-approved",
        status: "in_progress",
      }),
    );
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-approved",
        status: "completed",
        content: "real result",
      }),
    );
    await resumeTurn;

    const run = calls.runs[1];
    const deferredSweeps = run.sweeps.filter(
      (sweep) => sweep.message === TOOL_NOT_EXECUTED_PAUSED,
    );
    assert.ok(deferredSweeps.length >= 2);
    assert.equal(
      deferredSweeps.every((sweep) => sweep.isExcluded("tc-approved")),
      true,
    );
    assert.equal(
      run.settled.some(
        (entry) =>
          entry.id === "tc-approved" &&
          entry.message === TOOL_NOT_EXECUTED_PAUSED,
      ),
      false,
    );

    await env.destroy();
  });

  it("records an approved completion that arrives after a sibling pause", async () => {
    const { deps, captured } = pausableHarness();
    deps.createOtel = createSandboxAgentOtel as any;
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const firstTurn = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-approved",
        title: "commit",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-approved",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-approved", name: "commit" },
    });
    await firstTurn;

    const held = env.parkedApproval!.promptPromise!;
    env.clearTurn();
    const resumeTurn = runTurn(env, approveResume(true), undefined, undefined, {
      approvalParkMode: true,
      resume: {
        decisions: [
          {
            permissionId: "perm-approved",
            reply: "once",
            toolCallId: "tc-approved",
            toolName: "commit",
            args: {},
            interactionToken: "tc-approved",
            promptPromise: held,
          },
        ],
      },
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-gate-2",
        title: "deploy",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-2",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-gate-2", name: "deploy" },
    });
    for (let i = 0; i < 5 && !env.currentTurn?.pause.active; i += 1) {
      await Promise.resolve();
    }
    assert.equal(env.currentTurn?.pause.active, true);
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-approved",
        status: "completed",
        content: "approved call completed",
      }),
    );
    const result = await resumeTurn;

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const approvedResults = result.events?.filter(
      (event) => event.type === "tool_result" && event.id === "tc-approved",
    );
    assert.deepEqual(approvedResults, [
      {
        type: "tool_result",
        id: "tc-approved",
        output: "approved call completed",
        isError: false,
      },
    ]);

    await env.destroy();
  });

  it("records the non-retry sentinel when an approved result misses the bound", async () => {
    const { calls, deps, captured } = pausableHarness();
    deps.resolveRunLimits = () => ({
      totalMs: 1_000,
      idleMs: 500,
      ttfbMs: 500,
      toolCallMs: 5,
    });
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const firstTurn = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-approved",
        title: "commit",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-approved",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-approved", name: "commit" },
    });
    await firstTurn;

    const held = env.parkedApproval!.promptPromise!;
    env.clearTurn();
    const resumeTurn = runTurn(env, approveResume(true), undefined, undefined, {
      approvalParkMode: true,
      resume: {
        decisions: [
          {
            permissionId: "perm-approved",
            reply: "once",
            toolCallId: "tc-approved",
            toolName: "commit",
            args: {},
            interactionToken: "tc-approved",
            promptPromise: held,
          },
        ],
      },
    });
    await flush();
    captured.onEvent!(
      updateEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tc-gate-2",
        title: "deploy",
      }),
    );
    captured.onPermissionRequest!({
      id: "perm-2",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-gate-2", name: "deploy" },
    });
    const result = await resumeTurn;

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.runs[1].settled.filter((entry) => entry.id === "tc-approved"),
      [
        {
          id: "tc-approved",
          message: APPROVED_EXECUTION_RESULT_UNKNOWN,
        },
      ],
    );
    assert.equal(
      APPROVED_EXECUTION_RESULT_UNKNOWN.startsWith(
        DEFERRED_NOT_EXECUTED_PREFIX,
      ),
      false,
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
        decisions: [
          {
            permissionId: "perm-1",
            reply: "reject",
            toolCallId: "tc-gate",
            toolName: "commit",
            args: {},
            interactionToken: "tc-gate",
            promptPromise: held,
          },
        ],
      },
    });
    await flush();
    calls.resolvePrompt!({ stopReason: "complete" });
    await p2;

    assert.deepEqual(calls.permissionReplies, [
      { id: "perm-1", reply: "reject" },
    ]);
    assert.deepEqual(
      calls.runs[1].emitted.filter(
        (event) => event.type === "interaction_response",
      ),
      [
        {
          type: "interaction_response",
          id: "tc-gate",
          kind: "user_approval",
          payload: { toolCallId: "tc-gate", approved: false },
        },
      ],
    );
    await env.destroy();
  });

  it("a client-tool MCP pause is NOT parkable and tears down cold, even in park mode", async () => {
    const { calls, deps, captured } = pausableHarness({ clientTool: true });
    // The client spec is resolved by NAME from the run's customTools (the run plan, built here)
    // — a real ACP tool-call never carries the spec inline.
    const clientReq: AgentRunRequest = {
      ...engineReq,
      customTools: [{ name: "browser", kind: "client" }],
    };
    const acquired = await acquireEnvironment(clientReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, clientReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    // A client-executor gate (spec.kind === "client") routes through pauseClientTool, which never
    // fires onUserApprovalGate, so no parkedApproval is recorded and the pause tears down as today.
    captured.onPermissionRequest!({
      id: "perm-c",
      availableReplies: ["once", "reject"],
      toolCall: { toolCallId: "tc-client", name: "browser" },
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
    // An announced-but-UNGATED sibling tool call (it never raises a permission request, so it gets
    // no card): it can never execute once the turn pauses on the gate, so it must be settled with
    // the deterministic paused result, park or no park.
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

  it("two parallel gates each emit a card and BOTH park (neither is force-settled)", async () => {
    const { calls, deps, captured } = pausableHarness();
    const acquired = await acquireEnvironment(engineReq, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    const env = acquired.env;

    const p1 = runTurn(env, engineReq, undefined, undefined, {
      approvalParkMode: true,
    });
    await flush();
    // Two parallel gated tool calls in one turn. With no latch, each raises its own permission
    // request, emits its own card, and is marked paused — so NEITHER is force-settled, and BOTH
    // are recorded in parkedApprovals for the live resume.
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
    assert.equal(env.parkedApprovals.size, 2, "both gates were parked");
    assert.deepEqual(
      [...env.parkedApprovals.keys()].sort(),
      ["tc-g1", "tc-g2"],
      "each gate is keyed by its own tool-call id",
    );
    assert.equal(
      env.nonParkablePauseCount,
      0,
      "no non-parkable pause -> the dispatch parks the whole set",
    );
    const run1 = calls.runs[0];
    assert.deepEqual(
      run1.settled,
      [],
      "neither gate is force-settled: both got a card and are held for the resume",
    );
    assert.ok(run1.open.has("tc-g1"), "the first gate's call stays open");
    assert.ok(run1.open.has("tc-g2"), "the second gate's call stays open");
    assert.equal(
      calls.sessionDestroyed,
      0,
      "the multi-gate park keeps the session alive",
    );

    await env.destroy();
  });
});
