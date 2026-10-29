/**
 * How long a hosted subscription login stays in the runner's state dir.
 *
 * A run on a runner-host sandbox (`local`, `inprocess`) keeps its connection's ChatGPT login in
 * `<state dir>/subscriptions/<connection id>/`, where Pi rotates it. The API holds the login of
 * record (every rotation is published back to it) and delivers it with every run, so a local copy
 * nobody used for a week is only a credential lying on a volume: it is deleted. A connection that
 * was deleted is never used again, so its copy goes the same way. A copy a session holds is never
 * deleted, however old.
 *
 * "Used" is the newest modification time of the folder and its files: a run touches the folder
 * when it starts and ends with it, and Pi rewrites `auth.json` when it refreshes.
 */
import { readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";

type Log = (message: string) => void;

/** A login no run used for this long is deleted. */
export const SUBSCRIPTION_LOGIN_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

const held = new Map<string, number>();

function touch(home: string): void {
  try {
    const now = new Date();
    utimesSync(home, now, now);
  } catch {
    // Not there (yet): nothing to keep fresh.
  }
}

/** Mark `home` in use until the returned release is called; it is never deleted meanwhile. */
export function holdSubscriptionHome(home: string): () => void {
  held.set(home, (held.get(home) ?? 0) + 1);
  touch(home);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (held.get(home) ?? 1) - 1;
    if (count > 0) held.set(home, count);
    else held.delete(home);
    touch(home);
  };
}

function lastUsed(home: string): number {
  let newest = statSync(home).mtimeMs;
  for (const name of readdirSync(home)) {
    try {
      newest = Math.max(newest, statSync(join(home, name)).mtimeMs);
    } catch {
      // Gone meanwhile.
    }
  }
  return newest;
}

/** Delete the logins under `root` that no session holds and no run used for `maxIdleMs`. Returns the deleted folders. */
export function sweepSubscriptionHomes(root: string, options: { now?: number; maxIdleMs?: number; log?: Log } = {}): string[] {
  const now = options.now ?? Date.now();
  const maxIdleMs = options.maxIdleMs ?? SUBSCRIPTION_LOGIN_MAX_IDLE_MS;
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const name of names) {
    const home = join(root, name);
    try {
      if (held.has(home) || now - lastUsed(home) < maxIdleMs) continue;
      rmSync(home, { recursive: true, force: true });
      deleted.push(home);
    } catch (err) {
      options.log?.(`[subscription-login] old login not deleted connection=${name}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
    }
  }
  if (deleted.length) options.log?.(`[subscription-login] deleted ${deleted.length} login(s) unused for ${Math.round(maxIdleMs / 86_400_000)} days`);
  return deleted;
}

/** Sweep `root` now and every few hours; returns the stop. */
export function startSubscriptionHomeSweeper(root: string, log: Log): () => void {
  sweepSubscriptionHomes(root, { log });
  const timer = setInterval(() => sweepSubscriptionHomes(root, { log }), SWEEP_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
