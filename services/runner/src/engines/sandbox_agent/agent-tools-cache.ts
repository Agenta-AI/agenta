/**
 * A per-agent cache of `agent-files/.tools/bin/` on the runner's local disk (local provider only).
 *
 * Without it, every cold start re-reads every binary from the geesefs mount (one real agent keeps
 * 103 MB there). With it, the restore stats the durable folder (name, size, mtime of each file; no
 * content read) and, when that fingerprint names a cached entry, the restore script copies the
 * binaries from local disk instead. A changed fingerprint names a new entry, so the rule in
 * `agent-tools-setup.ts` still holds: a binary removed from the durable folder never reaches a
 * session.
 *
 * Layout, under the runner's tmpdir like `agentToolsLocalDir`:
 *
 *   agenta-tools-cache/                 0700, must be a real directory this uid owns
 *     <agent key>/                      0700, sha256(project id, agent artifact id)
 *       bin-<fingerprint>/bin/<file>    one complete entry, published by an atomic rename
 *       .tmp-XXXXXX/                    an entry being filled; never read
 *
 * The runner itself copies no binary. On a miss, the restore script (which already has the
 * restore's timeout and Stop handling) copies the freshly staged session `bin/` into a temp dir
 * and writes a completion marker. The runner publishes that temp dir after the script, only when
 * the marker is there and the durable folder did not change meanwhile.
 *
 * Concurrency: two sessions of the same agent that miss at once both fill; the first rename wins
 * and the second discards its copy. An entry is removed only after nobody used it for
 * `AGENT_TOOLS_CACHE_ENTRY_GRACE_MS`, much longer than a restore can run, so a session never
 * loses the entry it copies from.
 *
 * Nothing here throws to the caller: any error means "no cache" and the restore runs as before.
 */

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** An entry (or a leftover temp dir) unused for this long is removed when another is published. */
export const AGENT_TOOLS_CACHE_ENTRY_GRACE_MS = 30 * 60 * 1000;
/** An agent dir unused for this long is removed when another agent publishes an entry. */
const AGENT_TOOLS_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** The file the restore script writes into a temp dir once the fill is complete. */
export const AGENT_TOOLS_CACHE_COMPLETE = "complete";

export interface AgentToolsCache {
  /** `<tmpdir>/agenta-tools-cache`. */
  root: string;
  /** The per-agent directory name under `root`. */
  key: string;
}

/** The cache for one agent, or undefined when the run lacks a project or an agent identity. */
export function agentToolsCacheFor(
  projectId: string | undefined,
  agentId: string | undefined,
  base: string = tmpdir(),
): AgentToolsCache | undefined {
  const project = projectId?.trim();
  const agent = agentId?.trim();
  if (!project || !agent) return undefined;
  const key = createHash("sha256")
    .update(`${project}\0${agent}`)
    .digest("hex")
    .slice(0, 32);
  return { root: join(base, "agenta-tools-cache"), key };
}

/**
 * Stat-only fingerprint of a durable `bin/`: the regular files the restore loop would copy (the
 * shell glob `bin/*` skips dot files), by name, size and mtime. Undefined when `bin/` is absent.
 */
async function fingerprintToolsBin(
  binDir: string,
): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(binDir);
  } catch {
    return undefined;
  }
  const rows: string[] = [];
  for (const name of names.sort()) {
    if (name.startsWith(".")) continue;
    const st = await stat(join(binDir, name)).catch(() => undefined);
    if (!st?.isFile()) continue;
    rows.push(`${name}\0${st.size}\0${Math.trunc(st.mtimeMs)}`);
  }
  return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 32);
}

/** Create `dir` 0700, or accept it only if it is a real directory this uid owns, then force 0700. */
async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid))
    throw new Error(`refusing cache dir not owned by this process: ${dir}`);
  if ((st.mode & 0o777) !== 0o700) await chmod(dir, 0o700);
}

async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now).catch(() => {});
}

/** Remove `dir`'s entries matching `pick` that nobody touched for `maxAgeMs`. */
async function removeUnused(
  dir: string,
  pick: (name: string) => boolean,
  maxAgeMs: number,
  now: number,
): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!pick(name)) continue;
    const st = await lstat(join(dir, name)).catch(() => undefined);
    if (st?.isDirectory() && now - st.mtimeMs > maxAgeMs)
      await rm(join(dir, name), { recursive: true, force: true }).catch(
        () => {},
      );
  }
}

/**
 * Remove the agent's other entries and temp dirs nobody used within the grace, and other agents'
 * dirs nobody used for `AGENT_TOOLS_CACHE_MAX_AGE_MS`.
 */
async function pruneAgentToolsCache(
  cache: AgentToolsCache,
  keep: string,
  now: number = Date.now(),
): Promise<void> {
  await removeUnused(
    join(cache.root, cache.key),
    (name) => name !== keep,
    AGENT_TOOLS_CACHE_ENTRY_GRACE_MS,
    now,
  );
  await removeUnused(
    cache.root,
    (name) => name !== cache.key,
    AGENT_TOOLS_CACHE_MAX_AGE_MS,
    now,
  );
}

/** What the restore script does with the cache for one session. */
export type AgentToolsCachePlan =
  | { kind: "none" }
  /** Copy `bin/` from this local entry instead of the durable folder. */
  | { kind: "hit"; binDir: string }
  /** Copy from the durable folder, then fill `fillDir`; call `commit` after the script. */
  | { kind: "miss"; fillDir: string; commit: () => Promise<void> };

/**
 * Look up the cache entry for the durable `bin/` under `toolsDir`. A hit returns the entry to copy
 * from. A miss returns a private temp dir for the restore script to fill, and a `commit` that
 * publishes it (or throws it away when the fill did not complete or the folder changed).
 */
export async function planToolsCache(
  toolsDir: string,
  cache: AgentToolsCache,
  log: (msg: string) => void = () => {},
): Promise<AgentToolsCachePlan> {
  const binDir = join(toolsDir, "bin");
  try {
    const fingerprint = await fingerprintToolsBin(binDir);
    if (!fingerprint) return { kind: "none" };
    await ensurePrivateDir(cache.root);
    const agentDir = join(cache.root, cache.key);
    await ensurePrivateDir(agentDir);
    const name = `bin-${fingerprint}`;
    const entry = join(agentDir, name);
    if ((await stat(join(entry, "bin")).catch(() => undefined))?.isDirectory()) {
      await touch(entry);
      await touch(agentDir);
      log(`agent tools bin cache hit`);
      return { kind: "hit", binDir: join(entry, "bin") };
    }
    const tmp = await mkdtemp(join(agentDir, ".tmp-"));
    const commit = async () => {
      try {
        const complete = await stat(join(tmp, AGENT_TOOLS_CACHE_COMPLETE)).catch(
          () => undefined,
        );
        // The owner may have written the folder during the restore; never publish a mix.
        if (!complete || (await fingerprintToolsBin(binDir)) !== fingerprint) {
          log(`agent tools bin cache not filled: copy incomplete or bin/ changed`);
          return;
        }
        await rename(tmp, entry).catch((err: NodeJS.ErrnoException) => {
          // Another session published the same entry first; its copy is equivalent.
          if (err.code !== "EEXIST" && err.code !== "ENOTEMPTY") throw err;
        });
        await pruneAgentToolsCache(cache, name);
        log(`agent tools bin cache filled`);
      } catch (err) {
        log(
          `agent tools bin cache not filled: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
        );
      } finally {
        await rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    };
    return { kind: "miss", fillDir: join(tmp, "bin"), commit };
  } catch (err) {
    log(
      `agent tools bin cache unavailable: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return { kind: "none" };
  }
}
