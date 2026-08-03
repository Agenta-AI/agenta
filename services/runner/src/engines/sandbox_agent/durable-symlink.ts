/**
 * One implementation of the "keep this path a symlink to this target" hazard on the durable cwd.
 *
 * The session working directory is a geesefs FUSE mount over object storage whenever the object
 * store is configured (the default self-hosted setup), and object storage has no symlinks. An
 * entry written as a symlink comes back from a flush/remount round trip as an ordinary EMPTY
 * FILE, so "does the path exist?" is not a usable guard: the degraded entry exists and is
 * useless, and a run that trusts it reads an empty file forever.
 *
 * Every link materialized into the durable cwd goes through this helper. It inspects the entry
 * with `lstat`, keeps ONLY a symlink whose `readlink` already equals the wanted target — including
 * a dangling one, because the target may sit behind a mount that is not up yet — and replaces
 * anything else, which self-heals a working directory that already holds a degraded entry.
 *
 * It never throws: a link that cannot be established is logged, and the caller's own failure path
 * takes it from there.
 */

import { lstat, readlink, symlink, unlink } from "node:fs/promises";

export interface EnsureDurableSymlinkDeps {
  lstat?: typeof lstat;
  readlink?: typeof readlink;
  symlink?: typeof symlink;
  unlink?: typeof unlink;
  log?: (msg: string) => void;
}

/**
 * `kept` — a correct symlink was already in place; `linked` — the link was created or a degraded
 * entry was replaced; `failed` — the path could not be inspected or linked (already logged).
 */
export type EnsureDurableSymlinkOutcome = "kept" | "linked" | "failed";

function detail(err: unknown): string {
  return String(err instanceof Error ? err.message : err).slice(0, 200);
}

/**
 * Ensure `linkPath` is a symlink to `target`, replacing a degraded, wrong-target, or non-symlink
 * entry. `label` names the link in log lines (e.g. `agent-files`).
 */
export async function ensureDurableSymlink(
  linkPath: string,
  target: string,
  label: string,
  deps: EnsureDurableSymlinkDeps = {},
): Promise<EnsureDurableSymlinkOutcome> {
  const log = deps.log ?? (() => {});
  const inspect = deps.lstat ?? lstat;
  const readLink = deps.readlink ?? readlink;
  const createLink = deps.symlink ?? symlink;
  const removeLink = deps.unlink ?? unlink;
  let replaceExisting = false;
  let unlinkFailed = false;
  try {
    const stats = await inspect(linkPath);
    if (stats.isSymbolicLink() && (await readLink(linkPath)) === target) {
      return "kept";
    }
    replaceExisting = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log(`${label} check failed ${linkPath}: ${detail(err)}`);
      return "failed";
    }
  }
  if (replaceExisting) {
    try {
      await removeLink(linkPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log(`${label} unlink failed ${linkPath}: ${detail(err)}`);
        unlinkFailed = true;
      }
    }
  }
  try {
    await createLink(target, linkPath);
  } catch (err) {
    // EEXIST after a clean (or unnecessary) unlink means a concurrent creator won the race: the
    // link is there, which is all this promised. EEXIST after a FAILED unlink means something
    // else entirely — the degraded entry this call exists to replace is still sitting on the
    // path (a transient EBUSY/EACCES/EIO on the FUSE mount), so reporting success would leave
    // the caller believing a 0-byte auth.json had been repaired when it had not.
    if ((err as NodeJS.ErrnoException).code === "EEXIST" && !unlinkFailed) {
      return "linked";
    }
    log(`${label} link failed ${linkPath}: ${detail(err)}`);
    return "failed";
  }
  return "linked";
}
