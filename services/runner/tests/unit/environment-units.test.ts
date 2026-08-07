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
 */
const STAGE_EMITTERS = [
  "engines/sandbox_agent/environment.ts",
  "engines/sandbox_agent/environment-setup.ts",
  "environment/sandbox-lifecycle.ts",
  "environment/workspace-manager.ts",
  "environment/timing.ts",
];

const ALL_STAGE_SOURCE = () => STAGE_EMITTERS.map(SRC).join("\n");

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
    const source = ALL_STAGE_SOURCE();
    for (const stage of ACQUIRE_STAGES) {
      assert.ok(
        source.includes(`"${stage}"`),
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
    const source = ALL_STAGE_SOURCE();
    for (const [stage, modes] of [
      ["sandbox_start", ["reconnect", "create"]],
      ["create_session", ["load", "create"]],
    ] as Array<[AcquireStage, string[]]>) {
      for (const mode of modes) {
        assert.ok(
          source.includes(`"${stage}", `) && source.includes(`mode=${mode}`),
          `${stage} must still carry mode=${mode} as a field, not in its name`,
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
        plan: { marker: "the-plan" } as never,
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
    assert.equal(result, fake);
    assert.equal(seen.length, 1);
    const input = seen[0] as Record<string, unknown>;
    assert.deepEqual(input.plan, { marker: "the-plan" });
    assert.deepEqual(input.sandbox, { id: "sbx" });
  });

  it("refresh is DECLARED but not implemented, and says so", async () => {
    // Step 5 is a structural split with zero behavior change. The entry exists so step 6 is a
    // routing change; throwing is what keeps it from being wired by accident.
    await assert.rejects(
      () =>
        workspaceManager.refresh(
          { sandbox: {}, plan: {} as never, log: () => {} },
          { files: new Map(), skillDirs: [] },
        ),
      (err: Error) => /not implemented/.test(err.message),
    );
  });

  it("refresh takes a complete manifest, because deletion needs one", () => {
    // A delta cannot express a removal: it cannot tell "unchanged" from "gone". The manifest
    // shape is what lets step 6 delete a skill directory that left the request.
    const manifest: workspaceManager.WorkspaceManifest = {
      files: new Map([["AGENTS.md", "body"]]),
      skillDirs: ["pdf-tools"],
    };
    assert.equal(manifest.files.get("AGENTS.md"), "body");
    assert.deepEqual([...manifest.skillDirs], ["pdf-tools"]);
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
