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
 * "Anything else" includes a real DIRECTORY, which is the shape this path takes most often in
 * practice. Delete the link mid-turn and the harness's very next write recreates it as a
 * directory, because that is what an ordinary `mkdir -p` of the parent does. `unlink(2)` never
 * removes a directory, so the repair failed on every later turn and every file the agent believed
 * it was writing to its durable drive landed in the session workspace instead. A caller that
 * knows what the directory holds supplies `recoverDirectory` to rescue the contents first.
 *
 * It never throws: a link that cannot be established is logged, and the caller's own failure path
 * takes it from there.
 */

import { lstat, readlink, rmdir, symlink, unlink } from "node:fs/promises";

export interface EnsureDurableSymlinkDeps {
  lstat?: typeof lstat;
  readlink?: typeof readlink;
  symlink?: typeof symlink;
  unlink?: typeof unlink;
  rmdir?: typeof rmdir;
  /**
   * Empty the directory sitting on the link path, moving whatever it holds somewhere the user can
   * still reach it, so that the directory can then be removed and the link restored.
   *
   * Without it a NON-empty directory is left exactly where it is and the call reports `failed`:
   * the link matters, but not enough to delete files someone's agent wrote. Throwing has the same
   * effect, which is the right answer when the rescue destination is itself unavailable.
   */
  recoverDirectory?: (linkPath: string, target: string) => Promise<void>;
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
  const removeDirectory = deps.rmdir ?? rmdir;
  let replaceExisting = false;
  let replaceDirectory = false;
  let unlinkFailed = false;
  try {
    const stats = await inspect(linkPath);
    if (stats.isSymbolicLink() && (await readLink(linkPath)) === target) {
      return "kept";
    }
    replaceExisting = true;
    replaceDirectory = stats.isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log(`${label} check failed ${linkPath}: ${detail(err)}`);
      return "failed";
    }
  }
  if (replaceExisting && replaceDirectory) {
    // Rescue first, remove second, and let either failure abort both. `rmdir` only ever succeeds
    // on an empty directory, so a rescue that silently dropped an entry could not go on to delete
    // the rest: the removal fails and the files stay put.
    try {
      if (deps.recoverDirectory) await deps.recoverDirectory(linkPath, target);
      await removeDirectory(linkPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log(`${label} directory replace failed ${linkPath}: ${detail(err)}`);
        unlinkFailed = true;
      }
    }
  } else if (replaceExisting) {
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
    // A concurrent creator may have won the path. Accept it only when it is the right link.
    if ((err as NodeJS.ErrnoException).code === "EEXIST" && !unlinkFailed) {
      try {
        const stats = await inspect(linkPath);
        if (stats.isSymbolicLink() && (await readLink(linkPath)) === target) {
          return "linked";
        }
      } catch {
        // The entry changed again. Report failure so the caller can retry next turn.
      }
    }
    log(`${label} link failed ${linkPath}: ${detail(err)}`);
    return "failed";
  }
  return "linked";
}
