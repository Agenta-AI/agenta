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

import type {
  AgentRunRequest,
  AgentRunResult,
} from "../../src/protocol.ts";
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
  type CredentialDeliveryCapabilities,
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
  };
}

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
    // DELIBERATE EDIT. `reopen-session` joined the live set: it keeps the sandbox, the daemon,
    // the mounts and the workspace, recreating only the ACP session, which is what makes the
    // uniform tool/MCP/prompt/harness-file routes cheaper than a rebuild. It carries its own
    // refusal (see `reopen`), so being live-APPLICABLE is not the same as always succeeding.
    //
    // The guard still matters: this list is the single place that says how many routes are live,
    // and a fifth entry must be a decision, never an accident.
    assert.deepEqual(
      [...LIVE_ACTION_KINDS].sort(),
      ["apply-live", "no-op", "refresh-workspace", "reopen-session"],
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
            { facet: "harnessFiles", kind: "reopen-session", reason: "r" },
          ],
          ["workspaceFiles", "model", "harnessFiles"],
        ),
      ),
      true,
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

    assert.equal(calls.acquire, 1, "the warm sandbox survives an instructions change");
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
    assert.deepEqual(calls.applied[0].actions, ["refresh-workspace", "apply-live"]);
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

    await runWithKeepalive(turn2({ agentsMd: "REWRITTEN" }), undefined, undefined, ctx);

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
    assert.equal(result.ok, true, "a live-route failure must never fail the turn");
    assert.equal(calls.acquire, 2);
  });

  it("an engine with NO applier keeps the old rebuild behavior exactly", async () => {
    const { engine, calls } = makeEngine({ noApplier: true });
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(turn2({ agentsMd: "REWRITTEN" }), undefined, undefined, ctx);
    assert.equal(calls.acquire, 2, "the optional seam degrades to today's behavior");
  });

  it("a CREDENTIAL change never reaches the live route", async () => {
    // Credential facets keep delegating to the epoch comparison until step 8. The route must not
    // see them at all, because the router still cannot read the epoch.
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
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(withSecret("sk-a", turn1), undefined, undefined, ctx);
    await runWithKeepalive(withSecret("sk-b", turn2()), undefined, undefined, ctx);
    assert.equal(calls.acquire, 2, "a rotated credential still rebuilds");
    assert.equal(calls.applied.length, 0, "and never reaches the applier");
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
    await runWithKeepalive(turn2({ agentsMd: "REWRITTEN" }), undefined, undefined, ctx);

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
    assert.ok(counters.skippedByScope > 0, "the continuity decision was excluded");
    assert.equal(
      Object.values(counters.disagree).reduce((a, b) => a + b, 0),
      0,
      "and it did NOT land in the disagreement tally",
    );
  });

  it("CLOSED IN STEP 8: a rotated credential is an AGREEMENT, and nothing disagrees", async () => {
    // THIS TEST IS THE RECORD OF THE GAP, REWRITTEN RATHER THAN DELETED. It used to assert that a
    // rotated credential MUST still show up as a disagreement, because credential values are kept
    // out of every facet digest (digests are logged) and the router therefore could not see a
    // rotation at all.
    //
    // Step 8 closes it without putting a secret in a digest: the epoch's CONCLUSION reaches the
    // plan as its own input, and the router turns it into an action on the `runtime` facet. On this
    // provider the action is a rebuild — see the routing test below for why that is the honest
    // answer and not a conservative one — which is what the coordinator already does, so the two
    // now agree.
    //
    // The total-disagreement assertion is the completion signal for the shadow-routing arc: every
    // route the router can plan matches the decision the coordinator makes.
    //
    // NOTE ON WHICH PROVIDER THIS EXERCISES. This dispatch runs on the LOCAL provider, whose values
    // are baked into a frozen daemon environment, so its honest route is a rebuild and the
    // agreement below is on `rebuild-sandbox`. The Daytona rotation now routes to `apply-live`
    // under the Q5 ruling, and its agreement arrives with the live credential route — the
    // coordinator must run the delivery instead of evicting before that agreement can be asserted
    // here. Until then this test pins the local arm, which is the one that is fully wired.
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
    const { engine } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(withSecret("sk-a", turn1), undefined, undefined, ctx);
    await runWithKeepalive(withSecret("sk-b", turn2()), undefined, undefined, ctx);

    const counters = reconcileCounters();
    assert.equal(
      Object.values(counters.disagree).reduce((a, b) => a + b, 0),
      0,
      "a rotated credential must no longer disagree",
    );
    assert.ok(
      (counters.agree["rebuild-sandbox"] ?? 0) > 0,
      "the rotation must be COUNTED, as an agreement on the rebuild route",
    );
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
    return { kinds: plan.actions.map((a) => a.kind), live: isLivelyApplicable(plan) };
  };

  it("routes each facet to its authorized action", () => {
    assert.deepEqual(routeFor({ agentsMd: "x" }), {
      kinds: ["refresh-workspace"],
      live: true,
    });
    assert.deepEqual(routeFor({ model: "m2" }), { kinds: ["apply-live"], live: true });
    // These three route to a session REOPEN, which is now live-applicable — the sandbox survives
    // and only the ACP session is recreated. The reopen still refuses at execution time when the
    // conversation could not be replayed, which is a different question from routing.
    assert.deepEqual(routeFor({ systemPrompt: "sp" }), {
      kinds: ["reopen-session"],
      live: true,
    });
    assert.deepEqual(routeFor({ harnessFiles: [{ path: "a", content: "b" }] as never }), {
      kinds: ["reopen-session"],
      live: true,
    });
    assert.deepEqual(routeFor({ permissions: { default: "deny" } as never }), {
      kinds: ["reopen-session"],
      live: true,
    });
    assert.deepEqual(routeFor({ sandbox: "daytona" }), {
      kinds: ["rebuild-sandbox"],
      live: false,
    });
  });
});

describe("reopen: the history condition (adapter-matrix 6.2)", () => {
  it("a harness-files change now REUSES the sandbox instead of rebuilding", async () => {
    // The payoff of making reopen live: the uniform tool/MCP/prompt/harness-file routes stop
    // costing a full sandbox rebuild.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(turn1, undefined, undefined, ctx);
    await runWithKeepalive(
      turn2({ harnessFiles: [{ path: "a", content: "b" }] as never }),
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 1, "the sandbox survives a harness-file change");
    assert.deepEqual(calls.applied[0].actions, ["reopen-session"]);
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
    assert.equal(calls.acquire, 2, "no transcript to replay means no safe reopen");
  });
});
