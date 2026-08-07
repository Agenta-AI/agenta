/**
 * The two LIVE routes, end to end through the dispatch (lifecycle migration, step 6).
 *
 * This is the first genuine behavior change in the lifecycle work: a configuration change that
 * used to throw away a warm sandbox now mutates it in place. These tests exist to prove the
 * guards, not the happy path — the happy path is one assertion and the guards are the reason it
 * is safe.
 *
 * WHAT MUST HOLD:
 *  - Only a plan that is ENTIRELY live-applicable takes the route. A mixed plan rebuilds.
 *  - Applied state advances ONLY when the whole plan applied.
 *  - Any refusal or throw falls back to a rebuild. Fail closed.
 *  - Credentials and continuity never reach the route at all.
 *
 * Run: pnpm exec vitest run tests/unit/lifecycle-live-routes.test.ts
 */
import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import {
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/server.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import {
  appliedStateForRequest,
  type AppliedEnvironmentState,
} from "../../src/engines/sandbox_agent/applied-state.ts";
import {
  configFingerprint,
  type KeepaliveConfig,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  daytonaCredentialCapabilities,
  localCredentialCapabilities,
  mechanismForRotation,
  slotKey,
  type CredentialDeliveryCapabilities,
  type CredentialDeliveryPort,
  type CredentialSlotKey,
} from "../../src/providers/credential-delivery-port.ts";
import {
  isLivelyApplicable,
  LIVE_ACTION_KINDS,
  planReconcile,
  reconcileCounters,
  resetReconcileCounters,
} from "../../src/lifecycle/reconciliation-router.ts";
import { normalizeDesiredState } from "../../src/lifecycle/desired-state.ts";
import { buildPlan } from "../../src/lifecycle/reconcile-plan.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";

type AppliedCommit = Parameters<
  ReturnType<typeof appliedStateForRequest>["commitApplied"]
>[0];

beforeEach(() => {
  resetReconcileCounters();
});

interface FakeEnv {
  id: number;
  readonly appliedState: AppliedEnvironmentState;
  commitApplied: (result: AppliedCommit) => void;
  destroyed: number;
  destroyReasons: string[];
  turnsCleared: number;
  lastTurnToolCallIds: string[];
  parkedApprovals: Map<string, unknown>;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  installedMountExpiries: Record<string, number>;
  clearTurn: () => void;
  destroy: (opts?: { reason?: string }) => Promise<void>;
}

interface EngineOptions {
  /** How the applier behaves: apply everything, refuse, or throw. */
  apply?: "ok" | "refuse" | "throw";
  /** Omit `applyReconcilePlan` entirely, modelling an engine with no live support. */
  noApplier?: boolean;
  /**
   * The credential-delivery port every acquired environment offers, or none.
   *
   * NONE IS THE DEFAULT, and it is what makes every other test in this file describe the local
   * provider: no port means no live credential route, which is the honest answer for an
   * environment whose values are baked into a frozen daemon environment.
   */
  credentialPort?: CredentialDeliveryPort;
}

function makeEngine(options: EngineOptions = {}) {
  const calls = {
    acquire: 0,
    turns: [] as FakeEnv[],
    applied: [] as Array<{ actions: string[] }>,
    acquiredEnvs: [] as FakeEnv[],
  };
  let nextId = 1;

  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount(): Promise<MountCredentials | null> {
      return {
        region: "us-east-1",
        bucket: "b",
        prefix: "p",
        accessKey: "AK",
        secretKey: "SK",
        projectId: "proj-1",
      } as MountCredentials;
    },
    async acquireEnvironment(request) {
      calls.acquire += 1;
      const applied = appliedStateForRequest(request);
      const env: FakeEnv = {
        id: nextId++,
        get appliedState() {
          return applied.appliedState;
        },
        commitApplied: (r) => applied.commitApplied(r),
        destroyed: 0,
        destroyReasons: [],
        turnsCleared: 0,
        lastTurnToolCallIds: [],
        parkedApprovals: new Map(),
        approvalGateCount: 0,
        nonParkablePauseCount: 0,
        installedMountExpiries: {},
        ...(options.credentialPort
          ? { credentialDelivery: options.credentialPort }
          : {}),
        clearTurn: () => {
          env.turnsCleared += 1;
        },
        destroy: async (opts) => {
          env.destroyed += 1;
          if (opts?.reason) env.destroyReasons.push(opts.reason);
        },
      };
      calls.acquiredEnvs.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(env): Promise<AgentRunResult> {
      calls.turns.push(env as unknown as FakeEnv);
      return { ok: true, output: "ok", stopReason: "complete" };
    },
    async runCold(): Promise<AgentRunResult> {
      return { ok: true, output: "cold", stopReason: "complete" };
    },
    ...(options.noApplier
      ? {}
      : {
          async applyReconcilePlan(env, request, plan) {
            calls.applied.push({ actions: plan.actions.map((a) => a.kind) });
            if (options.apply === "throw") throw new Error("apply blew up");
            if (options.apply === "refuse") return false;
            // The real applier commits only after every action succeeded. Model that exactly.
            const fp = configFingerprint(request);
            (env as unknown as FakeEnv).commitApplied({
              configFingerprint: fp,
              facets: normalizeDesiredState(request, fp).digests,
            });
            return true;
          },
        }),
  };
  return { engine, calls };
}

function makeCtx(engine: KeepaliveEngine): KeepaliveContext {
  const config: KeepaliveConfig = {
    enabled: true,
    ttlMs: 60_000,
    approvalTtlMs: 600_000,
    poolMax: 8,
  };
  return {
    engine,
    pool: new SessionPool<SessionEnvironment>({ poolMax: 8 }, () => {}),
    config,
    // The propagation hold is real in production — it is what keeps applied state from advancing
    // over a value the egress layer has probably not picked up yet. Ten seconds per rotation test
    // would buy the assertions nothing, so the seam exists and the tests use it.
    credentialWait: async () => {},
  };
}

/**
 * A provider that CAN deliver a rotation to a live sandbox, standing in for Daytona.
 *
 * It consumes each holder exactly as the real port does, because `DisclosableSecret` is use-once
 * and a fake that skips the read would hide a double-delivery bug rather than catch it.
 */
function makeCredentialPort(
  capabilities: CredentialDeliveryCapabilities = daytonaCredentialCapabilities,
) {
  const deliveries: string[][] = [];
  const port: CredentialDeliveryPort = {
    capabilities,
    environmentId: "fake-sandbox",
    async deliver(_plan, desired) {
      const keys: CredentialSlotKey[] = [];
      for (const entry of desired.entries) {
        await entry.secret.useOnce(async () => undefined);
        keys.push(slotKey(entry.slot));
      }
      deliveries.push(keys);
      return { ok: true, slotKeys: keys };
    },
  };
  return { port, deliveries };
}

/** A model connection whose one opaque credential carries `value`. Rotating it moves the epoch. */
const withSecret = (value: string, req: AgentRunRequest): AgentRunRequest => ({
  ...req,
  modelConnection: {
    provider: "openai",
    deployment: "direct",
    endpoint: { baseUrl: "https://api.openai.com/v1" },
    credentialMode: "env",
    credentials: [
      {
        binding: { kind: "environment", name: "OPENAI_API_KEY" },
        value,
        usage: "opaque_http",
      },
    ],
  } as never,
});

const POOL_KEY = "proj-1:s1";

const turn1: AgentRunRequest = {
  harness: "claude",
  model: "m1",
  sessionId: "s1",
  agentsMd: "original instructions",
  runContext: { project: { id: "proj-1" } },
  messages: [{ role: "user", content: "hello" }],
};

/** A continuation carrying the same conversation plus a fresh user turn. */
function turn2(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    ...turn1,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "more" },
    ],
    ...overrides,
  };
}

describe("the live-route gate", () => {
  it("declares EXACTLY the authorized kinds, plus the trivial no-op", () => {
    // DELIBERATE EDIT. `reopen-session` LEFT the live set. `env.reopenSession` closes over the
    // session init the environment was BUILT with, so a reopen reinstalls the old MCP list,
    // prompts and harness files while the turn keeps serving the old tool catalog from
    // `env.plan`. Applying it would commit the incoming configuration as applied after
    // installing none of it. It returns when the turn builds both from the incoming request
    // (adapter-matrix.md section 8, steps 1 and 2).
    //
    // The guard still matters: this list is the single place that says how many routes are live,
    // and a fourth entry must be a decision, never an accident.
    assert.deepEqual([...LIVE_ACTION_KINDS].sort(), [
      "apply-live",
      "no-op",
      "refresh-workspace",
    ]);
    assert.ok(
      !LIVE_ACTION_KINDS.has("reopen-session"),
      "a reopen reinstalls the captured session init; it delivers nothing new",
    );
    assert.ok(
      !LIVE_ACTION_KINDS.has("restart-runtime"),
      "a runtime restart is not live: it loses everything installed in the daemon",
    );
    assert.ok(
      !LIVE_ACTION_KINDS.has("rebuild-sandbox"),
      "a rebuild is the opposite of a live route",
    );
  });

  it("refuses a plan containing ANY non-live action", () => {
    // All or nothing. Applying the live half of a mixed plan would leave the environment in a
    // state no request ever described.
    assert.equal(
      isLivelyApplicable(
        buildPlan(
          [
            { facet: "workspaceFiles", kind: "refresh-workspace", reason: "r" },
            { facet: "runtime", kind: "restart-runtime", reason: "r" },
          ],
          ["workspaceFiles", "runtime"],
        ),
      ),
      false,
    );
  });

  it("accepts a plan made only of live actions", () => {
    assert.equal(
      isLivelyApplicable(
        buildPlan(
          [
            { facet: "workspaceFiles", kind: "refresh-workspace", reason: "r" },
            { facet: "model", kind: "apply-live", reason: "r" },
          ],
          ["workspaceFiles", "model"],
        ),
      ),
      true,
    );
  });

  it("refuses a plan carrying a session reopen", () => {
    assert.equal(
      isLivelyApplicable(
        buildPlan(
          [{ facet: "harnessFiles", kind: "reopen-session", reason: "r" }],
          ["harnessFiles"],
        ),
      ),
      false,
    );
  });
});

describe("LIVE ROUTE: an instructions change reuses the warm environment", () => {
  it("does not rebuild, and runs the turn on the SAME environment", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];

    await runWithKeepalive(
      turn2({ agentsMd: "REWRITTEN instructions" }),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(
      calls.acquire,
      1,
      "the warm sandbox survives an instructions change",
    );
    assert.equal(env1.destroyed, 0);
    assert.equal(calls.turns.length, 2);
    assert.equal(calls.turns[1].id, env1.id);
    assert.deepEqual(calls.applied[0].actions, ["refresh-workspace"]);
  });

  it("advances applied state to the NEW configuration", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    const before = env1.appliedState.generation;

    const next = turn2({ agentsMd: "REWRITTEN instructions" });
    await runWithKeepalive(next, undefined, undefined, ctx);

    assert.equal(
      env1.appliedState.configFingerprint,
      configFingerprint(next),
      "the environment now reports what it actually applied",
    );
    assert.ok(env1.appliedState.generation > before, "the generation advanced");
  });
});

describe("LIVE ROUTE: a model change applies to the running session", () => {
  it("does not rebuild", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(turn2({ model: "m2" }), undefined, undefined, ctx);
    assert.equal(calls.acquire, 1);
    assert.deepEqual(calls.applied[0].actions, ["apply-live"]);
  });

  it("both live routes in one plan still reuse", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({ model: "m2", agentsMd: "REWRITTEN" }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 1);
    assert.deepEqual(calls.applied[0].actions, [
      "refresh-workspace",
      "apply-live",
    ]);
  });
});

describe("FAIL CLOSED: everything that must still rebuild", () => {
  it("a MIXED plan rebuilds, and never applies the live half", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    // Instructions (live) plus a model-connection change (restart-runtime: NOT live).
    await runWithKeepalive(
      turn2({
        agentsMd: "REWRITTEN",
        modelConnection: {
          provider: "openai",
          deployment: "direct",
          credentialMode: "env",
          credentials: [],
        } as never,
      }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 2, "a mixed plan rebuilds");
    assert.equal(
      calls.applied.length,
      0,
      "and the applier is never called, so the live half never lands",
    );
  });

  it("a REFUSED apply rebuilds", async () => {
    const { engine, calls } = makeEngine({ apply: "refuse" });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];
    const before = env1.appliedState.configFingerprint;

    await runWithKeepalive(
      turn2({ agentsMd: "REWRITTEN" }),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(calls.acquire, 2);
    assert.equal(
      env1.appliedState.configFingerprint,
      before,
      "a refusal must leave applied state exactly where it was",
    );
  });

  it("a THROWING apply rebuilds rather than failing the turn", async () => {
    const { engine, calls } = makeEngine({ apply: "throw" });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    const result = await runWithKeepalive(
      turn2({ agentsMd: "REWRITTEN" }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      result.ok,
      true,
      "a live-route failure must never fail the turn",
    );
    assert.equal(calls.acquire, 2);
  });

  it("an engine with NO applier keeps the old rebuild behavior exactly", async () => {
    const { engine, calls } = makeEngine({ noApplier: true });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({ agentsMd: "REWRITTEN" }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      calls.acquire,
      2,
      "the optional seam degrades to today's behavior",
    );
  });

  it("a CREDENTIAL change never reaches the CONFIG applier", async () => {
    // Two routes, kept apart on purpose. A rotation is delivered by `runCredentialDelivery`
    // against the provider's port, never by `applyReconcilePlan`: the config applier reconfigures
    // an environment from facet digests, and credential values are in no digest. On a provider
    // with no delivery port there is no live route at all and the rotation rebuilds.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      withSecret("sk-a", turn1),
      undefined,
      undefined,
      ctx,
    );
    await runWithKeepalive(
      withSecret("sk-b", turn2()),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      calls.acquire,
      2,
      "with no delivery port, a rotation rebuilds",
    );
    assert.equal(
      calls.applied.length,
      0,
      "and never reaches the config applier",
    );

    const delivering = makeEngine({
      credentialPort: makeCredentialPort().port,
    });
    const ctx2 = makeCtx(delivering.engine);
    await runWithKeepalive(
      withSecret("sk-a", turn1),
      undefined,
      undefined,
      ctx2,
    );
    await runWithKeepalive(
      withSecret("sk-b", turn2()),
      undefined,
      undefined,
      ctx2,
    );
    assert.equal(
      delivering.calls.acquire,
      1,
      "with a port, it is delivered live",
    );
    assert.equal(
      delivering.calls.applied.length,
      0,
      "and STILL never reaches the config applier",
    );
  });

  it("a rotation that ALSO moves non-deliverable material rebuilds", async () => {
    // The refusal that keeps the route honest. A `local_use` credential is read by the provider
    // SDK inside the sandbox, so it is baked into the daemon environment and no vault update
    // reaches it — while `configFingerprint` strips credential VALUES, so its rotation is
    // invisible to the config route and surfaces only as a moved epoch. Delivering the opaque half
    // and reusing would leave the run authenticating with a stale key while reporting success.
    const withBoth = (
      opaque: string,
      localUse: string,
      req: AgentRunRequest,
    ): AgentRunRequest => ({
      ...req,
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v1" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: opaque,
            usage: "opaque_http",
          },
          {
            binding: { kind: "environment", name: "AWS_SECRET_ACCESS_KEY" },
            value: localUse,
            usage: "local_use",
          },
        ],
      } as never,
    });
    const { port, deliveries } = makeCredentialPort();
    const { engine, calls } = makeEngine({ credentialPort: port });
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      withBoth("sk-a", "aws-a", turn1),
      undefined,
      undefined,
      ctx,
    );
    await runWithKeepalive(
      withBoth("sk-b", "aws-b", turn2()),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 2, "it must rebuild, not deliver");
    assert.equal(deliveries.length, 0, "and must not touch a single record");
  });

  it("a TRANSCRIPT mismatch never reaches the live route", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({
        messages: [
          { role: "user", content: "EDITED" },
          { role: "assistant", content: "hi" },
          { role: "user", content: "more" },
        ],
      }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 2);
    assert.equal(calls.applied.length, 0);
  });
});

describe("the disagreement counters go quiet for the two live routes", () => {
  it("an instructions change records an AGREEMENT, not a disagreement", async () => {
    const { engine } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({ agentsMd: "REWRITTEN" }),
      undefined,
      undefined,
      ctx,
    );

    const counters = reconcileCounters();
    assert.equal(
      counters.disagree["refresh-workspace"] ?? 0,
      0,
      "the workspace route must be silent",
    );
    assert.ok((counters.agree["refresh-workspace"] ?? 0) > 0);
  });

  it("a model change records an AGREEMENT", async () => {
    const { engine } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(turn2({ model: "m2" }), undefined, undefined, ctx);

    const counters = reconcileCounters();
    assert.equal(counters.disagree["apply-live"] ?? 0, 0);
    assert.ok((counters.agree["apply-live"] ?? 0) > 0);
  });

  it("a TRANSCRIPT mismatch is excluded by scope, not counted as a disagreement", async () => {
    // The improvement the shadow surfaced. The coordinator rebuilds the CONVERSATION while the
    // router plans a no-op for the ENVIRONMENT: both correct, different questions. Counting it
    // would have left a permanent false positive no router work could ever drive to zero.
    const { engine } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({
        messages: [
          { role: "user", content: "EDITED" },
          { role: "assistant", content: "hi" },
          { role: "user", content: "more" },
        ],
      }),
      undefined,
      undefined,
      ctx,
    );

    const counters = reconcileCounters();
    assert.ok(
      counters.skippedByScope > 0,
      "the continuity decision was excluded",
    );
    assert.equal(
      Object.values(counters.disagree).reduce((a, b) => a + b, 0),
      0,
      "and it did NOT land in the disagreement tally",
    );
  });

  it("CLOSED: a rotated credential is delivered LIVE, and nothing disagrees", async () => {
    // THIS TEST IS THE RECORD OF THE GAP, REWRITTEN TWICE RATHER THAN DELETED, AND THIS IS ITS
    // FINAL FORM. It began by asserting that a rotated credential MUST show up as a disagreement,
    // because credential values are kept out of every facet digest (digests are logged) and the
    // router therefore could not see a rotation at all. Step 8 taught the router to see one, and
    // the test became an agreement on `rebuild-sandbox` — the honest answer for a provider that
    // bakes values into a frozen daemon environment, and the only arm that was wired at the time.
    //
    // IT NOW PINS THE ARM THE LANE EXISTS FOR. The sandbox holds a placeholder, the provider states
    // a propagation bound, so the rotation is `rotate-in-place` -> `apply-live`, and the
    // coordinator DELIVERS it instead of evicting: the same environment serves the next turn.
    // That is Q5, asserted end to end through the dispatch.
    //
    // The total-disagreement assertion is the completion signal for the whole shadow-routing arc:
    // every route the router can plan matches the decision the coordinator makes.
    const { port, deliveries } = makeCredentialPort();
    const { engine, calls } = makeEngine({ credentialPort: port });
    const ctx = makeCtx(engine);
    // EVERY LINE THE DISPATCH WRITES, captured. The rule the whole credential design is built
    // around is that no value, no digest of a value, and no length may appear in a log line, and
    // the only way to assert a rule about logs is to read the logs.
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      written.push(String(chunk));
      return (realWrite as (...args: never[]) => boolean)(
        chunk as never,
        ...(rest as never[]),
      );
    }) as typeof process.stderr.write;
    try {
      await runWithKeepalive(
        withSecret("sk-a", turn1),
        undefined,
        undefined,
        ctx,
      );
      await runWithKeepalive(
        withSecret("sk-b", turn2()),
        undefined,
        undefined,
        ctx,
      );
    } finally {
      process.stderr.write = realWrite;
    }

    const logged = written.join("");
    assert.ok(
      logged.includes("credential-route"),
      "the route must be greppable",
    );
    for (const forbidden of ["sk-a", "sk-b", "OPENAI_API_KEY"]) {
      assert.equal(
        logged.includes(forbidden),
        false,
        `no log line may carry ${forbidden}`,
      );
    }

    assert.equal(calls.acquire, 1, "the rotation must not rebuild the sandbox");
    assert.equal(deliveries.length, 1, "it was delivered, exactly once");
    assert.equal(calls.turns.length, 2);
    assert.equal(
      calls.turns[0],
      calls.turns[1],
      "and the second turn ran on the SAME environment",
    );
    assert.equal(calls.acquiredEnvs[0]?.destroyed, 0, "nothing was torn down");

    const counters = reconcileCounters();
    assert.equal(
      Object.values(counters.disagree).reduce((a, b) => a + b, 0),
      0,
      "a rotated credential must no longer disagree",
    );
    assert.ok(
      (counters.agree["apply-live"] ?? 0) > 0,
      "the rotation must be COUNTED, as an agreement on the live route",
    );
  });

  it("the delivered material becomes the parked epoch, so the next turn is a plain hit", async () => {
    // The credential half of "applied state advances only on success". If the parked epoch kept
    // the OLD material after a successful delivery, every later turn would re-detect the same
    // rotation and deliver it again forever — a warm session that pays a propagation hold on every
    // turn, which is worse than the rebuild this route replaced.
    const { port, deliveries } = makeCredentialPort();
    const { engine, calls } = makeEngine({ credentialPort: port });
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      withSecret("sk-a", turn1),
      undefined,
      undefined,
      ctx,
    );
    await runWithKeepalive(
      withSecret("sk-b", turn2()),
      undefined,
      undefined,
      ctx,
    );
    // A third turn continuing the same conversation, carrying the SAME rotated material.
    const turn3 = turn2({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "more" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "again" },
      ],
    });
    await runWithKeepalive(
      withSecret("sk-b", turn3),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(
      deliveries.length,
      1,
      "the unchanged material delivers nothing",
    );
    assert.equal(calls.acquire, 1);
    assert.equal(calls.turns.length, 3);
  });

  it("a FAILED delivery destroys the sandbox with the reason the failure carried", async () => {
    // FAIL CLOSED. A half-delivered credential is worse than no delivery, so the failure carries
    // its own disposition — `runtime-incompatible`, which DELETES rather than parks — and the
    // coordinator uses that rather than re-deriving one from a label.
    const failing: CredentialDeliveryPort = {
      capabilities: daytonaCredentialCapabilities,
      environmentId: "fake-sandbox-failing",
      async deliver() {
        return { ok: false, reason: "vault-update-failed" };
      },
    };
    const { engine, calls } = makeEngine({ credentialPort: failing });
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      withSecret("sk-a", turn1),
      undefined,
      undefined,
      ctx,
    );
    await runWithKeepalive(
      withSecret("sk-b", turn2()),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(calls.acquire, 2, "a failed delivery rebuilds");
    assert.deepEqual(calls.acquiredEnvs[0]?.destroyReasons, [
      "runtime-incompatible",
    ]);
  });

  it("an UNBOUNDED provider still rebuilds, and agrees with the router about it", async () => {
    // The constraint that survived Mahmoud's override: the ruling was that Daytona HAS a
    // propagation signal, not that the signal is optional. With the bound gone the coordinator
    // refuses the delivery and the router plans a rebuild, so the two still agree.
    const { port, deliveries } = makeCredentialPort({
      ...daytonaCredentialCapabilities,
      egressPropagation: { kind: "unbounded" },
    });
    const { engine, calls } = makeEngine({ credentialPort: port });
    const ctx = makeCtx(engine);
    await runWithKeepalive(
      withSecret("sk-a", turn1),
      undefined,
      undefined,
      ctx,
    );
    await runWithKeepalive(
      withSecret("sk-b", turn2()),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(calls.acquire, 2);
    assert.equal(deliveries.length, 0, "nothing was delivered");
    const counters = reconcileCounters();
    assert.equal(
      Object.values(counters.disagree).reduce((a, b) => a + b, 0),
      0,
    );
    assert.ok((counters.agree["rebuild-sandbox"] ?? 0) > 0);
  });

  it("routes a rotation by what the PROVIDER can actually deliver", () => {
    // RULING A and RULING B of the external security review, pinned as data.
    //
    // The dedicated credential-route test the review required. It exists because the exact-set
    // guard over `LIVE_ACTION_KINDS` cannot catch this: `apply-live` was already a member, so
    // putting a CREDENTIAL on that route widens what may happen live while the guard stays silent.
    // This test is what makes the widening visible.
    const unbounded: CredentialDeliveryCapabilities = {
      ...daytonaCredentialCapabilities,
      egressPropagation: { kind: "unbounded" },
    };

    // LOCAL: the value is baked into a daemon environment frozen before the daemon starts, and
    // this provider cannot restart a consumer, so nothing short of a rebuild delivers.
    assert.equal(
      mechanismForRotation(localCredentialCapabilities),
      "rebuild-sandbox",
    );

    // DAYTONA: the sandbox holds a stable placeholder and the provider states that a rotated value
    // reaches outbound traffic within seconds, so the rotation is genuinely live — nothing inside
    // the sandbox changes, because the reference it holds is unchanged. This is Mahmoud's Q5
    // ruling (option 2), overriding the review's rebuild recommendation on the grounds that
    // rotating in Agenta revokes nothing anyway and the sandbox never holds the raw key.
    assert.equal(
      mechanismForRotation(daytonaCredentialCapabilities),
      "rotate-in-place",
    );

    // THE CONSTRAINT THAT SURVIVED THE OVERRIDE, and the reason this arm exists: a provider with
    // NO propagation signal is still ineligible. The ruling was that Daytona HAS a signal, not
    // that the signal is optional. Take the bound away and the route must fall back to a rebuild —
    // never to a restart, which behind a reference would install the same placeholder and deliver
    // nothing while reporting success.
    assert.equal(mechanismForRotation(unbounded), "rebuild-sandbox");
  });

  it("keeps the STRONGER repair when a rotation and a runtime change collide", () => {
    // Both land on the `runtime` facet, and `applyReconcilePlan` iterates actions in facet order:
    // two actions on one facet would run it twice. The plan keeps the more expensive one, because
    // a facet that needs both repairs needs whichever is stronger.
    const before = turn1;
    const after = { ...turn2(), model: "m2" } as AgentRunRequest;
    const plan = planReconcile(
      after,
      normalizeDesiredState(after, configFingerprint(after)),
      normalizeDesiredState(before, configFingerprint(before)).digests,
      { mechanism: "rebuild-sandbox" },
    );
    const runtimeActions = plan.actions.filter((a) => a.facet === "runtime");
    assert.equal(runtimeActions.length, 1, "one action per facet, always");
    assert.equal(runtimeActions[0]?.kind, "rebuild-sandbox");
    assert.equal(plan.outcome, "rebuild");
  });
});

describe("route selection matches the facet diff", () => {
  const digestsOf = (r: AgentRunRequest) =>
    normalizeDesiredState(r, configFingerprint(r)).digests;

  const routeFor = (overrides: Partial<AgentRunRequest>) => {
    const next = { ...turn1, ...overrides };
    const plan = planReconcile(
      next,
      normalizeDesiredState(next, configFingerprint(next)),
      digestsOf(turn1),
    );
    return {
      kinds: plan.actions.map((a) => a.kind),
      live: isLivelyApplicable(plan),
    };
  };

  it("routes each facet to its authorized action", () => {
    assert.deepEqual(routeFor({ agentsMd: "x" }), {
      kinds: ["refresh-workspace"],
      live: true,
    });
    assert.deepEqual(routeFor({ model: "m2" }), {
      kinds: ["apply-live"],
      live: true,
    });
    // These three still ROUTE to a session reopen, and a reopen is no longer live-applicable, so
    // they rebuild. The routing is the honest part: a reopen is what these facets need. What the
    // runner cannot yet do is build the session init from the incoming request, so reopening
    // would reinstall the old one and report the new one as applied.
    assert.deepEqual(routeFor({ systemPrompt: "sp" }), {
      kinds: ["reopen-session"],
      live: false,
    });
    assert.deepEqual(
      routeFor({ harnessFiles: [{ path: "a", content: "b" }] as never }),
      {
        kinds: ["reopen-session"],
        live: false,
      },
    );
    assert.deepEqual(routeFor({ permissions: { default: "deny" } as never }), {
      kinds: ["reopen-session"],
      live: false,
    });
    assert.deepEqual(routeFor({ sandbox: "daytona" }), {
      kinds: ["rebuild-sandbox"],
      live: false,
    });
  });
});

describe("reopen: the history condition (adapter-matrix 6.2)", () => {
  it("a harness-files change REBUILDS, and never reaches the applier", async () => {
    // A harness file may BE a permission file. A reopen writes no files at all, so routing this
    // through the live gate would leave a tightened permission uninstalled while applied state
    // reported it as landed. Rebuilding is wasteful and always sound; that is the trade until
    // the session init is built from the incoming request.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({ harnessFiles: [{ path: "a", content: "b" }] as never }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 2, "a harness-file change rebuilds");
    assert.equal(
      calls.applied.length,
      0,
      "the applier must not see a plan it cannot install",
    );
  });

  it("a LAST-MESSAGE-ONLY request still rebuilds, because history cannot be verified", async () => {
    // The fail-closed half. When the request carries no transcript, the harness's native memory
    // IS the conversation, and a matching agentSessionId proves only that the adapter accepted
    // the id — never that it replayed the turns. So the reopen refuses and the caller rebuilds.
    const { engine, calls } = makeEngine({ apply: "refuse" });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      {
        ...turn1,
        harnessFiles: [{ path: "a", content: "b" }] as never,
        messages: [{ role: "user", content: "only this" }],
      },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      calls.acquire,
      2,
      "no transcript to replay means no safe reopen",
    );
  });
});
