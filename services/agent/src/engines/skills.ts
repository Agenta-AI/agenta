/**
 * Bundled-skill resolution, shared by both engines.
 *
 * The Agenta harness ships a fixed set of skills (see the SDK's `agenta_builtins`). They
 * cannot ride the `/run` wire as text because each skill is a directory that may reference
 * relative scripts and assets, so the wire carries only the skill *names* and each engine
 * resolves them here against the runner's bundled `skills/` root:
 *
 *  - the in-process Pi engine (`engines/pi.ts`) feeds the resolved dirs to Pi's resource
 *    loader as `additionalSkillPaths`;
 *  - the rivet engine (`engines/rivet.ts`) lays the resolved dirs into the Pi agent dir's
 *    `skills/` (user scope), where Pi auto-discovers them on every run.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// services/agent/src/engines/skills.ts -> services/agent. Bundled skills (the Agenta
// harness's forced skills) live under services/agent/skills/<name>/. Overridable for
// non-default layouts (e.g. a relocated sidecar).
const PKG_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const SKILLS_ROOT = process.env.AGENTA_AGENT_SKILLS_DIR || join(PKG_ROOT, "skills");

/**
 * Resolve the requested skill names to bundled skill directories under SKILLS_ROOT. Each name
 * must be a committed dir holding a SKILL.md (Pi loads it and surfaces it in the system
 * prompt). Absolute paths are honored as-is; unknown or non-directory entries are skipped with
 * a warning so a stale name never fails the run. `log` defaults to a no-op so callers without a
 * logger stay quiet.
 */
export function resolveSkillDirs(
  names: string[] | undefined,
  log: (message: string) => void = () => {},
): string[] {
  const dirs: string[] = [];
  for (const name of names ?? []) {
    if (!name) continue;
    const path = isAbsolute(name) ? name : join(SKILLS_ROOT, name);
    try {
      if (existsSync(path) && statSync(path).isDirectory()) {
        dirs.push(path);
      } else {
        log(`skipping unknown skill "${name}" (no directory at ${path})`);
      }
    } catch {
      log(`skipping skill "${name}": cannot stat ${path}`);
    }
  }
  return dirs;
}
