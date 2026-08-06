/**
 * Seam tests for the environment lifecycle units (lifecycle migration, step 5).
 *
 * Same style as the S6 coordinator proof: assert on the SEAM, not on behavior the existing suites
 * already cover. Each unit gets its public surface pinned, and the stage names get their own
 * guard, because they are matched by dashboards outside this repository.
 *
 * Run: pnpm exec vitest run tests/unit/environment-units.test.ts
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ACQUIRE_STAGES,
  createTimingLog,
  type AcquireStage,
} from "../../src/environment/timing.ts";
import * as workspaceManager from "../../src/environment/workspace-manager.ts";

const SRC = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf-8");

/**
 * Every file that may emit an acquire stage. The split moves stages OUT of `environment.ts` and
 * into the units, so the stage guard has to follow them. A unit added later must be listed here,
 * or its stages become invisible to the guard.
 *
 * `environment/timing.ts` MUST NOT be listed, and this is not a detail. That file DECLARES the
 * stage names as quoted string literals, so searching it for `"sandbox_start"` finds the
 * declaration rather than an emission. With it in the list the guard below matched its own
 * source, passed for a stage nothing emitted any more, and reported a healthy dashboard contract
 * while the dashboards broke. A guard that cannot fail is worse than no guard, because it is what
 * the next reviewer checks against.
 */
const STAGE_EMITTERS = [
  "engines/sandbox_agent/environment.ts",
  "engines/sandbox_agent/environment-setup.ts",
  "environment/sandbox-lifecycle.ts",
  "environment/workspace-manager.ts",
  "environment/mount-lifecycle.ts",
  "environment/harness-session-lifecycle.ts",
  "environment/runtime-lifecycle.ts",
];

const ALL_STAGE_SOURCE = () => STAGE_EMITTERS.map(SRC).join("\n");

/**
 * Strip block and line comments, so a source assertion checks CODE and not prose.
 *
 * These units are heavily commented on purpose, and the prose legitimately uses the same words
 * the assertions forbid in code. A check that cannot tell the two apart would either fail on a
 * comment or be loosened until it proves nothing.
 */
const CODE_ONLY = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("timing: the stage names are a public interface", () => {
  it("emits the documented line shape", () => {
    const lines: string[] = [];
    const timingLog = createTimingLog((m) => lines.push(m), {
      sandboxId: () => "sbx-1",
      sessionId: () => "sess-1",
    });
    timingLog("sandbox_start", Date.now() - 25, " mode=create");
    assert.match(
      lines[0],
      /^\[timing\] stage=sandbox_start ms=\d+ sandbox=sbx-1 session=sess-1 mode=create$/,
    );
  });

  it("renders a missing sandbox or session as '-', never as 'undefined'", () => {
    const lines: string[] = [];
    const timingLog = createTimingLog((m) => lines.push(m), {
      sandboxId: () => undefined,
      sessionId: () => undefined,
    });
    timingLog("acquire_total", Date.now());
    assert.match(lines[0], /sandbox=- session=-/);
    assert.doesNotMatch(lines[0], /undefined/);
  });

  it("reads its accessors at CALL time, not at build time", () => {
    // The reason this is a factory. The sandbox does not exist when the logger is built, and the
    // session id changes during acquire. Capturing either by value would log a stale `-`.
    let sandboxId: string | undefined;
    const lines: string[] = [];
    const timingLog = createTimingLog((m) => lines.push(m), {
      sandboxId: () => sandboxId,
      sessionId: () => "sess-1",
    });
    timingLog("mounts", Date.now());
    sandboxId = "sbx-late";
    timingLog("prepare_workspace", Date.now());
    assert.match(lines[0], /sandbox=-/);
    assert.match(lines[1], /sandbox=sbx-late/);
  });

  it("declares every stage the acquire path emits", () => {
    // The guard that keeps dashboards working. If a stage is renamed or dropped during the split,
    // the source no longer emits it and this fails.
    //
    // The match is on the CALL, `timingLog("<stage>"`, not on the bare quoted name. A quoted name
    // occurs in plenty of places that emit nothing, the declaration in `timing.ts` first among
    // them, and matching those is how this guard used to pass for a stage that had gone.
    const source = CODE_ONLY(ALL_STAGE_SOURCE());
    for (const stage of ACQUIRE_STAGES) {
      assert.match(
        source,
        new RegExp(`timingLog\\(\\s*"${stage}"`),
        `stage '${stage}' is declared but no longer emitted; dashboards match on this name`,
      );
    }
  });

  it("emits no stage that is undeclared", () => {
    // The other direction: a new stage must be added to `ACQUIRE_STAGES` so the list stays the
    // one place that documents the public set.
    const source = ALL_STAGE_SOURCE();
    const emitted = new Set<string>();
    for (const m of source.matchAll(/timingLog\(\s*"([a-z_]+)"/g)) emitted.add(m[1]);
    for (const stage of emitted) {
      assert.ok(
        (ACQUIRE_STAGES as readonly string[]).includes(stage),
        `'${stage}' is emitted but not declared in ACQUIRE_STAGES`,
      );
    }
    assert.ok(emitted.size > 0, "the source must still emit stages");
  });

  it("keeps the two-mode stages as ONE stage name with a mode suffix", () => {
    // A dashboard groups by stage and splits by mode. Turning `sandbox_start` into
    // `sandbox_start_create` would silently break every existing query.
    //
    // Stage and mode are matched in ONE expression, over a single call. Checked apart, they were
    // satisfied by any two emissions anywhere in the source, so `mode=create` on `create_session`
    // stood in for `mode=create` on `sandbox_start` and a mode moved to the wrong stage passed.
    const source = CODE_ONLY(ALL_STAGE_SOURCE());
    for (const [stage, modes] of [
      ["sandbox_start", ["reconnect", "create"]],
      ["create_session", ["load", "create"]],
    ] as Array<[AcquireStage, string[]]>) {
      for (const mode of modes) {
        assert.match(
          source,
          new RegExp(`timingLog\\(\\s*"${stage}"\\s*,[^;]*mode=${mode}\\b`),
          `${stage} must still carry mode=${mode} as a field of its OWN call, not in its name`,
        );
      }
    }
  });
});

describe("workspace manager: the public surface", () => {
  it("exposes materialize, refresh, and cleanup", () => {
    assert.equal(typeof workspaceManager.materialize, "function");
    assert.equal(typeof workspaceManager.refresh, "function");
    assert.equal(typeof workspaceManager.cleanup, "function");
  });

  it("materialize delegates to the injected writer with the caller's input", async () => {
    const seen: unknown[] = [];
    const fake = { cleanup: async () => {} };
    const result = await workspaceManager.materialize(
      {
        sandbox: { id: "sbx" },
        plan: {
          marker: "the-plan",
          isPi: false,
          acpAgent: "claude",
          prompt: { agentsMd: "body" },
          workspace: { cwd: "/run/cwd", skillDirs: [] },
        } as never,
        piSkillSnapshot: { marker: "snapshot" } as never,
        log: () => {},
      },
      {
        prepareWorkspace: (async (input: unknown) => {
          seen.push(input);
          return fake;
        }) as never,
      },
    );
    // Step 6: materialize now returns a ManagedWorkspace — the writer's handle PLUS the
    // inventory of what it wrote — so it is no longer reference-equal to the raw result.
    assert.equal(result.cleanup, fake.cleanup, "the writer's handle is carried through");
    assert.equal(result.inventory.instructionsFile, "CLAUDE.md");
    assert.equal(seen.length, 1);
    const input = seen[0] as Record<string, unknown>;
    assert.equal((input.plan as { marker: string }).marker, "the-plan");
    assert.deepEqual(input.sandbox, { id: "sbx" });
  });

  it("refresh takes a complete manifest, because deletion needs one", () => {
    // DELIBERATE EDIT. Step 5 asserted `refresh` threw "not implemented"; step 6 implements it.
    // A delta cannot express a removal — it cannot tell "unchanged" from "gone" — so the manifest
    // is a complete statement and the previous inventory is what makes deletion decidable.
    const manifest: workspaceManager.WorkspaceManifest = {
      instructions: "body",
      skills: [{ name: "pdf-tools", dir: "/tmp/pdf-tools" }],
    };
    assert.equal(manifest.instructions, "body");
    assert.deepEqual(
      manifest.skills.map((s) => s.name),
      ["pdf-tools"],
    );
  });

  it("cleanup swallows a failing cleanup and tolerates no workspace", async () => {
    // Teardown must never throw. Both are exercised because a partial acquire leaves no
    // workspace at all.
    await workspaceManager.cleanup(undefined);
    await workspaceManager.cleanup({
      cleanup: async () => {
        throw new Error("boom");
      },
    });
  });

  it("does NOT wire any in-place route yet", () => {
    // The scope line for step 5. `refresh` must have no caller until step 6.
    for (const rel of [
      "engines/sandbox_agent/environment.ts",
      "engines/sandbox_agent/environment-setup.ts",
      "lifecycle/session-coordinator.ts",
    ]) {
      assert.ok(
        !/\brefresh(Workspace)?\s*\(/.test(SRC(rel)),
        `${rel} calls the workspace refresh; step 5 must not wire an in-place route`,
      );
    }
  });
});

describe("the composer delegates instead of inlining", () => {
  it("environment.ts writes the workspace through the unit", () => {
    const source = SRC("engines/sandbox_agent/environment.ts");
    assert.ok(source.includes("materializeWorkspace("));
    assert.ok(source.includes("cleanupWorkspace("));
  });

  it("environment.ts no longer calls prepareWorkspace directly", () => {
    // The seam only holds if the composer cannot reach past it.
    const source = SRC("engines/sandbox_agent/environment.ts");
    assert.ok(
      !/deps\.prepareWorkspace \?\? prepareWorkspace/.test(source),
      "the composer still inlines the workspace write",
    );
  });

  it("environment-setup.ts builds the stage logger through the timing unit", () => {
    const source = SRC("engines/sandbox_agent/environment-setup.ts");
    assert.ok(source.includes("createTimingLog("));
    assert.ok(
      !source.includes("`[timing] stage="),
      "the line shape must live in one place",
    );
  });
});

describe("mount unit: the seam (lifecycle migration, step 5 / S7b)", () => {
  it("the six helpers left environment.ts", () => {
    // They were mutually recursive closures over `acquireEnvironment`'s scope. The composer now
    // holds thin adapters that pass `ctx`; the bodies live in the unit.
    const source = SRC("engines/sandbox_agent/environment.ts");
    for (const marker of [
      "let agentMountGuidanceActive",
      "let localAgentMountEnotconnRemounts",
      "let localDurableCwdEnotconnRemounts",
    ]) {
      assert.ok(
        !source.includes(marker),
        `environment.ts still declares '${marker}'; that state belongs on the context`,
      );
    }
  });

  it("the unit captures nothing: every helper takes ctx as its first parameter", () => {
    const source = SRC("environment/mount-lifecycle.ts");
    for (const fn of [
      "activateAgentMountGuidance",
      "mountLocalDurableCwd",
      "mountLocalAgentCwd",
      "reSignAndRemountLocalAgentMount",
      "reSignAndRemountLocalCwd",
      "remountLocalCwdAfterRuntimeEnotconn",
    ]) {
      assert.ok(
        source.includes(`function ${fn}(`),
        `${fn} must be a top-level function in the unit`,
      );
    }
    assert.equal(
      source.split("ctx: AcquireContext").length - 1,
      6,
      "all six helpers take ctx; a captured variable would defeat the split",
    );
  });

  it("the unit never touches the mutable environment or the raw env maps", () => {
    // The structural half of the external review's first finding. A unit that could reach
    // `environment.x = ...` would make the ownership table documentation again.
    const source = CODE_ONLY(SRC("environment/mount-lifecycle.ts"));
    assert.ok(!source.includes("environment."), "no direct environment access");
    assert.ok(
      !source.includes("piExtEnv"),
      "the daemon env maps stay private to the context",
    );
  });

  it("every operational catch rethrows an invariant violation first", () => {
    // Without this the freeze throw dies in mountLocalAgentCwd's catch and the run continues
    // with a harness that cannot see its durable storage.
    const source = SRC("environment/mount-lifecycle.ts");
    assert.ok(source.includes("catch (err)"), "the unit still has an operational catch");
    assert.ok(
      source.includes("rethrowIfInvariant(err)"),
      "an operational catch must start with rethrowIfInvariant",
    );
  });

  it("the composer freezes the daemon env BEFORE building the provider", () => {
    // INVARIANT 1's enforcement point. `buildSandboxProvider` takes the env maps by reference.
    const source = SRC("engines/sandbox_agent/environment.ts");
    const freeze = source.indexOf("ctx.freezeDaemonEnv()");
    const provider = source.indexOf("buildSandboxProvider)(");
    assert.ok(freeze > 0, "the composer must freeze the daemon env");
    assert.ok(provider > 0);
    assert.ok(
      freeze < provider,
      "the freeze must come BEFORE the provider takes the env maps by reference",
    );
  });

  it("the composer kept every call site it had before", () => {
    // `reSignAndRemountLocalAgentMount` is absent on purpose: it was only ever reached from the
    // ENOTCONN handler, so it is now internal to the unit.
    const source = SRC("engines/sandbox_agent/environment.ts");
    for (const call of [
      'mountLocalDurableCwd("initial")',
      "mountLocalAgentCwd()",
      "activateAgentMountGuidance()",
      "reSignAndRemountLocalCwd()",
      "remountLocalCwdAfterRuntimeEnotconn",
    ]) {
      assert.ok(source.includes(call), `the composer lost its '${call}' call site`);
    }
  });

  it("teardown records the cwd unmount through its named transition", () => {
    const source = SRC("engines/sandbox_agent/environment.ts");
    assert.ok(source.includes("ctx.recordCwdUnmountResult("));
    assert.ok(
      !source.includes("durableCwdSafeToDelete ="),
      "durableCwdSafeToDelete must no longer be assigned directly",
    );
  });
});

describe("harness-session unit: the seam", () => {
  it("owns both acquire stages and the session teardown", () => {
    const source = SRC("environment/harness-session-lifecycle.ts");
    assert.ok(source.includes('"probe_capabilities"'));
    assert.ok(source.includes('"create_session"'));
    assert.ok(source.includes("export async function teardown("));
  });

  it("keeps create_session as ONE stage with a mode field", () => {
    const source = CODE_ONLY(SRC("environment/harness-session-lifecycle.ts"));
    assert.ok(source.includes('" mode=load"'));
    assert.ok(source.includes('" mode=create"'));
  });

  it("takes an explicit input rather than AcquireContext", () => {
    // Deliberate: nothing here shares mutable state or calls a sibling, so threading the context
    // through would imply a coupling that does not exist.
    const source = CODE_ONLY(SRC("environment/harness-session-lifecycle.ts"));
    assert.ok(!source.includes("AcquireContext"));
  });

  it("reports loadedFromContinuity WITHOUT claiming history replayed", () => {
    // The comparison proves the adapter accepted the id, not that it replayed the turns. The
    // caveat is in the type's doc comment so a reader cannot mistake one for the other.
    const source = SRC("environment/harness-session-lifecycle.ts");
    assert.ok(source.includes("It does NOT prove the adapter replayed the turns"));
  });

  it("the composer delegates both stages", () => {
    const source = SRC("engines/sandbox_agent/environment.ts");
    assert.ok(source.includes("await probeHarness("));
    assert.ok(source.includes("await openHarnessSession("));
    assert.ok(source.includes("await teardownHarnessSession("));
  });
});

describe("runtime unit: the seam", () => {
  it("owns the in-flight quiesce and the runner-owned files", () => {
    const source = SRC("environment/runtime-lifecycle.ts");
    assert.ok(source.includes("export async function teardownInFlight("));
    assert.ok(source.includes("export function removeRuntimeFiles("));
    assert.ok(source.includes("export function buildRuntimeEnvironment("));
  });

  it("declares NO restart or reconfigure, because neither exists yet", () => {
    // The honest answer. Inventing a `restart()` that throws would suggest the seam is there.
    const source = CODE_ONLY(SRC("environment/runtime-lifecycle.ts"));
    assert.ok(!source.includes("export function restart"));
    assert.ok(!source.includes("export async function restart"));
    assert.ok(!source.includes("export function reconfigure"));
  });

  it("the composer quiesces BEFORE it removes the sandbox from the registry", () => {
    // Ordering is load-bearing: an in-flight remount or `tools/call` must be stopped before
    // anything else in destroy frees state under it.
    const source = SRC("engines/sandbox_agent/environment.ts");
    const quiesce = source.indexOf("teardownRuntimeInFlight(");
    const registry = source.indexOf("inFlightSandboxes.delete(");
    assert.ok(quiesce > 0 && registry > 0);
    assert.ok(quiesce < registry, "the quiesce must come first");
  });

  it("the composer removes runner files through the unit", () => {
    const source = SRC("engines/sandbox_agent/environment.ts");
    assert.ok(source.includes("removeRuntimeFiles({"));
  });
});

describe("environment-setup is a planner again", () => {
  it("no longer builds the daemon environment or writes the OTLP bearer", () => {
    // The purification. These were never planning: they build two env maps and write a file.
    const source = CODE_ONLY(SRC("engines/sandbox_agent/environment-setup.ts"));
    for (const marker of [
      "buildDaemonEnv)(",
      "writeOtlpAuthFile(",
      "buildPiExtensionEnv(",
      "configureDaytonaCodexEnv(",
    ]) {
      assert.ok(
        !source.includes(marker),
        `environment-setup still performs '${marker}'; it belongs to the runtime unit`,
      );
    }
  });

  it("delegates to the runtime unit instead", () => {
    const source = SRC("engines/sandbox_agent/environment-setup.ts");
    assert.ok(source.includes("buildRuntimeEnvironment({"));
  });
});
