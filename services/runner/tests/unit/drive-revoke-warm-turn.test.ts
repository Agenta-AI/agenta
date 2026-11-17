/**
 * A warm turn signs every project drive its environment mounted again, and replaces the
 * environment when one no longer signs (archived, deleted, or no longer shared). Without this, a
 * parked environment kept writing an archived drive through the credentials it signed at acquire,
 * for as long as they stayed valid.
 *
 * The check runs in the coordinator, so it is the same on every backend. What differs is the
 * teardown: `drive-revoked` deletes the sandbox on `local` and `daytona` (`teardownDisposition`)
 * and replaces the command sandbox on `inprocess` (`commandSandboxDisposition`).
 *
 * Run: pnpm exec vitest run tests/unit/drive-revoke-warm-turn.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { AgentRunRequest, AgentRunResult, DriveAccess } from "../../src/protocol.ts";
import {
  runWithKeepalive,
  type KeepaliveContext,
  type KeepaliveEngine,
} from "../../src/lifecycle/session-coordinator.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import { appliedStateForRequest } from "../../src/engines/sandbox_agent/applied-state.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";
import type { RunDrive } from "../../src/engines/sandbox_agent/run-drives.ts";
import {
  commandSandboxDisposition,
  teardownDisposition,
} from "../../src/engines/sandbox_agent/teardown.ts";
import { unsignableProjectDrives } from "../../src/engines/sandbox_agent/project-mount.ts";
import { turnLogUnmoved } from "../utils/turn-log.ts";
import { captureStderr } from "../utils/capture-stderr.ts";

const AUTH = { exporters: { otlp: { headers: { authorization: "ApiKey run" } } } };

function creds(tag: string): MountCredentials {
  return {
    region: "us-east-1",
    bucket: "b",
    prefix: `mounts/proj-1/${tag}`,
    accessKey: `AK-${tag}`,
    secretKey: `SK-${tag}`,
    projectId: "proj-1",
  };
}

interface FakeEnv {
  id: number;
  drives: RunDrive[];
  destroyReasons: Array<string | undefined>;
}

/** Slugs that do not sign at acquire; `revoked` holds the ones that stop signing later. */
function makeEngine(opts: { unsignedAtAcquire?: string[] } = {}) {
  const revoked = new Set<string>();
  const signs: Array<{ slug: string; access: DriveAccess; authorization: string }> = [];
  const acquired: FakeEnv[] = [];
  const turns: Array<{ env: FakeEnv; continuation: boolean }> = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const engine: KeepaliveEngine = {
    resolveKeepaliveMount: async () => creds("session"),
    async acquireEnvironment(request) {
      const applied = appliedStateForRequest(request);
      const env = {
        id: acquired.length + 1,
        get appliedState() {
          return applied.appliedState;
        },
        commitApplied: (r: Parameters<typeof applied.commitApplied>[0]) => applied.commitApplied(r),
        lastTurnToolCallIds: [] as string[],
        parkedApprovals: new Map(),
        approvalGateCount: 0,
        nonParkablePauseCount: 0,
        installedMountExpiries: {},
        clearTurn: () => {},
        // The acquire signs as the real one does: a drive that does not sign has no credentials.
        drives: (request.drives ?? []).flatMap((d): RunDrive[] =>
          d.kind === "project"
            ? [{
                kind: "project",
                slug: d.slug,
                access: d.access ?? "read-write",
                credentials:
                  revoked.has(d.slug) || opts.unsignedAtAcquire?.includes(d.slug) ? null : creds(d.slug),
              }]
            : [],
        ),
        destroyReasons: [] as Array<string | undefined>,
        destroy: async (o?: { reason?: string }) => {
          env.destroyReasons.push(o?.reason);
        },
      };
      acquired.push(env);
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(env, _request, _emit, _signal, o): Promise<AgentRunResult> {
      turns.push({ env: env as unknown as FakeEnv, continuation: !!o.continuation });
      return { ok: true, output: "ok", stopReason: "complete" };
    },
    readLatestTurnIndex: turnLogUnmoved,
    async signProjectDrive(slug, access, authorization) {
      signs.push({ slug, access, authorization });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return revoked.has(slug) ? null : creds(slug);
    },
    async runCold(): Promise<AgentRunResult> {
      throw new Error("a session-owned turn never runs unpooled here");
    },
  };
  return { engine, revoked, signs, acquired, turns, maxInFlight: () => maxInFlight };
}

function makeCtx(engine: KeepaliveEngine): KeepaliveContext {
  return {
    engine,
    pool: new SessionPool<SessionEnvironment>({ poolMax: 8 }, () => {}),
    config: { enabled: true, ttlMs: 60_000, approvalTtlMs: 600_000, poolMax: 8 },
  };
}

const DRIVES: AgentRunRequest["drives"] = [
  { kind: "project", slug: "prices", access: "read" },
  { kind: "project", slug: "notes", access: "read-write" },
];

function turn(sandbox: string, n: 1 | 2 | 3, drives = DRIVES): AgentRunRequest {
  const history: AgentRunRequest["messages"] = [];
  for (let i = 1; i < n; i += 1) {
    history.push({ role: "user", content: `m${i}` }, { role: "assistant", content: `a${i}` });
  }
  return {
    harness: "pi_core",
    model: "m1",
    sandbox,
    sessionId: "s1",
    telemetry: AUTH,
    drives,
    messages: [...history, { role: "user", content: `m${n}` }],
  } as AgentRunRequest;
}

describe("unsignableProjectDrives", () => {
  it("signs each drive that holds credentials once, all at once, and names the ones that fail", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const signed: string[] = [];
    const lost = await unsignableProjectDrives(
      [
        { kind: "agent", access: "read-write" },
        { kind: "project", slug: "a", access: "read", credentials: creds("a") },
        { kind: "project", slug: "b", access: "read-write", credentials: creds("b") },
        { kind: "project", slug: "never", access: "read", credentials: null },
        { kind: "project", slug: "boom", access: "read", credentials: creds("boom") },
      ],
      async (slug) => {
        signed.push(slug);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        if (slug === "boom") throw new Error("network");
        return slug === "b" ? null : creds(slug);
      },
    );
    assert.deepEqual(signed.sort(), ["a", "b", "boom"], "an unmounted drive is not signed");
    assert.equal(maxInFlight, 3, "every sign starts before the first answer");
    assert.deepEqual(lost, ["b", "boom"], "a sign that throws counts as failed");
  });

  it("costs nothing without project drives", async () => {
    assert.deepEqual(await unsignableProjectDrives(undefined, async () => { throw new Error("no"); }), []);
  });
});

describe("the revoked drive teardown deletes on every backend", () => {
  it("deletes the sandbox (local, daytona) and replaces the command sandbox (inprocess)", () => {
    assert.equal(teardownDisposition("drive-revoked"), "delete");
    assert.equal(commandSandboxDisposition("drive-revoked"), "delete");
  });
});

for (const sandbox of ["local", "daytona", "inprocess"] as const) {
  describe(`a warm turn on ${sandbox} signs its project drives again`, () => {
    it("stays warm while every drive signs, with one sign per drive per turn, in parallel", async () => {
      const { engine, signs, acquired, turns, maxInFlight } = makeEngine();
      const ctx = makeCtx(engine);

      await runWithKeepalive(turn(sandbox, 1), undefined, undefined, ctx);
      assert.equal(signs.length, 0, "the cold acquire signs; the coordinator does not");
      await runWithKeepalive(turn(sandbox, 2), undefined, undefined, ctx);
      await runWithKeepalive(turn(sandbox, 3), undefined, undefined, ctx);

      assert.equal(acquired.length, 1, "no rebuild");
      assert.deepEqual(turns.map((t) => t.continuation), [false, true, true]);
      assert.deepEqual(
        signs.map((s) => `${s.slug}:${s.access}:${s.authorization}`),
        ["prices:read:ApiKey run", "notes:read-write:ApiKey run", "prices:read:ApiKey run", "notes:read-write:ApiKey run"],
      );
      assert.equal(maxInFlight(), 2);
    });

    it("an archived drive evicts the environment, deletes its sandbox, and the next turn runs without it", async () => {
      const { engine, revoked, acquired, turns } = makeEngine();
      const ctx = makeCtx(engine);
      await runWithKeepalive(turn(sandbox, 1), undefined, undefined, ctx);

      revoked.add("notes");
      const log = captureStderr();
      let r2: AgentRunResult;
      try {
        r2 = await runWithKeepalive(turn(sandbox, 2), undefined, undefined, ctx);
      } finally {
        log.restore();
      }

      assert.equal(r2.ok, true);
      assert.deepEqual(acquired[0]!.destroyReasons, ["drive-revoked"]);
      assert.equal(acquired.length, 2, "a fresh environment");
      assert.equal(turns[1]!.continuation, false);
      assert.equal(turns[1]!.env, acquired[1]);
      const notes = acquired[1]!.drives.find((d) => d.kind === "project" && d.slug === "notes");
      assert.equal(notes && "credentials" in notes ? notes.credentials : "missing", null, "the archived drive is not mounted");
      assert.match(log.lines.join(""), /drive-revoked key=\S+ slugs=\[notes\]/);
      assert.match(log.lines.join(""), /mismatch \(drive-revoked\)/);
    });

    it("a drive that did not sign at acquire is not signed again and does not evict", async () => {
      const { engine, signs, acquired } = makeEngine({ unsignedAtAcquire: ["notes"] });
      const ctx = makeCtx(engine);
      await runWithKeepalive(turn(sandbox, 1), undefined, undefined, ctx);
      await runWithKeepalive(turn(sandbox, 2), undefined, undefined, ctx);

      assert.equal(acquired.length, 1);
      assert.deepEqual(signs.map((s) => s.slug), ["prices"]);
    });
  });
}
