/**
 * What a live route actually INSTALLS (lifecycle migration, step 6).
 *
 * The route tests one directory over assert on the plan the coordinator chose and on the applied
 * state it advanced to. Both stayed green while the refresh rewrote the configuration the
 * environment was BUILT with, because an action name and a digest cannot tell you which bytes
 * landed. These tests read the files back.
 *
 * The refresh runs for real against a temp directory, because "the new instructions are on disk"
 * is a filesystem property and a fake refresh would prove only that a fake was called.
 *
 * Run: pnpm exec vitest run tests/unit/lifecycle-apply-plan.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyReconcilePlan } from "../../src/environment/apply-plan.ts";
import { buildPlan } from "../../src/lifecycle/reconcile-plan.ts";
import { inventoryOf } from "../../src/environment/workspace-manager.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import type { SessionEnvironment } from "../../src/engines/sandbox_agent/runtime-contracts.ts";

const SKILL_ROOT = ".claude/skills";

function wireSkill(name: string, body: string) {
  return { name, description: `${name} description`, body };
}

const REFRESH_PLAN = buildPlan(
  [{ facet: "workspaceFiles", kind: "refresh-workspace", reason: "r" }],
  ["workspaceFiles"],
);

describe("applyReconcilePlan: refresh-workspace installs the INCOMING configuration", () => {
  let cwd: string;
  let committed: Array<{ configFingerprint: string }>;
  let cleanups: string[];

  /** The environment a first turn would have left behind: old instructions, one old skill. */
  function makeEnv(overrides: { isPi?: boolean } = {}) {
    const plan = {
      isPi: overrides.isPi ?? false,
      isDaytona: false,
      acpAgent: overrides.isPi ? "pi" : "claude",
      prompt: { agentsMd: "OLD instructions" },
      workspace: {
        cwd,
        skillDirs: [{ name: "departed", dir: join(cwd, "source-departed") }],
        skillsCleanup: () => cleanups.push("original"),
      },
    };
    const env = {
      plan,
      sandbox: {},
      workspaceInventory: inventoryOf(plan as never),
      commitApplied: (input: { configFingerprint: string }) =>
        committed.push(input),
    };
    return env as unknown as SessionEnvironment;
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-apply-plan-"));
    committed = [];
    cleanups = [];
    // What the first turn wrote: the old instructions file and the old skill directory.
    writeFileSync(join(cwd, "CLAUDE.md"), "OLD instructions");
    mkdirSync(join(cwd, SKILL_ROOT, "departed"), { recursive: true });
    writeFileSync(
      join(cwd, SKILL_ROOT, "departed", "SKILL.md"),
      "the skill that leaves",
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes the instructions the REQUEST carries, never the plan's", async () => {
    const env = makeEnv();
    const request: AgentRunRequest = {
      harness: "claude",
      agentsMd: "NEW instructions",
      messages: [],
    } as never;

    const applied = await applyReconcilePlan(
      env,
      request,
      REFRESH_PLAN,
      () => {},
    );

    assert.equal(applied, true);
    assert.equal(
      readFileSync(join(cwd, "CLAUDE.md"), "utf-8"),
      "NEW instructions",
      "the agent must read the instructions this request carries",
    );
    assert.equal(
      committed.length,
      1,
      "applied state advances once, after the write",
    );
  });

  it("replaces the plan, so the next refresh deletes the right tree", async () => {
    const env = makeEnv();
    const request: AgentRunRequest = {
      harness: "claude",
      agentsMd: "NEW instructions",
      skills: [wireSkill("arrived", "# arrived")],
      messages: [],
    } as never;

    await applyReconcilePlan(env, request, REFRESH_PLAN, () => {});

    assert.equal(env.plan.prompt.agentsMd, "NEW instructions");
    assert.deepEqual(
      env.plan.workspace.skillDirs.map((skill) => skill.name),
      ["arrived"],
    );
    assert.deepEqual(
      env.workspaceInventory?.skillNames,
      ["arrived"],
      "the inventory records what was WRITTEN; a stale one deletes the wrong tree next time",
    );
    // Both skill roots are removed at teardown. The old one is not removed during the turn:
    // files this session already reads may still be backed by it.
    env.plan.workspace.skillsCleanup();
    assert.deepEqual(cleanups, ["original"]);
  });

  it("installs an arriving skill and removes a departed one", async () => {
    const env = makeEnv();
    const request: AgentRunRequest = {
      harness: "claude",
      agentsMd: "NEW instructions",
      skills: [wireSkill("arrived", "# arrived")],
      messages: [],
    } as never;

    const applied = await applyReconcilePlan(
      env,
      request,
      REFRESH_PLAN,
      () => {},
    );

    assert.equal(applied, true);
    assert.equal(
      existsSync(join(cwd, SKILL_ROOT, "departed")),
      false,
      "a skill that left the request must not stay readable",
    );
    assert.match(
      readFileSync(join(cwd, SKILL_ROOT, "arrived", "SKILL.md"), "utf-8"),
      /# arrived/,
    );
  });

  it("refuses a Pi skills change instead of reporting one it cannot write", async () => {
    // Pi loads one content-addressed snapshot, so `refresh` writes no skill directories there at
    // all. Committing the new configuration after writing none of it is the failure this whole
    // route is guarded against.
    const env = makeEnv({ isPi: true });
    const request: AgentRunRequest = {
      harness: "pi",
      agentsMd: "NEW instructions",
      skills: [wireSkill("arrived", "# arrived")],
      messages: [],
    } as never;

    const applied = await applyReconcilePlan(
      env,
      request,
      REFRESH_PLAN,
      () => {},
    );

    assert.equal(applied, false, "the caller must rebuild");
    assert.equal(committed.length, 0, "and applied state must not advance");
  });

  it("commits nothing when a later action in the same plan fails", async () => {
    // THE ONE RULE, through the real refresh: the workspace write lands, the model action fails,
    // and applied state stays where it was. The caller rebuilds from the truth.
    const env = makeEnv();
    const request: AgentRunRequest = {
      harness: "claude",
      agentsMd: "NEW instructions",
      model: "m2",
      messages: [],
    } as never;
    const plan = buildPlan(
      [
        { facet: "workspaceFiles", kind: "refresh-workspace", reason: "r" },
        { facet: "model", kind: "apply-live", reason: "r" },
      ],
      ["workspaceFiles", "model"],
    );

    const applied = await applyReconcilePlan(env, request, plan, () => {}, {
      applyModel: async () => "a-different-model",
    });

    assert.equal(applied, false);
    assert.equal(committed.length, 0);
  });

  it("refuses an apply-live action for a facet it cannot install (audit finding 7)", async () => {
    // The arm used to treat EVERY `apply-live` as a model change. The day another facet routes
    // here (the credential plan is the expected first), that would install the wrong thing and
    // commit the new configuration. It must fail into a rebuild instead, without calling the
    // model applier at all.
    const env = makeEnv();
    const request: AgentRunRequest = {
      harness: "claude",
      model: "m1",
      messages: [],
    } as never;
    const plan = buildPlan(
      [{ facet: "runtime", kind: "apply-live", reason: "r" }],
      ["runtime"],
    );

    let modelApplierCalled = false;
    const applied = await applyReconcilePlan(env, request, plan, () => {}, {
      applyModel: async () => {
        modelApplierCalled = true;
        return "m1";
      },
    });

    assert.equal(applied, false, "the caller must rebuild");
    assert.equal(committed.length, 0, "and applied state must not advance");
    assert.equal(modelApplierCalled, false, "the model applier must not run");
  });
});
