/**
 * `WorkspaceManager.refresh` correctness (lifecycle migration, step 6).
 *
 * The in-place workspace refresh is the cheapest live route in the design, and the one whose
 * failure is quietest: a skill that was REMOVED from the request but stays on disk is still
 * readable by the model. For an ordinary skill that is a correctness bug; for a skill removed
 * because it was unsafe, the removal silently does nothing.
 *
 * So these tests run against a REAL temp directory, not a mock. Deletion either happens on a
 * filesystem or it does not.
 *
 * Run: pnpm exec vitest run tests/unit/workspace-refresh.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inventoryOf,
  refresh,
  type WorkspaceInventory,
} from "../../src/environment/workspace-manager.ts";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "agenta-ws-refresh-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** A local Claude plan: instructions land in CLAUDE.md, skills under `.claude/skills`. */
function planFor(skills: Array<{ name: string; dir: string }>, agentsMd = "instructions") {
  return {
    isPi: false,
    isDaytona: false,
    acpAgent: "claude",
    prompt: { agentsMd },
    workspace: { cwd, skillDirs: skills },
  } as never;
}

function input(plan: unknown) {
  return { sandbox: {}, plan: plan as never, log: () => {} };
}

/** Materialize a skill source directory the refresh can copy from. */
function skillSource(name: string, body: string): { name: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `agenta-skill-${name}-`));
  writeFileSync(join(dir, "SKILL.md"), body);
  return { name, dir };
}

const skillPath = (name: string) => join(cwd, ".claude", "skills", name);

describe("the inventory records what a write leaves behind", () => {
  it("names the instructions file per harness", () => {
    assert.equal(inventoryOf(planFor([])).instructionsFile, "CLAUDE.md");
    const piPlan = {
      isPi: true,
      acpAgent: "pi",
      prompt: { agentsMd: "x" },
      workspace: { cwd, skillDirs: [] },
    } as never;
    assert.equal(inventoryOf(piPlan).instructionsFile, "AGENTS.md");
  });

  it("records no instructions file when the plan writes none", () => {
    // Built inline: `planFor`'s default parameter applies when the argument IS `undefined`, so it
    // cannot express "no instructions" at all.
    const plan = {
      isPi: false,
      acpAgent: "claude",
      prompt: {},
      workspace: { cwd, skillDirs: [] },
    } as never;
    assert.equal(inventoryOf(plan).instructionsFile, undefined);
  });

  it("records no skills for Pi, which uses a content-addressed snapshot instead", () => {
    const piPlan = {
      isPi: true,
      acpAgent: "pi",
      prompt: { agentsMd: "x" },
      workspace: { cwd, skillDirs: [{ name: "a" }] },
    } as never;
    const inventory = inventoryOf(piPlan);
    assert.equal(inventory.skillRoot, undefined);
    assert.deepEqual([...inventory.skillNames], []);
  });
});

describe("refresh: writes", () => {
  it("writes the instructions file", async () => {
    await refresh(input(planFor([])), { instructions: "hello", skills: [] }, {
      instructionsFile: undefined,
      skillNames: [],
      skillRoot: ".claude/skills",
    });
    assert.equal(readFileSync(join(cwd, "CLAUDE.md"), "utf-8"), "hello");
  });

  it("replaces existing instructions rather than appending", async () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "OLD");
    await refresh(input(planFor([])), { instructions: "NEW", skills: [] }, {
      instructionsFile: "CLAUDE.md",
      skillNames: [],
      skillRoot: ".claude/skills",
    });
    assert.equal(readFileSync(join(cwd, "CLAUDE.md"), "utf-8"), "NEW");
  });

  it("leaves no temp file behind, so the atomic write is invisible afterwards", async () => {
    await refresh(input(planFor([])), { instructions: "hello", skills: [] }, {
      instructionsFile: undefined,
      skillNames: [],
      skillRoot: ".claude/skills",
    });
    assert.deepEqual(
      readdirSync(cwd).filter((n) => n.includes(".tmp")),
      [],
      "the staging file must be renamed over the target, never left in place",
    );
  });

  it("writes a skill directory from its materialized source", async () => {
    const pdf = skillSource("pdf-tools", "PDF BODY");
    await refresh(
      input(planFor([pdf])),
      { instructions: "x", skills: [pdf] },
      { instructionsFile: undefined, skillNames: [], skillRoot: ".claude/skills" },
    );
    assert.equal(
      readFileSync(join(skillPath("pdf-tools"), "SKILL.md"), "utf-8"),
      "PDF BODY",
    );
  });

  it("replaces a skill's contents rather than merging them", async () => {
    const before = skillSource("pdf-tools", "V1");
    mkdirSync(skillPath("pdf-tools"), { recursive: true });
    writeFileSync(join(skillPath("pdf-tools"), "STALE.md"), "leftover");

    const after = skillSource("pdf-tools", "V2");
    await refresh(
      input(planFor([after])),
      { instructions: "x", skills: [after] },
      {
        instructionsFile: undefined,
        skillNames: ["pdf-tools"],
        skillRoot: ".claude/skills",
      },
    );
    assert.equal(
      readFileSync(join(skillPath("pdf-tools"), "SKILL.md"), "utf-8"),
      "V2",
    );
    assert.ok(
      !existsSync(join(skillPath("pdf-tools"), "STALE.md")),
      "a file that left the skill must not survive the refresh",
    );
    void before;
  });
});

describe("refresh: DELETION, the reason this route needs an inventory", () => {
  it("removes a skill that left the request", async () => {
    const keep = skillSource("keep", "KEEP");
    const drop = skillSource("drop", "DROP");
    mkdirSync(skillPath("drop"), { recursive: true });
    writeFileSync(join(skillPath("drop"), "SKILL.md"), "DROP");
    mkdirSync(skillPath("keep"), { recursive: true });

    const result = await refresh(
      input(planFor([keep])),
      { instructions: "x", skills: [keep] },
      {
        instructionsFile: undefined,
        skillNames: ["keep", "drop"],
        skillRoot: ".claude/skills",
      },
    );

    assert.ok(
      !existsSync(skillPath("drop")),
      "a removed skill must not stay readable by the model",
    );
    assert.ok(existsSync(skillPath("keep")));
    assert.deepEqual([...result.removedSkills], ["drop"]);
  });

  it("decides deletion from the INVENTORY, never from a directory listing", async () => {
    // The load-bearing property. A durable cwd holds the agent's own files, and almost none of
    // them are the runner's to remove. A skill-shaped directory the runner never wrote must
    // survive, because it is not in the inventory.
    const keep = skillSource("keep", "KEEP");
    mkdirSync(skillPath("not-ours"), { recursive: true });
    writeFileSync(join(skillPath("not-ours"), "SKILL.md"), "USER FILE");

    await refresh(
      input(planFor([keep])),
      { instructions: "x", skills: [keep] },
      {
        instructionsFile: undefined,
        skillNames: ["keep"], // `not-ours` is absent: the runner never wrote it
        skillRoot: ".claude/skills",
      },
    );

    assert.ok(
      existsSync(join(skillPath("not-ours"), "SKILL.md")),
      "a directory the runner never wrote is not its to delete",
    );
  });

  it("removes the instructions file when the manifest drops it", async () => {
    writeFileSync(join(cwd, "CLAUDE.md"), "OLD");
    await refresh(
      input({
        isPi: false,
        isDaytona: false,
        acpAgent: "claude",
        prompt: {},
        workspace: { cwd, skillDirs: [] },
      } as never),
      { instructions: undefined, skills: [] },
      { instructionsFile: "CLAUDE.md", skillNames: [], skillRoot: ".claude/skills" },
    );
    assert.ok(!existsSync(join(cwd, "CLAUDE.md")));
  });

  it("THROWS on a failed delete, so the caller falls back to a rebuild", async () => {
    // Continuing after a failed delete would leave the removed skill readable, which is the exact
    // outcome this route exists to prevent. Silence here would be worse than a rebuild.
    const failing = {
      ...input(planFor([])),
      plan: {
        isPi: false,
        isDaytona: true,
        acpAgent: "claude",
        prompt: { agentsMd: "x" },
        workspace: { cwd, skillDirs: [] },
      } as never,
      sandbox: {
        deleteFsEntry: async () => {
          throw new Error("daemon refused");
        },
      },
    };
    await assert.rejects(
      () =>
        refresh(
          failing,
          { instructions: "x", skills: [] },
          {
            instructionsFile: undefined,
            skillNames: ["gone"],
            skillRoot: ".claude/skills",
          },
        ),
      (err: Error) => /could not remove skill 'gone'/.test(err.message),
    );
  });

  it("reports an accurate new inventory", async () => {
    const keep = skillSource("keep", "KEEP");
    const result = await refresh(
      input(planFor([keep])),
      { instructions: "x", skills: [keep] },
      {
        instructionsFile: undefined,
        skillNames: ["keep", "drop"],
        skillRoot: ".claude/skills",
      },
    );
    const next: WorkspaceInventory = result.inventory;
    assert.equal(next.instructionsFile, "CLAUDE.md");
    assert.deepEqual([...next.skillNames], ["keep"]);
  });
});

describe("refresh: SCOPE, the facet boundary", () => {
  it("never touches harness files, because they may be permission files", async () => {
    // adapter-matrix.md 4.3.2 rule 3. `harnessFiles` is its own facet that escalates to a session
    // reopen; a refresh that wrote them would route a security-relevant change through an
    // in-place write.
    const harnessFile = join(cwd, ".claude", "settings.json");
    mkdirSync(join(cwd, ".claude"), { recursive: true });
    writeFileSync(harnessFile, '{"permissions":"strict"}');

    await refresh(input(planFor([])), { instructions: "x", skills: [] }, {
      instructionsFile: undefined,
      skillNames: [],
      skillRoot: ".claude/skills",
    });

    assert.equal(
      readFileSync(harnessFile, "utf-8"),
      '{"permissions":"strict"}',
      "a harness file must survive a workspace refresh untouched",
    );
  });

  it("never touches the agent's own working files", async () => {
    const userFile = join(cwd, "my-project.py");
    writeFileSync(userFile, "print('mine')");
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "app.ts"), "export {}");

    await refresh(input(planFor([])), { instructions: "x", skills: [] }, {
      instructionsFile: undefined,
      skillNames: [],
      skillRoot: ".claude/skills",
    });

    assert.equal(readFileSync(userFile, "utf-8"), "print('mine')");
    assert.ok(existsSync(join(cwd, "src", "app.ts")));
  });
});
