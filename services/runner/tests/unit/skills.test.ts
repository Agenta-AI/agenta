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

  it("uses the hyphenated disable-model-invocation key, never the camelCase/snake_case spellings", () => {
    // The composed frontmatter must use exactly the hyphenated YAML key the harness reads. The
    // wire field is `disableModelInvocation` (camelCase) and the SDK field is
    // `disable_model_invocation` (snake_case); both must be translated to `disable-model-invocation`
    // here. Pinning all three spellings guards against a future edit silently emitting the wrong
    // one (which would make the flag a no-op).
    const [hidden] = materialize([{ ...SKILL, disableModelInvocation: true }]);
    const md = readFileSync(join(hidden.dir, "SKILL.md"), "utf-8");
    // The exact hyphenated frontmatter line is present.
    assert.match(md, /^disable-model-invocation: true$/m);
    // Neither the wire camelCase nor the SDK snake_case spelling leaks into the rendered file.
    assert.doesNotMatch(md, /disableModelInvocation/);
    assert.doesNotMatch(md, /disable_model_invocation/);
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

// RUN-SKILL-CAP-1: the SDK's pydantic models cap skill sizes, but the wire is untrusted (a
// non-SDK client can POST anything), so the runner must re-enforce them — the same reasoning
// that already drives the skill-name re-validation above. Values mirror
// sdks/python/agenta/sdk/agents/skills/models.py exactly.
describe("resolveSkillDirs size caps (untrusted wire)", () => {
  it("rejects an over-cap body (SDK: body <= 50_000)", () => {
    const logs: string[] = [];
    const out = materialize(
      [
        { ...SKILL, name: "too-big", body: "x".repeat(50_001) },
        SKILL, // a valid one survives alongside the rejected one
      ],
      (m: string) => logs.push(m),
    );
    assert.deepEqual(
      out.map((s) => s.name),
      ["release-notes"],
    );
    assert.equal(logs.filter((m) => /exceeds the wire cap/.test(m)).length, 1);
  });

  it("accepts a body exactly at the cap (boundary is inclusive, like pydantic max_length)", () => {
    const out = materialize([
      { ...SKILL, name: "at-cap", body: "x".repeat(50_000) },
    ]);
    assert.deepEqual(
      out.map((s) => s.name),
      ["at-cap"],
    );
  });

  it("rejects an over-cap description (SDK: description <= 1024)", () => {
    const logs: string[] = [];
    const out = materialize(
      [{ ...SKILL, description: "d".repeat(1025) }],
      (m: string) => logs.push(m),
    );
    assert.deepEqual(out, []);
    assert.equal(logs.filter((m) => /exceeds the wire cap/.test(m)).length, 1);
  });

  it("skips an over-cap bundled file but keeps the skill and its in-cap files (SDK: content <= 200_000)", () => {
    const logs: string[] = [];
    const [skill] = materialize(
      [
        {
          ...SKILL,
          files: [
            { path: "huge.txt", content: "y".repeat(200_001) },
            { path: "ok.txt", content: "ok" },
          ],
        },
      ],
      (m: string) => logs.push(m),
    );
    assert.equal(existsSync(join(skill.dir, "huge.txt")), false);
    assert.equal(readFileSync(join(skill.dir, "ok.txt"), "utf-8"), "ok");
    assert.equal(logs.filter((m) => /oversized skill file/.test(m)).length, 1);
  });

  it("rejects an over-cap bundled file path (SDK: path <= 255)", () => {
    const logs: string[] = [];
    const [skill] = materialize(
      [{ ...SKILL, files: [{ path: `${"p".repeat(256)}.txt`, content: "x" }] }],
      (m: string) => logs.push(m),
    );
    // Rejected through the existing unsafe-path gate, so the skill still materializes.
    assert.equal(skill.name, "release-notes");
    assert.equal(logs.filter((m) => /unsafe skill file/.test(m)).length, 1);
  });
});

// RUN-SKILL-CAP-2: pydantic's `max_length` counts Unicode CODE POINTS (Python `len(str)`), not
// UTF-16 code units. An astral character (e.g. an emoji) is 1 code point but 2 JS `.length` units,
// so a naive `.length` cap rejects wire content the SDK would accept. 😀 (U+1F600) is one such
// astral code point, used here to build exact code-point-boundary fixtures.
describe("resolveSkillDirs size caps count CODE POINTS, not UTF-16 units", () => {
  it("accepts a body within the cap by code points despite exceeding it by UTF-16 units (emoji-heavy)", () => {
    // 50_000 emoji = 50_000 code points (at the cap) but 100_000 UTF-16 units (over a naive cap).
    const body = "\u{1F600}".repeat(50_000);
    assert.equal([...body].length, 50_000);
    assert.equal(body.length, 100_000);
    const out = materialize([{ ...SKILL, name: "emoji-body", body }]);
    assert.deepEqual(
      out.map((s) => s.name),
      ["emoji-body"],
    );
  });

  it("rejects a body genuinely over the cap by code points (one emoji past it)", () => {
    const logs: string[] = [];
    const body = "\u{1F600}".repeat(50_001);
    assert.equal([...body].length, 50_001);
    const out = materialize(
      [{ ...SKILL, name: "emoji-body-over", body }],
      (m: string) => logs.push(m),
    );
    assert.deepEqual(out, []);
    assert.equal(logs.filter((m) => /exceeds the wire cap/.test(m)).length, 1);
  });

  it("accepts a description within the cap by code points (emoji-heavy)", () => {
    const description = "\u{1F600}".repeat(1024);
    assert.equal([...description].length, 1024);
    assert.equal(description.length, 2048);
    const out = materialize([{ ...SKILL, description }]);
    assert.deepEqual(
      out.map((s) => s.name),
      ["release-notes"],
    );
  });

  it("rejects a bundled file's content within the UTF-16 count but over the code-point cap boundary, and accepts one at the exact code-point cap", () => {
    const logs: string[] = [];
    const atCap = "\u{1F600}".repeat(200_000); // 200_000 code points, 400_000 UTF-16 units
    const overCap = "\u{1F600}".repeat(200_001);
    const [skill] = materialize(
      [
        {
          ...SKILL,
          files: [
            { path: "at-cap.txt", content: atCap },
            { path: "over-cap.txt", content: overCap },
          ],
        },
      ],
      (m: string) => logs.push(m),
    );
    assert.equal(readFileSync(join(skill.dir, "at-cap.txt"), "utf-8"), atCap);
    assert.equal(existsSync(join(skill.dir, "over-cap.txt")), false);
    assert.equal(logs.filter((m) => /oversized skill file/.test(m)).length, 1);
  });
});
