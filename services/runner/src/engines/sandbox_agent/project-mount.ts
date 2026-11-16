/**
 * Project drives: drives of the project that an agent's configuration lists by slug. Each one
 * mounts beside the session folder at `<cwd>-project-<slug>` and is linked into it as
 * `drives/<slug>`, the way the agent drive is linked as `agent-files` (`agent-mount.ts`).
 */

import { lstat, mkdir } from "node:fs/promises";
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

function linkFailed(log: (msg: string) => void, slug: string, detail: string): false {
  log(`${detail}`);
  log(`mount degraded kind=project_mount cause=link_failed slug=${slug}`);
  return false;
}

/**
 * Point `<cwd>/drives/<slug>` at the project drive's mount. Re-run on every turn: the link lives
 * on the session folder, where geesefs turns a symlink into an empty file across a remount.
 *
 * A real folder at the link path holds what was written there while the link was missing. It is
 * never deleted or moved (it may not fit a read-only drive): the link fails, and the drive is not
 * available until a person clears the folder.
 */
export async function linkProjectDrive(
  cwd: string,
  slug: string,
  mountPath: string,
  deps: EnsureDurableSymlinkDeps & { mkdir?: typeof mkdir } = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const label = projectDriveLinkName(slug);
  const linkPath = join(cwd, label);
  try {
    await (deps.mkdir ?? mkdir)(join(cwd, PROJECT_DRIVES_DIR_NAME), {
      recursive: true,
    });
    const existing = await (deps.lstat ?? lstat)(linkPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined;
      throw err;
    });
    if (existing?.isDirectory()) {
      return linkFailed(log, slug, `${label} is a folder in ${cwd}; not replaced`);
    }
  } catch (err) {
    return linkFailed(
      log,
      slug,
      `${label} check failed in ${cwd}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
  const outcome = await ensureDurableSymlink(linkPath, mountPath, label, {
    ...deps,
    log,
  });
  return outcome === "failed" ? linkFailed(log, slug, `${label} link failed in ${cwd}`) : true;
}

/** Same link, made inside a remote sandbox, with the same rule for a folder at the link path. */
export async function linkProjectDriveRemote(
  sandbox: SandboxExec,
  cwd: string,
  slug: string,
  mountPath: string,
  deps: { log?: (msg: string) => void } = {},
): Promise<boolean> {
  const log = deps.log ?? defaultLog;
  const dir = join(cwd, PROJECT_DRIVES_DIR_NAME);
  const linkPath = join(cwd, projectDriveLinkName(slug));
  const link = shellQuote(linkPath);
  try {
    const res = await sandbox.runProcess({
      command: "sh",
      args: [
        "-c",
        `mkdir -p ${shellQuote(dir)} && { [ "$(readlink ${link} 2>/dev/null)" = ${shellQuote(mountPath)} ] || { { [ ! -d ${link} ] || [ -L ${link} ]; } && rm -f ${link} && ln -s ${shellQuote(mountPath)} ${link}; }; }`,
      ],
      timeoutMs: 30_000,
    });
    if (res?.exitCode !== 0) {
      return linkFailed(log, slug, `remote ${projectDriveLinkName(slug)} link failed ${linkPath}: exit ${res?.exitCode}`);
    }
    return true;
  } catch (err) {
    return linkFailed(
      log,
      slug,
      `remote ${projectDriveLinkName(slug)} link failed ${linkPath}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}
