/**
 * Unit tests for skill materialization (`engines/skills.ts`), the shared helper both engines
 * use to turn resolved inline skill packages (`WireSkill[]`) into directories on disk.
 *
 * No harness, no network: just disk materialization of inline packages into a per-run temp
 * root, plus the executable-file gating (default deny).
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/skills.test.ts)
 */
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import type { WireSkill } from "../../src/protocol.ts";
import {
  type MaterializedSkill,
  type SkillExecPolicy,
  resolveSkillDirs,
} from "../../src/engines/skills.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function materialize(
  skills: WireSkill[],
  log: (message: string) => void = () => {},
  execPolicy: SkillExecPolicy = "deny",
): MaterializedSkill[] {
  const out = resolveSkillDirs(skills, log, execPolicy);
  // Always track the materializer's own cleanup handle so the per-run root is removed.
  cleanups.push(out.cleanup);
  return out.skills;
}

const SKILL: WireSkill = {
  name: "release-notes",
  description: "Draft release notes from a changelog.",
  body: "Read the changelog, then write release notes.",
};

describe("resolveSkillDirs (materializer)", () => {
  it("writes SKILL.md with composed frontmatter and the body", () => {
    const [skill] = materialize([SKILL]);
    assert.equal(skill.name, "release-notes");
    const md = readFileSync(join(skill.dir, "SKILL.md"), "utf-8");
    assert.match(
      md,
      /^---\nname: "release-notes"\ndescription: "Draft release notes from a changelog\."\n---\n/,
    );
    assert.match(md, /Read the changelog, then write release notes\./);
  });

  it("emits disable-model-invocation in the frontmatter only when set", () => {
    const [plain] = materialize([SKILL]);
    assert.doesNotMatch(
      readFileSync(join(plain.dir, "SKILL.md"), "utf-8"),
      /disable-model-invocation/,
    );
    const [hidden] = materialize([{ ...SKILL, disableModelInvocation: true }]);
    assert.match(
      readFileSync(join(hidden.dir, "SKILL.md"), "utf-8"),
      /disable-model-invocation: true/,
    );
  });

  it("lays bundled files at their relative paths", () => {
    const [skill] = materialize([
      {
        ...SKILL,
        files: [
          { path: "scripts/draft.py", content: "print('draft')" },
          { path: "references/notes.md", content: "# notes" },
        ],
      },
    ]);
    assert.equal(
      readFileSync(join(skill.dir, "scripts/draft.py"), "utf-8"),
      "print('draft')",
    );
    assert.equal(
      readFileSync(join(skill.dir, "references/notes.md"), "utf-8"),
      "# notes",
    );
  });

  it("does NOT chmod +x an executable file when policy is deny (default)", () => {
    const [skill] = materialize([
      {
        ...SKILL,
        allowExecutableFiles: true,
        files: [
          { path: "scripts/run.sh", content: "echo hi", executable: true },
        ],
      },
    ]);
    const mode = statSync(join(skill.dir, "scripts/run.sh")).mode & 0o111;
    assert.equal(mode, 0, "no execute bits without an allowing policy");
  });

  it("does NOT chmod +x when the skill disallows executable files, even with an allow policy", () => {
    const logs: string[] = [];
    const [skill] = materialize(
      [
        {
          ...SKILL,
          allowExecutableFiles: false,
          files: [
            { path: "scripts/run.sh", content: "echo hi", executable: true },
          ],
        },
      ],
      (m: string) => logs.push(m),
      "allow",
    );
    const mode = statSync(join(skill.dir, "scripts/run.sh")).mode & 0o111;
    assert.equal(mode, 0, "skill opt-out wins even when policy allows");
    assert.ok(logs.some((m) => /not made executable/.test(m)));
  });

  it("chmod +x ONLY when the skill allows AND the policy allows", () => {
    const [skill] = materialize(
      [
        {
          ...SKILL,
          allowExecutableFiles: true,
          files: [
            { path: "scripts/run.sh", content: "echo hi", executable: true },
          ],
        },
      ],
      () => {},
      "allow",
    );
    const mode = statSync(join(skill.dir, "scripts/run.sh")).mode & 0o111;
    assert.notEqual(mode, 0, "execute bits set when both gates open");
  });

  it("skips an unsafe file path (absolute / parent escape) but keeps the skill", () => {
    const logs: string[] = [];
    const [skill] = materialize(
      [
        {
          ...SKILL,
          files: [
            { path: "../escape.py", content: "x" },
            { path: "/etc/passwd", content: "x" },
            { path: "scripts/ok.py", content: "ok" },
          ],
        },
      ],
      (m: string) => logs.push(m),
    );
    assert.equal(readFileSync(join(skill.dir, "scripts/ok.py"), "utf-8"), "ok");
    assert.equal(existsSync(join(skill.dir, "escape.py")), false);
    assert.equal(logs.filter((m) => /unsafe skill file/.test(m)).length, 2);
  });

  it("materializes multiple skills into separate dirs under one root", () => {
    const out = materialize([SKILL, { ...SKILL, name: "other" }]);
    assert.deepEqual(
      out.map((s) => s.name),
      ["release-notes", "other"],
    );
    assert.notEqual(out[0].dir, out[1].dir);
    assert.ok(existsSync(join(out[0].dir, "SKILL.md")));
    assert.ok(existsSync(join(out[1].dir, "SKILL.md")));
  });

  it("treats empty / undefined input as a no-op", () => {
    assert.deepEqual(resolveSkillDirs(undefined).skills, []);
    assert.deepEqual(resolveSkillDirs([]).skills, []);
  });

  it("rejects a skill whose name would traverse out of the root (untrusted wire)", () => {
    const logs: string[] = [];
    const out = materialize(
      [
        { ...SKILL, name: "../escape" } as WireSkill,
        { ...SKILL, name: "/etc/cron.d/x" } as WireSkill,
        { ...SKILL, name: "Bad Name" } as WireSkill,
        SKILL, // a valid one survives alongside the rejected ones
      ],
      (m: string) => logs.push(m),
    );
    assert.deepEqual(
      out.map((s) => s.name),
      ["release-notes"],
    );
    assert.equal(logs.filter((m) => /unsafe name/.test(m)).length, 3);
  });

  it("rejects a bundled file that targets SKILL.md (would clobber the composed frontmatter)", () => {
    const logs: string[] = [];
    const [skill] = materialize(
      [
        {
          ...SKILL,
          files: [
            { path: "SKILL.md", content: "name: hijacked" },
            { path: "skill.md", content: "name: hijacked-too" }, // case-insensitive
            { path: "scripts/ok.py", content: "ok" },
          ],
        },
      ],
      (m: string) => logs.push(m),
    );
    // The composed frontmatter is intact, not the bundled-file content.
    const md = readFileSync(join(skill.dir, "SKILL.md"), "utf-8");
    assert.match(md, /^---\nname: "release-notes"/);
    assert.doesNotMatch(md, /hijacked/);
    assert.equal(readFileSync(join(skill.dir, "scripts/ok.py"), "utf-8"), "ok");
    assert.equal(logs.filter((m) => /unsafe skill file/.test(m)).length, 2);
  });

  it("escapes YAML-breaking characters in the description scalar", () => {
    const [skill] = materialize([
      {
        ...SKILL,
        description: 'Trigger: when foo: bar # baz, use "quotes" too.',
      },
    ]);
    const md = readFileSync(join(skill.dir, "SKILL.md"), "utf-8");
    // The description rides as a quoted (JSON-encoded) scalar, so the `:` / `#` / `"` are inert.
    assert.match(
      md,
      /description: "Trigger: when foo: bar # baz, use \\"quotes\\" too\."/,
    );
  });

  it("cleanup() removes the per-run temp root", () => {
    const out = resolveSkillDirs([SKILL]);
    const root = join(out.skills[0].dir, "..");
    assert.equal(existsSync(root), true);
    out.cleanup();
    assert.equal(existsSync(root), false);
  });
});
