/**
 * Skill materialization for the sandbox-agent engine.
 *
 * A skill rides the `/run` wire as a resolved inline package (`WireSkill`): the SKILL.md
 * frontmatter fields (`name`/`description`), a Markdown `body`, and optional bundled `files`.
 * References to skills that live elsewhere were inlined server-side (via `@ag.embed`) before
 * the request reached us, so there is exactly one shape here and no name-against-a-bundled-root
 * resolution. For each skill we write a fresh directory under a per-run temp root, compose its
 * `SKILL.md`, and lay each bundled file at its (re-validated) relative path. The resulting
 * `{ name, dir }` pairs flow through the install path:
 *
 *  - the sandbox-agent engine (`engines/sandbox_agent.ts`) lays the dirs into the Pi agent dir's
 *    `skills/` (user scope), where Pi auto-discovers them on every run.
 *
 * Executable bundled files default to OFF. A file is `chmod +x`-ed only when the skill sets
 * `allowExecutableFiles`, the file sets `executable`, AND the policy passed in allows it. The
 * caller owns the policy decision (sandbox/harness), so this helper defaults to deny.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { WireSkill } from "../protocol.ts";

/** A materialized skill: the on-disk directory the install paths consume. */
export interface MaterializedSkill {
  name: string;
  dir: string;
}

/**
 * The output of materialization: the `{ name, dir }` pairs plus a `cleanup()` that removes the
 * per-run temp root they live under. An engine calls `cleanup()` in its `finally` (success or
 * error) so the temp root never leaks. `cleanup()` is a no-op when no skills materialized.
 */
export interface MaterializedSkills {
  skills: MaterializedSkill[];
  cleanup: () => void;
}

export type SkillExecPolicy = "allow" | "deny";

// The wire is an untrusted boundary (a non-SDK client can POST anything), so the runner
// re-validates `skill.name` against the same safe pattern the SDK enforces before joining it to
// a filesystem path. Without this a name like `../x` or `/etc` would escape the per-run root.
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;

function isSafeSkillName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= SKILL_NAME_MAX &&
    SKILL_NAME_RE.test(name)
  );
}

// Same reasoning as the name check above: pydantic (SkillTemplate/SkillFile in
// sdks/python/agenta/sdk/agents/skills/models.py) enforces these caps, but the wire is untrusted
// so a non-SDK client can POST past them. Mirror the SDK's exact values so the two sides cannot
// drift.
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_BODY_MAX = 50_000;
const SKILL_FILE_PATH_MAX = 255;
const SKILL_FILE_CONTENT_MAX = 200_000;

/** True when `skill.description`/`skill.body` are within the SDK's pydantic caps. */
function isSafeSkillSize(skill: WireSkill): boolean {
  return (
    typeof skill.description === "string" &&
    skill.description.length <= SKILL_DESCRIPTION_MAX &&
    typeof skill.body === "string" &&
    skill.body.length <= SKILL_BODY_MAX
  );
}

/**
 * A bundled-file path is safe when it stays under the skill dir (no absolute, no `..` escape) and
 * does not resolve to the skill's own `SKILL.md` at the dir root, which would clobber the
 * frontmatter the runner just composed. The `SKILL.md` check is case-insensitive.
 */
function safeSkillFilePath(skillDir: string, relPath: unknown): string | null {
  if (
    typeof relPath !== "string" ||
    !relPath ||
    relPath.length > SKILL_FILE_PATH_MAX ||
    relPath.startsWith("/") ||
    relPath.startsWith("\\")
  )
    return null;
  const target = resolve(skillDir, relPath);
  const rel = relative(skillDir, target);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(`..${sep}`))
    return null;
  // A bundled file that lands on the composed SKILL.md at the dir root would overwrite it.
  if (rel.toLowerCase() === "skill.md") return null;
  return target;
}

/** YAML-quote a scalar so author text (`:` `#` `"` newlines, ...) cannot break the frontmatter. */
function yamlScalar(value: string): string {
  // JSON string syntax is a valid YAML double-quoted flow scalar, so JSON-encoding both escapes
  // the special characters and wraps the value in quotes in one step.
  return JSON.stringify(value);
}

/** Compose the SKILL.md text: YAML frontmatter built from name/description, then the body. */
function composeSkillMd(skill: WireSkill): string {
  const description = skill.description.replace(/\n/g, " ").trim();
  const frontmatter = [
    "---",
    `name: ${yamlScalar(skill.name)}`,
    `description: ${yamlScalar(description)}`,
    ...(skill.disableModelInvocation ? ["disable-model-invocation: true"] : []),
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${skill.body}\n`;
}

/**
 * Materialize each resolved inline skill into a fresh directory under a per-run temp root and
 * return the `{ name, dir }` pairs plus a `cleanup()` that removes that root (the caller runs it
 * in a `finally` so the root never leaks). `execPolicy` gates whether an executable bundled file
 * is actually `chmod +x`-ed; it defaults to `"deny"` so a caller must opt in. `log` defaults to a
 * no-op so callers without a logger stay quiet.
 *
 * A skill whose wire-supplied `name` is not a safe slug is rejected (the wire is untrusted), and
 * a file that cannot be written safely is skipped with a warning rather than failing the run.
 */
export function resolveSkillDirs(
  skills: WireSkill[] | undefined,
  log: (message: string) => void = () => {},
  execPolicy: SkillExecPolicy = "deny",
): MaterializedSkills {
  if (!skills || skills.length === 0) return { skills: [], cleanup: () => {} };

  const root = mkdtempSync(join(tmpdir(), "agenta-skills-"));
  const cleanup = () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of the throwaway per-run skills root
    }
  };
  const out: MaterializedSkill[] = [];
  const seenNames = new Set<string>();

  for (const skill of skills) {
    if (!isSafeSkillName(skill?.name)) {
      log(`skipping skill with unsafe name ${JSON.stringify(skill?.name)}`);
      continue;
    }
    if (!isSafeSkillSize(skill)) {
      log(
        `skipping skill "${skill.name}": description/body exceeds the wire cap ` +
          `(description<=${SKILL_DESCRIPTION_MAX}, body<=${SKILL_BODY_MAX})`,
      );
      continue;
    }
    // `dir` is keyed only by `skill.name`; a duplicate would overwrite the earlier skill's
    // SKILL.md while leaving its bundled files behind, so skip the later entry.
    if (seenNames.has(skill.name)) {
      log(`skipping duplicate skill "${skill.name}"`);
      continue;
    }
    seenNames.add(skill.name);
    try {
      const dir = join(root, skill.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), composeSkillMd(skill));

      for (const file of skill.files ?? []) {
        const target = safeSkillFilePath(dir, file?.path);
        if (!target) {
          log(
            `skipping unsafe skill file ${JSON.stringify(file?.path)} in skill "${skill.name}"`,
          );
          continue;
        }
        if ((file.content ?? "").length > SKILL_FILE_CONTENT_MAX) {
          log(
            `skipping oversized skill file ${JSON.stringify(file.path)} in skill "${skill.name}" ` +
              `(content<=${SKILL_FILE_CONTENT_MAX})`,
          );
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content ?? "");
        const allowExec =
          skill.allowExecutableFiles === true && execPolicy === "allow";
        if (file.executable && allowExec) {
          chmodSync(target, 0o755);
        } else if (file.executable) {
          log(
            `skill "${skill.name}" file "${file.path}" not made executable ` +
              `(allowExecutableFiles=${!!skill.allowExecutableFiles}, policy=${execPolicy})`,
          );
        }
      }

      out.push({ name: skill.name, dir });
    } catch (err) {
      log(`skipping skill "${skill.name}": ${(err as Error).message}`);
    }
  }

  return { skills: out, cleanup };
}
