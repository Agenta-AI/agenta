/**
 * Coordinator seam parity (lifecycle migration, step 3).
 *
 * The extraction is only safe if the coordinator and `server.ts` are the SAME thing. The three
 * existing keep-alive suites already prove the behavior; they import from `server.ts` and they
 * pass unedited, which is the real parity evidence.
 *
 * This file proves the seam itself: that the re-export is an alias and not a copy, that the
 * coordinator works when imported directly, and that the module boundary is where the design says
 * it is. A future reader who wonders whether they may import the coordinator directly gets the
 * answer here.
 *
 * Run: pnpm exec vitest run tests/unit/lifecycle-session-coordinator.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  AgentRunRequest,
  AgentRunResult,
} from "../../src/protocol.ts";
import * as coordinator from "../../src/lifecycle/session-coordinator.ts";
import * as server from "../../src/server.ts";
import { SessionPool } from "../../src/engines/sandbox_agent/session-pool.ts";
import {
  appliedStateForRequest,
  type AppliedEnvironmentState,
} from "../../src/engines/sandbox_agent/applied-state.ts";
import type { KeepaliveConfig } from "../../src/engines/sandbox_agent/session-identity.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent.ts";
import type { MountCredentials } from "../../src/engines/sandbox_agent/mount.ts";

type AppliedCommit = Parameters<
  ReturnType<typeof appliedStateForRequest>["commitApplied"]
>[0];

const SRC = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf-8");

describe("the re-export is an alias, not a copy", () => {
  it("server.ts and the coordinator expose the SAME function objects", () => {
    // Identity, not equality. Two copies would drift the moment one is edited.
    assert.strictEqual(server.runWithKeepalive, coordinator.runWithKeepalive);
    assert.strictEqual(
      server.resolveKeepaliveProvider,
      coordinator.resolveKeepaliveProvider,
    );
    assert.strictEqual(
      server.resolveKeepaliveDispatch,
      coordinator.resolveKeepaliveDispatch,
    );
  });
});

describe("the module boundary is where the design says it is", () => {
  it("server.ts no longer holds the decision logic", () => {
    const text = SRC("server.ts");
    for (const marker of [
      "export async function runWithKeepalive",
      "hit-continue",
      "approval-mismatch",
      "const coldAndPark",
      "reparkOrEvict",
    ]) {
      assert.ok(
        !text.includes(marker),
        `server.ts still contains '${marker}'; the extraction is incomplete`,
      );
    }
  });

  it("the coordinator holds every decision path", () => {
    const text = SRC("lifecycle/session-coordinator.ts");
    for (const marker of [
      "hit-continue", // the warm gate
      "approval-mismatch", // the approval-resume path
      "miss key=", // the miss path
      "reparkOrEvict", // the re-parking policy
      "mismatchTeardownReason", // the eviction choice
    ]) {
      assert.ok(text.includes(marker), `the coordinator is missing '${marker}'`);
    }
  });

  it("the coordinator does NOT import the real engine implementation", () => {
    // The engine seam only means something if the coordinator cannot reach past it. The live
    // binding (`realKeepaliveEngine`) stays in server.ts, which is the composition root.
    //
    // Check only the lines INSIDE an import statement. Two other places name these symbols
    // legitimately: the module doc comment says `realKeepaliveEngine` does not live here, and
    // the `KeepaliveEngine` interface declares `acquireEnvironment` and `runTurn` as its seam
    // members. Neither is an import.
    const lines = SRC("lifecycle/session-coordinator.ts").split("\n");
    const imported: string[] = [];
    let inside = false;
    for (const line of lines) {
      if (line.startsWith("import ")) inside = true;
      if (inside) imported.push(line);
      if (inside && line.includes('from "')) inside = false;
    }
    const imports = imported.join("\n");
    for (const forbidden of [
      "acquireEnvironment",
      "runSandboxAgent",
      "runTurn,",
      "resolveKeepaliveMount",
      "realKeepaliveEngine",
    ]) {
      assert.ok(
        !imports.includes(forbidden),
        `the coordinator imports '${forbidden}'; it must reach the engine only through the seam`,
      );
    }
  });

  it("server.ts still owns the transport", () => {
    const text = SRC("server.ts");
    for (const marker of [
      "createAgentServer",
      "createRequestListener",
      "isAuthorized",
      "realKeepaliveEngine",
    ]) {
      assert.ok(text.includes(marker), `server.ts should still own '${marker}'`);
    }
  });
});

// --------------------------------------------------------------------------- //
// A minimal fake engine, so the coordinator can be driven through its own seam. //
// --------------------------------------------------------------------------- //

interface FakeEnv {
  id: number;
  readonly appliedState: AppliedEnvironmentState;
  commitApplied: (result: AppliedCommit) => void;
  destroyed: number;
  turnsCleared: number;
  lastTurnToolCallIds: string[];
  parkedApprovals: Map<string, unknown>;
  approvalGateCount: number;
  nonParkablePauseCount: number;
  installedMountExpiries: Record<string, number>;
  clearTurn: () => void;
  destroy: () => Promise<void>;
}

function makeEngine() {
  const calls = { acquire: 0, cold: 0, turns: [] as FakeEnv[] };
  let nextId = 1;

  const engine: coordinator.KeepaliveEngine = {
    async resolveKeepaliveMount(): Promise<MountCredentials | null> {
      return {
        region: "us-east-1",
        bucket: "b",
        prefix: "mounts/proj/mount",
        accessKey: "AK",
        secretKey: "SK",
        projectId: "proj-1",
      };
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
        turnsCleared: 0,
        lastTurnToolCallIds: [],
        parkedApprovals: new Map(),
        approvalGateCount: 0,
        nonParkablePauseCount: 0,
        installedMountExpiries: {},
        clearTurn: () => {
          env.turnsCleared += 1;
        },
        destroy: async () => {
          env.destroyed += 1;
        },
      };
      return { ok: true, env: env as unknown as SessionEnvironment };
    },
    async runTurn(env): Promise<AgentRunResult> {
      calls.turns.push(env as unknown as FakeEnv);
      return { ok: true, output: "ok", stopReason: "complete" };
    },
    async runCold(): Promise<AgentRunResult> {
      calls.cold += 1;
      return { ok: true, output: "cold", stopReason: "complete" };
    },
  };
  return { engine, calls };
}

function makeCtx(engine: coordinator.KeepaliveEngine): coordinator.KeepaliveContext {
  const config: KeepaliveConfig = {
    enabled: true,
    ttlMs: 60_000,
    approvalTtlMs: 600_000,
    poolMax: 8,
  };
  return {
    engine,
    pool: new SessionPool<SessionEnvironment>({ poolMax: config.poolMax }, () => {}),
    config,
  };
}

const turn1: AgentRunRequest = {
  harness: "claude",
  model: "m1",
  sessionId: "s1",
  runContext: { project: { id: "proj-1" } },
  messages: [{ role: "user", content: "hello" }],
};

const turn2: AgentRunRequest = {
  ...turn1,
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "user", content: "more" },
  ],
};

describe("the coordinator works when imported directly", () => {
  it("parks after a cold miss and continues the SAME environment", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);

    await coordinator.runWithKeepalive(turn1, undefined, undefined, ctx);
    assert.equal(calls.acquire, 1);
    assert.equal(ctx.pool.get("proj-1:s1")?.state, "idle");

    await coordinator.runWithKeepalive(turn2, undefined, undefined, ctx);
    assert.equal(calls.acquire, 1, "the second turn reuses the warm environment");
    assert.equal(calls.turns.length, 2);
    assert.equal(calls.turns[0].id, calls.turns[1].id);
  });

  it("a config change evicts and rebuilds, exactly as through server.ts", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    await coordinator.runWithKeepalive(turn1, undefined, undefined, ctx);
    await coordinator.runWithKeepalive(
      { ...turn2, model: "m2" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(calls.acquire, 2);
  });

  it("routes to cold when the request carries no session id", async () => {
    const { engine, calls } = makeEngine();
    const ctx = makeCtx(engine);
    const result = await coordinator.runWithKeepalive(
      { ...turn1, sessionId: undefined },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(result.output, "cold");
    assert.equal(calls.cold, 1);
    assert.equal(calls.acquire, 0);
  });

  it("resolves the provider the same way for both import paths", () => {
    for (const request of [turn1, { ...turn1, sandbox: "daytona" }]) {
      assert.equal(
        coordinator.resolveKeepaliveProvider(request),
        server.resolveKeepaliveProvider(request),
      );
    }
  });
});
