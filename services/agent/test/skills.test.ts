/**
 * Unit tests for bundled-skill resolution (`engines/skills.ts`), the shared helper both
 * engines use to turn the Agenta harness's forced skill *names* into directories on disk.
 *
 * No harness, no network: just disk resolution against a temp SKILLS_ROOT and absolute paths.
 *
 * Run: pnpm exec tsx test/skills.test.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway skills root with one real skill dir and one bare file (not a skill dir).
const root = mkdtempSync(join(tmpdir(), "agenta-skills-test-"));
mkdirSync(join(root, "alpha"));
writeFileSync(join(root, "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
writeFileSync(join(root, "loose.md"), "not a dir");

// skills.ts reads AGENTA_AGENT_SKILLS_DIR at import time, so set it before importing.
process.env.AGENTA_AGENT_SKILLS_DIR = root;
const { resolveSkillDirs, SKILLS_ROOT } = await import("../src/engines/skills.ts");

// --- SKILLS_ROOT honors the override ----------------------------------------
{
  assert.equal(SKILLS_ROOT, root, "SKILLS_ROOT reads AGENTA_AGENT_SKILLS_DIR");
}

// --- resolves a known name to its directory under the root ------------------
{
  assert.deepEqual(resolveSkillDirs(["alpha"]), [join(root, "alpha")]);
}

// --- skips unknown names and non-directories, logging each ------------------
{
  const logs: string[] = [];
  assert.deepEqual(resolveSkillDirs(["nope", "loose.md"], (m) => logs.push(m)), []);
  assert.equal(logs.length, 2, "one log line per skipped entry");
  assert.ok(
    logs.every((m) => /skipping/.test(m)),
    "skips are surfaced through the logger",
  );
}

// --- honors absolute paths as-is (the in-process loader path) ---------------
{
  assert.deepEqual(resolveSkillDirs([join(root, "alpha")]), [join(root, "alpha")]);
}

// --- empty / undefined input is a no-op -------------------------------------
{
  assert.deepEqual(resolveSkillDirs(undefined), []);
  assert.deepEqual(resolveSkillDirs([]), []);
  assert.deepEqual(resolveSkillDirs([""]), [], "blank names are dropped");
}

// --- the default logger is a silent no-op (no throw without a logger) -------
{
  assert.deepEqual(resolveSkillDirs(["nope"]), [], "missing skill is skipped, not thrown");
}

rmSync(root, { recursive: true, force: true });
console.log("skills.test.ts: ok");
