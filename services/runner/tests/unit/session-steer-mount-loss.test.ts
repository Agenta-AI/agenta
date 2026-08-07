/**
 * Regression tests for the steer mount-loss bug, plus unit coverage for the two mechanisms that
 * fix it: the pool RESERVATION and the warm-path MOUNT PROBE.
 *
 * ============================================================================================
 * THE BUG THESE PIN
 * ============================================================================================
 *
 * Every environment for a session derives the SAME durable cwd from the same signed mount prefix
 * (`environment-setup.ts`). A cold turn used to be invisible to the pool while it ran — nothing
 * was inserted until `park`, after `runTurn` returned — so a second request on the same session
 * mid-turn (a steer) found no entry, logged `miss`, and cold-acquired a SECOND environment onto
 * that same path. Whichever one tore down first unmounted the shared mount and `rmSync`ed the
 * shared cwd out from under the other, which was by then parked believing its mount live. The
 * next turn took the warm `hit-continue` route, which never re-acquires and therefore never
 * remounts, and the harness failed with `Path <cwd> does not exist`. The session stayed broken
 * until the pool entry aged out.
 *
 * This predates the lifecycle migration: the same scenario failed identically against
 * `origin/release/v0.109.0`.
 *
 * ============================================================================================
 * WHAT THE FAKE MODELS, AND WHY ONLY THIS MUCH
 * ============================================================================================
 *
 * `makeHost` is three booleans and three functions. It models exactly three facts about the real
 * filesystem, each lifted from production code, and nothing else:
 *
 *  1. MOUNTING IS IDEMPOTENT AND ADOPTIVE. `mountStorage` short-circuits on a live mountpoint
 *     (`mount.ts`: "already mounted (verified alive)"), so a second environment on the same path
 *     ADOPTS the first's mount rather than creating its own. This is the step that couples two
 *     environments together, and a fake that gave each environment its own mount would model a
 *     system in which the bug cannot occur.
 *  2. TEARDOWN UNMOUNTS AND THEN DELETES. `environment.destroy` unmounts `mountedCwd`, and a
 *     confirmed-gone unmount sets `durableCwdSafeToDelete`, which runs `cleanupWorkspace` ->
 *     `rmSync(cwd, { recursive: true, force: true })` (`workspace.ts`). The delete is what makes
 *     the damage outlive the unmount.
 *  3. ACQUIRE RECREATES THE DIRECTORY. `defaultLocalCwd` mkdirs the durable cwd while building the
 *     plan (`run-plan.ts`), before any mount. This is why a COLD turn always recovers and a warm
 *     one never does.
 *
 * Everything else about geesefs — credentials, FUSE, staleness, ENOTCONN — is irrelevant to this
 * failure and is deliberately absent.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type {
  AgentRunRequest,
  AgentRunResult,
  EmitEvent,
} from "../../src/protocol.ts";
import {
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/server.ts";
import {
  SessionPool,
  type LiveSession,
} from "../../src/engines/sandbox_agent/session-pool.ts";
import { appliedStateForRequest } from "../../src/engines/sandbox_agent/applied-state.ts";
import type { KeepaliveConfig } from "../../src/engines/sandbox_agent/session-identity.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";

/** The one durable cwd every environment of a given session shares. */
const CWD = "/tmp/agenta/mounts/proj-1/mount-1";
const KEY = "proj-1:session-1";

/** `Promise.withResolvers` is Node 24 but outside this package's tsc `lib` target. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The host filesystem, reduced to the two bits teardown and the harness care about. */
function makeHost() {
  const host = {
    mounted: false,
    dirExists: false,
    trace: [] as string[],
    /** Fact 1 + fact 3: acquire mkdirs, and an already-live mountpoint is adopted. */
    mount(who: string): void {
      host.dirExists = true;
      host.trace.push(
        host.mounted ? `${who}: already mounted (adopted)` : `${who}: mounted`,
      );
      host.mounted = true;
    },
    /** Fact 2: unmount, then delete through the confirmed-gone mountpoint. */
    teardown(who: string): void {
      host.trace.push(
        host.mounted
          ? `${who}: unmounted (confirmed gone)`
          : `${who}: unmount no-op`,
      );
      host.mounted = false;
      host.dirExists = false;
      host.trace.push(`${who}: rmSync`);
    },
  };
  return host;
}

type Host = ReturnType<typeof makeHost>;

interface FakeEnv {
  id: number;
  readonly appliedState: SessionEnvironment["appliedState"];
  mountedCwd: string | undefined;
  destroyed: number;
  lastTurnToolCallIds: string[];
  parkedApprovals: Map<string, unknown>;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  installedMountExpiries: Record<string, number>;
  clearTurn: () => void;
  destroy: (opts?: { reason?: string }) => Promise<void>;
}

interface EngineOptions {
  /** Runs inside `runTurn` for the given env id; the turn finishes when it resolves. */
  hold?: (envId: number, continuation: boolean) => Promise<void>;
  /** Per-env-id result override, applied after the mount check. */
  resultFor?: (
    envId: number,
    continuation: boolean,
  ) => AgentRunResult | undefined;
  /** Wired only when supplied, so "no probe" stays testable. */
  isMountAlive?: (env: SessionEnvironment) => Promise<boolean>;
  onAcquire?: (envId: number) => void;
  /**
   * The FIRST turn pauses on one parkable ACP permission gate, so the session parks as
   * `awaiting_approval` instead of `idle`. That branch holds its environment for the approval TTL
   * — minutes, against the idle TTL's seconds — so it is the more exposed of the two reuse paths.
   */
  approvalPause?: { permissionId: string; toolCallId: string; toolName: string };
}

function makeEngine(host: Host, options: EngineOptions = {}) {
  const calls = {
    acquired: [] as FakeEnv[],
    turns: [] as Array<{ envId: number; continuation: boolean }>,
  };
  let nextId = 1;

  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount(): Promise<MountCredentials> {
      return {
        region: "us-east-1",
        bucket: "agenta-store",
        prefix: "mounts/proj-1/mount-1",
        accessKey: "AK",
        secretKey: "SK",
        projectId: "proj-1",
      };
    },

    async acquireEnvironment(request) {
      const applied = appliedStateForRequest(request);
      const id = nextId++;
      const env: FakeEnv = {
        id,
        get appliedState() {
          return applied.appliedState;
        },
        mountedCwd: undefined,
        destroyed: 0,
        lastTurnToolCallIds: [],
        parkedApprovals: new Map(),
        approvalGateCount: 0,
        nonParkablePauseCount: 0,
        installedMountExpiries: {},
        clearTurn: () => {},
        destroy: async () => {
          if (env.destroyed) return;
          env.destroyed += 1;
          if (env.mountedCwd) host.teardown(`env${id}`);
        },
      };
      host.mount(`env${id}`);
      env.mountedCwd = CWD;
      calls.acquired.push(env);
      options.onAcquire?.(id);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },

    async runTurn(rawEnv, _request, emit, _signal, opts) {
      const env = rawEnv as unknown as FakeEnv;
      const continuation = !!opts.continuation;
      calls.turns.push({ envId: env.id, continuation });
      // What the harness does with a cwd that is not there. It streams the error frame first,
      // which is what makes the coordinator refuse a cold retry ("already streamed, no retry").
      if (!host.dirExists) {
        (emit as EmitEvent | undefined)?.({
          type: "error",
          message: `Path ${CWD} does not exist`,
        } as never);
        return {
          ok: false,
          error: `Internal error: Path ${CWD} does not exist`,
        };
      }
      await options.hold?.(env.id, continuation);
      const gate = options.approvalPause;
      if (gate && !opts.resume && env.parkedApprovals.size === 0) {
        env.parkedApprovals.set(gate.toolCallId, {
          gateType: "claude-acp-permission",
          permissionId: gate.permissionId,
          toolCallId: gate.toolCallId,
          toolName: gate.toolName,
          args: {},
          interactionToken: gate.toolCallId,
        });
        env.approvalGateCount = 1;
        env.lastTurnToolCallIds = [gate.toolCallId];
        return { ok: true, stopReason: "paused" };
      }
      if (opts.resume) env.parkedApprovals.clear();
      return (
        options.resultFor?.(env.id, continuation) ?? {
          ok: true,
          output: "ok",
          stopReason: "complete",
        }
      );
    },

    async runCold() {
      throw new Error(
        "runCold must not be reached: every request here is session-owned",
      );
    },

    ...(options.isMountAlive ? { isMountAlive: options.isMountAlive } : {}),
  };

  return { engine, calls };
}

function makeCtx(
  engine: KeepaliveEngine,
  overrides: Partial<KeepaliveConfig> = {},
  poolOptions: { strictCapacity?: boolean } = {},
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
    poolOptions,
  );
  return {
    ctx: { engine, pool, config } satisfies KeepaliveContext,
    pool,
    config,
  };
}

/** Minimal history (one fresh user turn), which is what the playground's steer path sends. */
function req(text: string, sessionId = "session-1"): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId,
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
    },
    messages: [{ role: "user", content: text }],
  } as AgentRunRequest;
}

const liveMount = (host: Host) => async () => host.mounted && host.dirExists;

/** An out-of-band approval answer: the parked tool call plus its result envelope. */
function approvalReply(toolCallId: string, toolName: string): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId: "session-1",
    telemetry: {
      exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
    },
    messages: [
      { role: "user", content: "edit the file" },
      {
        role: "assistant",
        content: [{ type: "tool_call", toolCallId, toolName }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolCallId, output: { approved: true } }],
      },
    ],
  } as AgentRunRequest;
}

// --- The scenario the bug report describes ----------------------------------------------- //

describe("steer: a second message while a cold turn is running", () => {
  it("keeps the session's durable cwd, and the next turn succeeds", async () => {
    const host = makeHost();
    const turn1Running = deferred();
    const steerAcquired = deferred();

    const { engine, calls } = makeEngine(host, {
      hold: async (envId, continuation) => {
        if (envId !== 1 || continuation) return;
        turn1Running.resolve();
        // The long turn runs until the steer's environment exists.
        await steerAcquired.promise;
      },
      onAcquire: (id) => {
        if (id === 2) steerAcquired.resolve();
      },
    });
    const { ctx } = makeCtx(engine);

    const first = runWithKeepalive(req("sleep 20"), () => {}, undefined, ctx);
    await turn1Running.promise;
    const steer = runWithKeepalive(
      req("actually, stop"),
      () => {},
      undefined,
      ctx,
    );
    await Promise.all([first, steer]);

    assert.equal(
      host.dirExists,
      true,
      `the durable cwd was destroyed by the steer: ${host.trace.join(" | ")}`,
    );

    const third = await runWithKeepalive(
      req("are you there?"),
      () => {},
      undefined,
      ctx,
    );
    assert.equal(
      third.ok,
      true,
      `the turn after the steer failed: ${(third as { error?: string }).error}`,
    );
    // The steer superseded the first environment rather than running beside it, so exactly two
    // environments existed and the third turn reused one of them warm.
    assert.equal(calls.acquired.length, 2);
  });

  it("supersedes the running turn instead of acquiring a rival environment", async () => {
    const host = makeHost();
    const turn1Running = deferred();
    const steerAcquired = deferred();
    // Ordering is the whole fix: the superseded environment's teardown must COMPLETE before the
    // steer's acquire mounts, or the steer adopts a mount that is about to be pulled.
    const order: string[] = [];

    const { engine } = makeEngine(host, {
      hold: async (envId, continuation) => {
        if (envId !== 1 || continuation) return;
        turn1Running.resolve();
        await steerAcquired.promise;
      },
      onAcquire: (id) => {
        order.push(`acquire:env${id}`);
        if (id === 2) steerAcquired.resolve();
      },
    });
    const { ctx } = makeCtx(engine);

    const first = runWithKeepalive(req("sleep 20"), () => {}, undefined, ctx);
    await turn1Running.promise;
    const steer = runWithKeepalive(
      req("actually, stop"),
      () => {},
      undefined,
      ctx,
    );
    await Promise.all([first, steer]);

    // env1's unmount+rmSync happened, then env2 mounted fresh — never "already mounted (adopted)".
    assert.deepEqual(order, ["acquire:env1", "acquire:env2"]);
    assert.ok(
      !host.trace.some((line) => line.includes("adopted")),
      `the steer adopted the running turn's mount: ${host.trace.join(" | ")}`,
    );
    assert.equal(host.mounted, true);
    assert.equal(host.dirExists, true);
  });

  it("survives a displaced turn that aborts (the API-side heartbeat fix)", async () => {
    // The heartbeat bug means the displaced turn is never told it was superseded, so it runs to
    // completion beside the steer. Suppose that is fixed and it aborts promptly instead: an
    // aborted turn still routes to `env.destroy({ reason: "aborted" })`, which unmounts and
    // deletes the shared cwd. Before the reservation, the abort only narrowed the race window.
    const host = makeHost();
    const turn1Running = deferred();
    const steerAcquired = deferred();

    const { engine } = makeEngine(host, {
      hold: async (envId, continuation) => {
        if (envId !== 1 || continuation) return;
        turn1Running.resolve();
        await steerAcquired.promise;
      },
      resultFor: (envId, continuation) =>
        envId === 1 && !continuation
          ? { ok: false, error: "aborted", stopReason: "aborted" }
          : undefined,
      onAcquire: (id) => {
        if (id === 2) steerAcquired.resolve();
      },
    });
    const { ctx } = makeCtx(engine);

    const first = runWithKeepalive(req("sleep 20"), () => {}, undefined, ctx);
    await turn1Running.promise;
    const steer = runWithKeepalive(
      req("actually, stop"),
      () => {},
      undefined,
      ctx,
    );
    await Promise.all([first, steer]);

    assert.equal(host.dirExists, true, host.trace.join(" | "));
    const third = await runWithKeepalive(
      req("still there?"),
      () => {},
      undefined,
      ctx,
    );
    assert.equal(
      third.ok,
      true,
      `the turn after an aborted steer failed: ${(third as { error?: string }).error}`,
    );
  });
});

// --- The reservation -------------------------------------------------------------------- //

describe("pool reservation", () => {
  it("seats the running cold turn as busy at its key", async () => {
    const host = makeHost();
    const seen: Array<string | undefined> = [];
    const running = deferred();
    const finish = deferred();

    const { engine } = makeEngine(host, {
      hold: async () => {
        running.resolve();
        await finish.promise;
      },
    });
    const { ctx, pool } = makeCtx(engine);

    const turn = runWithKeepalive(req("hello"), () => {}, undefined, ctx);
    await running.promise;
    seen.push(pool.get(KEY)?.state);
    finish.resolve();
    await turn;
    seen.push(pool.get(KEY)?.state);

    assert.deepEqual(
      seen,
      ["busy", "idle"],
      "a cold turn must occupy its key while it runs, then convert to an idle park",
    );
  });

  it("claims an occupied key BEFORE acquiring, when a checkout loses a race", async () => {
    // The one route into `coldAndPark` that can find its key still occupied: two dispatches read
    // the same idle entry, both await (a live route, or the mount probe below), and one wins
    // `checkoutIdle`. The loser falls through to a cold acquire while the winner still holds the
    // key — and the winner's durable cwd is the one the loser is about to mount. Evicting it after
    // the acquire would delete that cwd out from under the environment just built on it, so the
    // claim has to happen first.
    const host = makeHost();
    const bothInside = deferred();
    let probes = 0;
    const { engine } = makeEngine(host, {
      isMountAlive: async () => {
        probes += 1;
        if (probes === 2) bothInside.resolve();
        // Hold the first dispatch until the second is also past `pool.get(key)`, so the race is
        // forced rather than hoped for.
        await bothInside.promise;
        return host.mounted && host.dirExists;
      },
    });
    const { ctx } = makeCtx(engine);

    await runWithKeepalive(req("first"), () => {}, undefined, ctx);
    const [a, b] = await Promise.all([
      runWithKeepalive(req("race a"), () => {}, undefined, ctx),
      runWithKeepalive(req("race b"), () => {}, undefined, ctx),
    ]);

    assert.equal(
      probes,
      2,
      "both dispatches must have raced through the probe",
    );
    assert.ok(a.ok || b.ok, "at least one racer must succeed");
    assert.ok(
      !host.trace.some((line) => line.includes("adopted")),
      `the losing racer adopted the winner's live mount: ${host.trace.join(" | ")}`,
    );
    assert.equal(
      host.dirExists,
      true,
      `the durable cwd did not survive the race: ${host.trace.join(" | ")}`,
    );
  });

  it("converts the reservation into the park rather than taking a second seat", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host);
    const { ctx, pool } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);

    assert.equal(
      pool.size(),
      1,
      "the reservation and the park must be one seat, not two",
    );
    const parked = pool.get(KEY) as LiveSession<SessionEnvironment>;
    assert.equal(parked.state, "idle");
    assert.equal(
      parked.environment as unknown as FakeEnv,
      calls.acquired[0],
      "the parked entry must hold the SAME environment the reservation seated",
    );
    assert.equal(calls.acquired[0].destroyed, 0);
  });

  it("drops the reservation when the turn does not park", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host, {
      resultFor: () => ({ ok: false, error: "boom" }),
    });
    const { ctx, pool } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);

    assert.equal(
      pool.size(),
      0,
      "a non-parking turn must not leak its reserved seat",
    );
    assert.equal(calls.acquired[0].destroyed, 1);
  });

  it("drops the reservation when the turn throws", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host, {
      hold: async () => {
        throw new Error("harness exploded");
      },
    });
    const { ctx, pool } = makeCtx(engine);

    const result = await runWithKeepalive(
      req("hello"),
      () => {},
      undefined,
      ctx,
    );

    assert.equal(result.ok, false);
    assert.equal(pool.size(), 0);
    assert.equal(calls.acquired[0].destroyed, 1);
  });

  it("refuses a seat when the pool is full of busy sessions, and still runs the turn", async () => {
    // Capacity is a hard contract under strictCapacity: a reservation converts through `repark`,
    // which does not re-check the cap, so an unrefusable reserve would let concurrent cold turns
    // carry the pool past poolMax and stay there. A refusal falls back to pre-reservation
    // behavior — the turn runs unreserved and `park` competes for a seat as it always did.
    const host = makeHost();
    const { engine, calls } = makeEngine(host);
    const { ctx, pool } = makeCtx(
      engine,
      { poolMax: 1 },
      { strictCapacity: true },
    );

    await runWithKeepalive(req("first", "occupied"), () => {}, undefined, ctx);
    // Check the sole seat out so it is busy and therefore not LRU-evictable.
    pool.checkoutIdle("proj-1:occupied");

    const result = await runWithKeepalive(
      req("second", "overflow"),
      () => {},
      undefined,
      ctx,
    );

    assert.equal(
      result.ok,
      true,
      "a refused reservation must never fail the turn",
    );
    assert.equal(pool.size(), 1, "the cap must hold");
    assert.equal(
      calls.acquired[1].destroyed,
      1,
      "the unparked environment is destroyed, exactly as before reservations existed",
    );
  });
});

// --- The warm-path mount probe ----------------------------------------------------------- //

describe("warm-path mount probe", () => {
  it("rebuilds cold when the parked environment's mount is gone", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host, {
      isMountAlive: liveMount(host),
    });
    const { ctx, pool } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);
    assert.equal(pool.get(KEY)?.state, "idle");

    // Something outside this session's control pulls the mount while it sits parked.
    host.teardown("external");
    assert.equal(host.dirExists, false);

    const next = await runWithKeepalive(req("again"), () => {}, undefined, ctx);

    assert.equal(
      next.ok,
      true,
      `the probe did not heal the session: ${host.trace.join(" | ")}`,
    );
    assert.equal(
      host.dirExists,
      true,
      "the cold rebuild must recreate and remount the cwd",
    );
    assert.equal(
      calls.acquired.length,
      2,
      "the dead environment must be rebuilt, not reused",
    );
    assert.equal(
      calls.turns.filter((t) => t.continuation).length,
      0,
      "a dead mount must never be handed to a continuation",
    );
  });

  it("reuses warm when the mount is alive", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host, {
      isMountAlive: liveMount(host),
    });
    const { ctx } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);
    const next = await runWithKeepalive(req("again"), () => {}, undefined, ctx);

    assert.equal(next.ok, true);
    assert.equal(
      calls.acquired.length,
      1,
      "a live mount must not cost a rebuild",
    );
    assert.equal(calls.turns.filter((t) => t.continuation).length, 1);
  });

  it("fails open: a throwing probe reuses warm", async () => {
    // A wrong `false` costs one failed turn that evicts and retries cold. A wrong `true` would
    // cost warm reuse across the board the moment the probe itself broke, so the probe must never
    // be the thing that decides a rebuild when it cannot answer.
    const host = makeHost();
    const { engine, calls } = makeEngine(host, {
      isMountAlive: async () => {
        throw new Error("mountpoint: command not found");
      },
    });
    const { ctx } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);
    const next = await runWithKeepalive(req("again"), () => {}, undefined, ctx);

    assert.equal(next.ok, true);
    assert.equal(
      calls.acquired.length,
      1,
      "a probe that cannot answer must not force a rebuild",
    );
  });

  it("rebuilds an APPROVAL-parked session whose mount died while it waited", async () => {
    // The approval branch holds its environment for the approval TTL — minutes, waiting on a
    // human — so it is more exposed to losing its mount than the idle branch, not less.
    const host = makeHost();
    const gate = {
      permissionId: "perm-1",
      toolCallId: "tc-gate",
      toolName: "Edit",
    };
    const { engine, calls } = makeEngine(host, {
      approvalPause: gate,
      isMountAlive: liveMount(host),
    });
    const { ctx, pool } = makeCtx(engine);

    await runWithKeepalive(req("edit the file"), () => {}, undefined, ctx);
    assert.equal(
      pool.get(KEY)?.state,
      "awaiting_approval",
      "the first turn must park on its gate",
    );

    // The mount goes while the human is still deciding.
    host.teardown("external");

    const resumed = await runWithKeepalive(
      approvalReply(gate.toolCallId, gate.toolName),
      () => {},
      undefined,
      ctx,
    );

    assert.equal(
      resumed.ok,
      true,
      `the approval resume did not heal the session: ${host.trace.join(" | ")}`,
    );
    assert.equal(host.dirExists, true, "the rebuild must recreate and remount the cwd");
    assert.equal(
      calls.acquired.length,
      2,
      "a dead mount must be rebuilt, never resumed onto",
    );
    assert.equal(
      calls.turns.filter((t) => t.envId === 1).length,
      1,
      "the dead environment must not be handed the resume",
    );
  });

  it("is a no-op for an engine that does not implement it", async () => {
    const host = makeHost();
    const { engine, calls } = makeEngine(host); // no isMountAlive
    const { ctx } = makeCtx(engine);

    await runWithKeepalive(req("hello"), () => {}, undefined, ctx);
    const next = await runWithKeepalive(req("again"), () => {}, undefined, ctx);

    assert.equal(next.ok, true);
    assert.equal(calls.acquired.length, 1);
  });
});
