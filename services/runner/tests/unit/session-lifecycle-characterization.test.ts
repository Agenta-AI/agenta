/**
 * LIFECYCLE MIGRATION, STEPS 1 AND 2 — the behavior record.
 *
 * This file began as CHARACTERIZATION tests. It pinned three defects so the refactor could see
 * itself, and it was written so that fixing a defect BREAKS the test. That is what happened. This
 * revision is the deliberate edit, and it is the record of what changed and why.
 *
 * Design: docs/design/agent-config-editing/research/runner-lifecycle-codex.md, "5. Migration
 * path", steps 1 and 2.
 *
 * | Block | Was pinned as | Is now |
 * |---|---|---|
 * | (a) revision metadata | A revision-id change evicted the warm session | Revision id, version, and draft flag are out of the fingerprint. The session survives. |
 * | (b) teardown reasons | Every incompatibility mapped to delete | Four named reasons. Only the two whose daemon is sound may park. |
 * | (c) approval stale config | The re-park stamped the INCOMING fingerprint | The pool has no fingerprint parameter. Applied state is owned by the environment. |
 *
 * Each block keeps a WAS note beside its assertions. A future reader must be able to see the old
 * behavior without reading git history, because the old behavior is why the code looks like this.
 *
 * Run: pnpm exec vitest run tests/unit/session-lifecycle-characterization.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

// What `commitApplied` accepts: a lifecycle action's RESULT, both halves together.
type AppliedCommit = Parameters<AppliedState["commitApplied"]>[0];

import type { AgentRunRequest, AgentRunResult } from "../../src/protocol.ts";
import {
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/server.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import {
  configFingerprint,
  type KeepaliveConfig,
} from "../../src/engines/sandbox_agent/session-identity.ts";
import {
  appliedStateForRequest,
  AppliedState,
  type AppliedEnvironmentState,
} from "../../src/engines/sandbox_agent/applied-state.ts";
import {
  FACETS,
  type FacetDigests,
} from "../../src/lifecycle/desired-state.ts";
import {
  teardownDisposition,
  type TeardownReason,
} from "../../src/engines/sandbox_agent/teardown.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type {
  ParkedApproval,
  SessionEnvironment,
} from "../../src/engines/sandbox_agent.ts";

const auth = {
  telemetry: {
    exporters: { otlp: { headers: { authorization: "ApiKey run" } } },
  },
};

const POOL_KEY = "proj-1:s1";

// --------------------------------------------------------------------------- //
// A fake engine, modelled on tests/unit/session-keepalive-approval.test.ts.     //
// It records which teardown REASON each destroy carried, which the existing     //
// helpers do not, because (b) is about the reason -> disposition mapping.       //
// --------------------------------------------------------------------------- //

interface FakeEnv {
  id: number;
  /** The environment owns what it applied. The pool reads through to it. */
  readonly appliedState: AppliedEnvironmentState;
  commitApplied: (result: AppliedCommit) => void;
  destroyed: number;
  destroyReasons: TeardownReason[];
  turnsCleared: number;
  lastTurnToolCallIds: string[];
  parkedApprovals: Map<string, ParkedApproval>;
  parkedApproval?: ParkedApproval;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  installedMountExpiries: Record<string, number>;
  clearTurn: () => void;
  destroy: (opts?: { reason?: TeardownReason }) => Promise<void>;
}

interface TurnScript {
  approvalPause?: { permissionId: string; toolCallId: string; toolName?: string };
  result?: AgentRunResult;
  toolCallIds?: string[];
}

function makeEngine(scripts: TurnScript[] = []) {
  const calls = {
    acquire: 0,
    turns: [] as Array<{ env: FakeEnv; opts: any }>,
    resumes: [] as Array<{ toolCallId: string; reply: string }>,
    acquiredEnvs: [] as FakeEnv[],
  };
  let nextEnvId = 1;

  // Seeded from the acquiring request, exactly as `prepareEnvironmentSetup` does.
  const makeEnv = (request: AgentRunRequest): FakeEnv => {
    const applied = appliedStateForRequest(request);
    const env: FakeEnv = {
      id: nextEnvId++,
      get appliedState() {
        return applied.appliedState;
      },
      commitApplied: (result) => applied.commitApplied(result),
      destroyed: 0,
      destroyReasons: [],
      turnsCleared: 0,
      lastTurnToolCallIds: [],
      parkedApprovals: new Map(),
      parkedApproval: undefined,
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
    return env;
  };

  const signedMount = (): MountCredentials => ({
    region: "us-east-1",
    bucket: "b",
    prefix: "mounts/proj/mount",
    accessKey: "AK",
    secretKey: "SK",
    projectId: "proj-1",
  });

  const engine: KeepaliveEngine = {
    async resolveKeepaliveMount() {
      return signedMount();
    },
    async acquireEnvironment(request) {
      calls.acquire += 1;
      const env = makeEnv(request);
      calls.acquiredEnvs.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(rawEnv, _request, _emit, _signal, opts) {
      const env = rawEnv as unknown as FakeEnv;
      const idx = calls.turns.length;
      const script = scripts[idx] ?? {};
      env.parkedApprovals = new Map();
      env.parkedApproval = undefined;
      env.approvalGateCount = 0;
      env.nonParkablePauseCount = 0;
      for (const gate of (opts as any)?.resume?.carriedForward ?? []) {
        env.parkedApprovals.set(gate.toolCallId, gate);
        env.parkedApproval ??= gate;
      }
      env.approvalGateCount = env.parkedApprovals.size;
      env.lastTurnToolCallIds = script.toolCallIds ?? [];
      calls.turns.push({ env, opts });
      for (const decision of (opts as any)?.resume?.decisions ?? []) {
        calls.resumes.push({
          toolCallId: decision.toolCallId,
          reply: decision.reply,
        });
      }
      if (script.approvalPause) {
        const promptPromise = new Promise(() => {});
        promptPromise.catch(() => {});
        const record: ParkedApproval = {
          gateType: "claude-acp-permission",
          permissionId: script.approvalPause.permissionId,
          toolCallId: script.approvalPause.toolCallId,
          toolName: script.approvalPause.toolName,
          args: {},
          interactionToken: script.approvalPause.toolCallId,
          promptPromise,
        };
        env.parkedApprovals.set(record.toolCallId, record);
        env.parkedApproval = record;
        env.approvalGateCount = 1;
        return { ok: true, stopReason: "paused" };
      }
      return script.result ?? { ok: true, output: "ok", stopReason: "complete" };
    },
    async runCold() {
      return { ok: true, output: "cold", stopReason: "complete" };
    },
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
  const pool = new SessionPool<SessionEnvironment>(
    { poolMax: config.poolMax },
    () => {},
  );
  return { engine, pool, config };
}

/** A request carrying a workflow revision id + draft flag in its run context. */
function requestWithRevision(
  revisionId: string,
  overrides: {
    version?: string;
    isDraft?: boolean;
    messages?: AgentRunRequest["messages"];
  } = {},
): AgentRunRequest {
  return {
    harness: "claude",
    model: "m1",
    sessionId: "s1",
    ...auth,
    messages: overrides.messages ?? [{ role: "user", content: "hello" }],
    runContext: {
      project: { id: "proj-1" },
      workflow: {
        revision: { id: revisionId, version: overrides.version ?? "1" },
        is_draft: overrides.isDraft ?? false,
      },
    },
  };
}

// =========================================================================== //
// (a) Revision metadata is OUT of environment identity.                        //
// =========================================================================== //

describe("(a) revision metadata is turn metadata, not environment identity", () => {
  // WAS: `configFingerprint` folded in `workflowRevision.id`, `workflowRevision.version`, and
  // `isDraft`. So committing a revision mid-conversation changed the fingerprint, the dispatch
  // read a mismatch, and it destroyed a warm sandbox that was still perfectly usable. These four
  // tests asserted `notEqual` and now assert `equal`.

  it("a revision-ID-only change does NOT change the configFingerprint", () => {
    assert.equal(
      configFingerprint(requestWithRevision("rev-1")),
      configFingerprint(requestWithRevision("rev-2")),
      "nothing in the sandbox, the daemon, the workspace, or the harness session depends on " +
        "a revision id, so it must not decide whether the environment can be reused",
    );
  });

  it("a revision-VERSION-only change does NOT change the configFingerprint", () => {
    assert.equal(
      configFingerprint(requestWithRevision("rev-1", { version: "1" })),
      configFingerprint(requestWithRevision("rev-1", { version: "2" })),
    );
  });

  it("a draft-flag-only change does NOT change the configFingerprint", () => {
    assert.equal(
      configFingerprint(requestWithRevision("rev-1", { isDraft: false })),
      configFingerprint(requestWithRevision("rev-1", { isDraft: true })),
    );
  });

  it("a real config change still DOES change the configFingerprint", () => {
    // The guard against over-removal. Dropping the revision fields must not make the fingerprint
    // blind to a change that genuinely does invalidate the environment.
    const base = requestWithRevision("rev-1");
    assert.notEqual(
      configFingerprint(base),
      configFingerprint({ ...base, model: "m2" }),
    );
  });

  it("END TO END: committing a revision keeps the warm session", () => {
    // WAS: `acquire` went 1 -> 2 and the warm environment was destroyed with
    // `compatibility-mismatch`. This is the product cost the whole project exists to remove.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);

    return (async () => {
      await runWithKeepalive(
        requestWithRevision("rev-1"),
        undefined,
        undefined,
        ctx,
      );
      assert.equal(calls.acquire, 1);
      const env1 = calls.acquiredEnvs[0];

      // The agent committed a revision mid-conversation, so the service sends the NEW revision id.
      // Model, harness, skills, tools, and instructions are all identical.
      await runWithKeepalive(
        requestWithRevision("rev-2", {
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
            { role: "user", content: "more" },
          ],
        }),
        undefined,
        undefined,
        ctx,
      );

      assert.equal(
        calls.acquire,
        1,
        "the committed revision reuses the warm sandbox instead of rebuilding it",
      );
      assert.equal(env1.destroyed, 0, "the warm environment survives");
      assert.equal(calls.turns.length, 2);
      assert.equal(
        calls.turns[1].env.id,
        env1.id,
        "the second turn ran on the SAME environment",
      );
    })();
  });
});

// =========================================================================== //
// (b) Teardown names the failing LAYER, and only a sound daemon may park.      //
// =========================================================================== //

describe("(b) teardown reasons name the failing layer", () => {
  // WAS: one `compatibility-mismatch` reason for every incompatibility, always mapping to
  // `delete`. It could not say WHAT was incompatible, so a wrong transcript cost the same
  // rebuild as a rotated credential.

  it("the two incompatibilities whose daemon is sound PARK", () => {
    // A wrong harness session and a wrong conversation both leave the sandbox, the daemon, and
    // the installed credentials untouched. There is nothing stale to carry forward.
    assert.equal(teardownDisposition("session-incompatible"), "stop");
    assert.equal(teardownDisposition("continuity-invalid"), "stop");
  });

  it("the two incompatibilities that could leave stale material DELETE", () => {
    // This is the case the lifecycle design warns about by name: credentials and Pi runtime
    // assets are installed into the daemon, so a parked sandbox would resume with the stale
    // material still in place.
    assert.equal(teardownDisposition("runtime-incompatible"), "delete");
    assert.equal(teardownDisposition("sandbox-incompatible"), "delete");
  });

  it("the deprecated alias still deletes, so an unclassified call site fails safe", () => {
    assert.equal(
      teardownDisposition("compatibility-mismatch"),
      "delete",
      "delete is always sound; it only ever costs a rebuild",
    );
  });

  it("the ordinary park reasons are unchanged", () => {
    for (const reason of [
      "clean-resumable",
      "idle-expiry",
      "capacity-eviction",
      "shutdown-idle",
    ] as const) {
      assert.equal(teardownDisposition(reason), "stop", `${reason} parks the sandbox`);
    }
  });

  it("the ordinary delete reasons are unchanged", () => {
    for (const reason of ["kill", "failed-turn", "aborted", "shutdown-in-flight"] as const) {
      assert.equal(teardownDisposition(reason), "delete", `${reason} deletes the sandbox`);
    }
  });

  it("a tool-timeout PARKS the sandbox because only the tool overran its clock", () => {
    // The daemon, credentials, and filesystem are all intact after a per-tool-call deadline. The
    // next turn should inherit the disk state (installed deps, /tmp contents, etc.) rather than
    // rebuilding from a bare sandbox. See teardown.ts "tool-timeout".
    assert.equal(teardownDisposition("tool-timeout"), "stop");
  });

  it("the parkable set is an ALLOWLIST, so a new reason deletes by default", () => {
    // The invariant that keeps this safe as the union grows. A denylist would make a newly added
    // reason park by accident, which is how stale credentials survive into a resumed daemon.
    const parkable: TeardownReason[] = [
      "clean-resumable",
      "idle-expiry",
      "capacity-eviction",
      "shutdown-idle",
      "session-incompatible",
      "continuity-invalid",
      "tool-timeout",
    ];
    const everyReason: TeardownReason[] = [
      "kill",
      "failed-turn",
      "aborted",
      "compatibility-mismatch",
      "session-incompatible",
      "runtime-incompatible",
      "sandbox-incompatible",
      "continuity-invalid",
      "tool-timeout",
      "clean-resumable",
      "idle-expiry",
      "capacity-eviction",
      "shutdown-in-flight",
      "shutdown-idle",
    ];
    assert.equal(everyReason.length, 14, "the TeardownReason union has 14 members");
    for (const reason of everyReason) {
      assert.equal(
        teardownDisposition(reason),
        parkable.includes(reason) ? "stop" : "delete",
        `${reason} must follow the allowlist`,
      );
    }
  });

  it("the park default is on, so this is a real disposition and not a disabled flag", () => {
    assert.equal(
      teardownDisposition("session-incompatible", false),
      "delete",
      "with parking off everything deletes; the default (true) is what this block records",
    );
  });

  it("END TO END: an edited transcript now PARKS the sandbox instead of deleting it", async () => {
    // WAS: `mismatch:history` tore down with `compatibility-mismatch`, which deleted. But an
    // edited transcript says nothing about the environment. The sandbox, the daemon, and the
    // credentials are all sound, so the only correct answer is to park it.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(requestWithRevision("rev-1"), undefined, undefined, ctx);
    const env1 = calls.acquiredEnvs[0];

    // Turn 2 rewrites the first user message, so the history fingerprint cannot match.
    await runWithKeepalive(
      requestWithRevision("rev-1", {
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

    assert.equal(calls.acquire, 2, "the conversation is wrong, so the turn still runs cold");
    assert.deepEqual(
      env1.destroyReasons,
      ["continuity-invalid"],
      "the reason names the CONVERSATION, not the environment",
    );
    assert.equal(
      teardownDisposition(env1.destroyReasons[0]),
      "stop",
      "so the sandbox parks and the next turn can reconnect to it",
    );
  });

  it("END TO END: a rotated credential still DELETES the sandbox", async () => {
    // The other half of the split, and the one the lifecycle design warns about by name. A
    // rotated model credential is baked into the daemon, so a parked sandbox would resume with
    // the stale material still installed.
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    const withCredential = (secret: string, messages: AgentRunRequest["messages"]) => ({
      ...requestWithRevision("rev-1", { messages }),
      modelConnection: {
        provider: "openai",
        deployment: "direct",
        endpoint: { baseUrl: "https://api.openai.com/v1" },
        credentialMode: "env",
        credentials: [
          {
            binding: { kind: "environment", name: "OPENAI_API_KEY" },
            value: secret,
            usage: "opaque_http",
          },
        ],
      } satisfies NonNullable<AgentRunRequest["modelConnection"]>,
    });

    await runWithKeepalive(
      withCredential("sk-a", [{ role: "user", content: "hello" }]),
      undefined,
      undefined,
      ctx,
    );
    const env1 = calls.acquiredEnvs[0];

    await runWithKeepalive(
      withCredential("sk-b", [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "more" },
      ]),
      undefined,
      undefined,
      ctx,
    );

    assert.equal(calls.acquire, 2);
    assert.deepEqual(env1.destroyReasons, ["runtime-incompatible"]);
    assert.equal(
      teardownDisposition(env1.destroyReasons[0]),
      "delete",
      "a stale credential must never survive inside a parked daemon",
    );
  });
});

// =========================================================================== //
// (c) The approval-resume path can no longer stamp a configuration.            //
// =========================================================================== //

describe("(c) applied state is owned by the environment, never stamped by a request", () => {
  /** Turn 1 pauses on a gate; the resume answers it. */
  function pauseRequest(revisionId: string): AgentRunRequest {
    return requestWithRevision(revisionId, {
      messages: [{ role: "user", content: "do X" }],
    });
  }

  function approveResume(
    revisionId: string,
    overrides: Partial<AgentRunRequest> = {},
  ): AgentRunRequest {
    return {
      ...requestWithRevision(revisionId, {
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
                toolCallId: "tc-gate",
                output: { approved: true },
              },
            ],
          },
        ],
      }),
      ...overrides,
    };
  }

  async function parkThenResume(resume: AgentRunRequest, parkRevision = "rev-1") {
    const { engine, calls } = makeEngine([
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
    const parked = pauseRequest(parkRevision);
    const r1 = await runWithKeepalive(parked, undefined, undefined, ctx);
    assert.equal(r1.stopReason, "paused");
    assert.equal(ctx.pool.get(POOL_KEY)!.state, "awaiting_approval");
    const parkedFp = ctx.pool.get(POOL_KEY)!.configFingerprint;
    const r2 = await runWithKeepalive(resume, undefined, undefined, ctx);
    return { calls, ctx, r2, parked, parkedFp };
  }

  it("the approval branch still does not compare the incoming config fingerprint", () => {
    // UNCHANGED, and deliberately so. The commit the agent asked approval FOR is what changes the
    // revision id, so an approval reply routinely arrives with a different config than the park.
    // Evicting there would throw away the very session that can answer the gate. What changes in
    // step 2 is not whether the branch compares, but what it RECORDS afterwards.
    return (async () => {
      const resume = approveResume("rev-2");
      const { calls, r2 } = await parkThenResume(resume, "rev-1");
      assert.equal(r2.ok, true);
      assert.equal(
        calls.acquire,
        1,
        "the resume runs on the parked environment",
      );
      assert.equal(calls.resumes.length, 1, "the parked gate is answered live");
    })();
  });

  it("THE FIX: the re-park reports the APPLIED configuration, not the incoming one", async () => {
    // WAS: `reparkOrEvict` passed `configFingerprint: cfgFp` from the INCOMING request, so the
    // pool recorded a configuration the environment had never applied.
    // NOW: `ParkInput` and the repark update have no `configFingerprint` field at all. The pool
    // reads `environment.appliedState`, so the stamp cannot be written.
    const resume = approveResume("rev-2", { model: "m2" });
    const { ctx, parked, parkedFp } = await parkThenResume(resume, "rev-1");

    const reparked = ctx.pool.get(POOL_KEY)!;
    assert.equal(reparked.state, "idle", "the resumed turn completed and re-parked");

    assert.equal(
      reparked.configFingerprint,
      parkedFp,
      "the environment still reports what it was built with",
    );
    assert.equal(
      reparked.configFingerprint,
      configFingerprint(parked),
      "and that is the configuration of the request that actually built it",
    );
    assert.notEqual(
      reparked.configFingerprint,
      configFingerprint(resume),
      "the incoming request's configuration was never applied, so it is never recorded",
    );
  });

  it("THE REGRESSION: park m1, resume m2, no setModel success, applied stays m1", async () => {
    // The exact regression the migration's step 2 asks for. It is the inverse of the bug this
    // file used to pin, and it is the reason `commitApplied` takes a RESULT rather than a
    // desired value.
    const resume = approveResume("rev-1", { model: "m2" });
    const { calls, ctx, parked } = await parkThenResume(resume, "rev-1");
    assert.equal(calls.acquire, 1, "the model change does not evict on the approval branch");

    const env = calls.acquiredEnvs[0];
    assert.equal(
      env.appliedState.configFingerprint,
      configFingerprint(parked),
      "no successful setModel(m2) happened, so the environment is still applied as m1",
    );
    assert.equal(
      ctx.pool.get(POOL_KEY)!.configFingerprint,
      configFingerprint(parked),
      "and the pool reports m1, because it reads the environment",
    );
  });

  it("THE PAYOFF: the next checkout sees the m1 -> m2 delta and rebuilds", async () => {
    // WAS: the third turn matched the stamped m2 fingerprint and continued warm on an
    // environment running m1. Now the stamp is m1, the incoming request is m2, and the mismatch
    // is real, so the dispatch rebuilds. The delta is finally VISIBLE.
    const resume = approveResume("rev-1", { model: "m2" });
    const { calls, ctx } = await parkThenResume(resume, "rev-1");
    assert.equal(calls.acquire, 1);
    const env1 = calls.acquiredEnvs[0];

    const third: AgentRunRequest = {
      ...requestWithRevision("rev-1", {
        messages: [
          { role: "user", content: "do X" },
          {
            role: "assistant",
            content: [{ type: "tool_call", toolCallId: "tc-gate", toolName: "commit" }],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", toolCallId: "tc-gate", output: { approved: true } },
            ],
          },
          { role: "assistant", content: "resumed" },
          { role: "user", content: "next" },
        ],
      }),
      model: "m2",
    };
    await runWithKeepalive(third, undefined, undefined, ctx);

    assert.equal(
      calls.acquire,
      2,
      "the m1 -> m2 delta is seen and the environment is rebuilt on m2",
    );
    assert.equal(
      env1.destroyed,
      1,
      "the m1 environment is torn down rather than silently reused as m2",
    );
    assert.deepEqual(
      env1.destroyReasons,
      ["runtime-incompatible"],
      "a model change may have changed baked credentials, so it deletes rather than parks",
    );
  });

  it("applied state advances ONLY through commitApplied, and only on a real result", () => {
    // The unit-level guard behind the three tests above. `AppliedState` has no setter, and the
    // generation moves only when a caller reports a lifecycle action that already succeeded.
    const facets = (tag: string) =>
      Object.fromEntries(FACETS.map((f) => [f, `${tag}-${f}`])) as FacetDigests;

    const applied = new AppliedState("fp-m1", facets("m1"));
    assert.equal(applied.appliedState.configFingerprint, "fp-m1");
    assert.equal(applied.appliedState.generation, 1);
    assert.equal(applied.appliedState.facets.runtime, "m1-runtime");

    // A snapshot is a copy: mutating it cannot reach the real state. Both halves are copied.
    const snapshot = applied.appliedState as {
      configFingerprint: string;
      facets: Record<string, string>;
    };
    snapshot.configFingerprint = "fp-forged";
    snapshot.facets.runtime = "forged-runtime";
    assert.equal(applied.appliedState.configFingerprint, "fp-m1");
    assert.equal(applied.appliedState.facets.runtime, "m1-runtime");

    applied.commitApplied({ configFingerprint: "fp-m2", facets: facets("m2") });
    assert.equal(applied.appliedState.configFingerprint, "fp-m2");
    assert.equal(applied.appliedState.facets.runtime, "m2-runtime");
    assert.equal(applied.appliedState.generation, 2);

    // Re-applying the same configuration still advances the generation, so "nothing changed" and
    // "we re-applied" stay distinguishable.
    applied.commitApplied({ configFingerprint: "fp-m2", facets: facets("m2") });
    assert.equal(applied.appliedState.generation, 3);
  });

  it("for contrast: the IDLE branch does compare the fingerprint and evicts", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await runWithKeepalive(requestWithRevision("rev-1"), undefined, undefined, ctx);
    await runWithKeepalive(
      {
        ...requestWithRevision("rev-1", {
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
            { role: "user", content: "more" },
          ],
        }),
        model: "m2",
      },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(
      calls.acquire,
      2,
      "the idle branch evicts on a model change; only the approval branch skips the check",
    );
  });
});
