/**
 * Project drives: drives of the project that an agent's configuration lists by slug. Each one
 * mounts beside the session folder at `<cwd>-project-<slug>` and is linked into it as
 * `drives/<slug>`, the way the agent drive is linked as `agent-files` (`agent-mount.ts`).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { DriveAccess } from "../../protocol.ts";
import { signMountCredentialsAt } from "./agent-mount.ts";
import {
  ensureDurableSymlink,
  type EnsureDurableSymlinkDeps,
} from "./durable-symlink.ts";
import {
  shellQuote,
  type MountCredentials,
  type SandboxExec,
  type SignMountDeps,
} from "./mount.ts";

/** The folder in the session folder that holds one link per project drive. */
export const PROJECT_DRIVES_DIR_NAME = "drives";

function defaultLog(msg: string): void {
  process.stderr.write(`[sandbox_agent/project-mount] ${msg}\n`);
}

export function projectMountPath(cwd: string, slug: string): string {
  return `${cwd}-project-${slug}`;
}

/** The link's path relative to the session folder: `drives/<slug>`. */
export function projectDriveLinkName(slug: string): string {
  return `${PROJECT_DRIVES_DIR_NAME}/${slug}`;
}

/**
 * Sign a project drive. Returns null when the drive is missing, archived, or the API has no such
 * route yet (404), or the call fails: the run then goes on without that drive.
 */
export async function signProjectMountCredentials(
  slug: string,
  access: DriveAccess,
  deps: SignMountDeps,
): Promise<MountCredentials | null> {
  return signMountCredentialsAt(
    `${deps.apiBase}/mounts/projects/sign?slug=${encodeURIComponent(slug)}&access=${encodeURIComponent(access)}`,
    `slug=${slug} access=${access}`,
    deps,
  );
}

/**
 * Point `<cwd>/drives/<slug>` at the project drive's mount. Re-run on every turn: the link lives
 * on the session folder, where geesefs turns a symlink into an empty file across a remount.
 */
export async function linkProjectDrive(
  cwd: string,
  slug: string,
  mountPath: string,
  deps: EnsureDurableSymlinkDeps & { mkdir?: typeof mkdir } = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  try {
    await (deps.mkdir ?? mkdir)(join(cwd, PROJECT_DRIVES_DIR_NAME), {
      recursive: true,
    });
  } catch (err) {
    log(
      `${PROJECT_DRIVES_DIR_NAME} folder failed in ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return false;
  }
  const label = projectDriveLinkName(slug);
  const outcome = await ensureDurableSymlink(join(cwd, label), mountPath, label, {
    ...deps,
    log,
  });
  return outcome !== "failed";
}

/** Same link, made inside a remote sandbox. */
export async function linkProjectDriveRemote(
  sandbox: SandboxExec,
  cwd: string,
  slug: string,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<void> {
  const log = deps.log ?? defaultLog;
  const dir = join(cwd, PROJECT_DRIVES_DIR_NAME);
  const linkPath = join(cwd, projectDriveLinkName(slug));
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `mkdir -p ${shellQuote(dir)} && { [ "$(readlink ${shellQuote(linkPath)} 2>/dev/null)" = ${shellQuote(mountPath)} ] || { rm -f ${shellQuote(linkPath)} && ln -s ${shellQuote(mountPath)} ${shellQuote(linkPath)}; }; }`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) {
      log(`remote ${projectDriveLinkName(slug)} link failed ${linkPath}: exit ${res?.exitCode}`);
    }
  } catch (err) {
    log(
      `remote ${projectDriveLinkName(slug)} link failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}
