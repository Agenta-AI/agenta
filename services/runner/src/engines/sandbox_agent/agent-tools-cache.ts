/**
 * A per-agent cache of `agent-files/.tools/bin/` on the runner's local disk (local provider only).
 *
 * Without it, every cold start re-reads every binary from the geesefs mount (one real agent keeps
 * 103 MB there). With it, the restore stats the durable folder (name, size, mtime of each file; no
 * content read) and, when that fingerprint matches a cached entry, copies the binaries from local
 * disk instead. A changed fingerprint builds a new entry, so the rule in `agent-tools-setup.ts`
 * still holds: a binary removed from the durable folder never reaches a session.
 *
 * Layout, under the runner's tmpdir like `agentToolsLocalDir`:
 *
 *   agenta-tools-cache/                 0700, must be a real directory this uid owns
 *     <agent key>/                      0700, sha256(project id, agent artifact id)
 *       bin-<fingerprint>/bin/<file>    one complete entry, published by an atomic rename
 *       setup-<fingerprint>/tools/      what `setup.sh` left in $AGENT_TOOLS_DIR (allow only)
 *       .tmp-XXXXXX/                    an entry being built; never read
 *
 * Concurrency: an entry is built in a private temp dir and renamed into place. Two sessions of the
 * same agent that miss at once both build; the first rename wins and the second discards its copy.
 * A reader never sees a partial entry. A reader whose entry is pruned mid-copy fails its copy and
 * the caller falls back to the durable folder.
 *
 * The `setup-` entry is keyed by the whole `.tools/` folder: the `bin/` fingerprint plus a content
 * hash of every other file there (`setup.sh` and what it reads: a lockfile, a requirements file).
 * It holds files the owner's script wrote, an SSH key among them, so it is reused and written only
 * under the `allow` posture that lets the script run at all.
 *
 * Nothing here throws to the caller: any error means "no cache" and the restore runs as before.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
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

/** An agent dir untouched for this long is removed when another entry is written. */
export const AGENT_TOOLS_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

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
export async function fingerprintToolsBin(
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

/** The agent's private cache dir, created and checked. */
export async function agentCacheDir(cache: AgentToolsCache): Promise<string> {
  await ensurePrivateDir(cache.root);
  const dir = join(cache.root, cache.key);
  await ensurePrivateDir(dir);
  return dir;
}

/** Remove the agent's other entries with this prefix, and agent dirs nobody used for a while. */
export async function pruneAgentToolsCache(
  cache: AgentToolsCache,
  prefix: string,
  keep: string,
  now: number = Date.now(),
): Promise<void> {
  const agentDir = join(cache.root, cache.key);
  for (const name of await readdir(agentDir).catch(() => [] as string[])) {
    if (name.startsWith(prefix) && name !== keep)
      await rm(join(agentDir, name), { recursive: true, force: true }).catch(
        () => {},
      );
  }
  for (const name of await readdir(cache.root).catch(() => [] as string[])) {
    if (name === cache.key) continue;
    const st = await lstat(join(cache.root, name)).catch(() => undefined);
    if (st?.isDirectory() && now - st.mtimeMs > AGENT_TOOLS_CACHE_MAX_AGE_MS)
      await rm(join(cache.root, name), { recursive: true, force: true }).catch(
        () => {},
      );
  }
}

/**
 * Publish a fully built temp dir as `<agentDir>/<name>`. Returns false when another session
 * published the same entry first (its copy is equivalent; ours is discarded).
 */
export async function publishCacheEntry(
  tmp: string,
  agentDir: string,
  name: string,
): Promise<boolean> {
  try {
    await rename(tmp, join(agentDir, name));
    return true;
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOTEMPTY") return false;
    throw err;
  }
}

/** A private temp dir inside the agent's cache dir, for building one entry. */
export function makeCacheTemp(agentDir: string): Promise<string> {
  return mkdtemp(join(agentDir, ".tmp-"));
}

async function touch(dir: string): Promise<void> {
  const now = new Date();
  await utimes(dir, now, now).catch(() => {});
}

/**
 * Return a local directory holding the current durable `bin/` files, building the cache entry on
 * a miss. Undefined means "copy from the durable folder as before": no `bin/`, a fingerprint that
 * moved while we copied (the owner is writing right now), or any error.
 */
export async function cachedToolsBin(
  toolsDir: string,
  cache: AgentToolsCache,
  log: (msg: string) => void = () => {},
): Promise<string | undefined> {
  const binDir = join(toolsDir, "bin");
  try {
    const fingerprint = await fingerprintToolsBin(binDir);
    if (!fingerprint) return undefined;
    const agentDir = await agentCacheDir(cache);
    const name = `bin-${fingerprint}`;
    const entryBin = join(agentDir, name, "bin");
    const hit = await stat(entryBin).catch(() => undefined);
    if (hit?.isDirectory()) {
      await touch(agentDir);
      log(`agent tools bin cache hit`);
      return entryBin;
    }
    const tmp = await makeCacheTemp(agentDir);
    try {
      await mkdir(join(tmp, "bin"), { mode: 0o700 });
      for (const file of (await readdir(binDir)).sort()) {
        if (file.startsWith(".")) continue;
        const src = join(binDir, file);
        if (!(await stat(src)).isFile()) continue;
        await copyFile(src, join(tmp, "bin", file));
        await chmod(join(tmp, "bin", file), 0o700);
      }
      // The owner may be writing the folder right now; never publish a mix under an old name.
      if ((await fingerprintToolsBin(binDir)) !== fingerprint) {
        await rm(tmp, { recursive: true, force: true });
        log(`agent tools bin cache skipped: bin/ changed while copying`);
        return undefined;
      }
    } catch (err) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    await publishCacheEntry(tmp, agentDir, name);
    await pruneAgentToolsCache(cache, "bin-", name);
    log(`agent tools bin cache refreshed`);
    return entryBin;
  } catch (err) {
    log(
      `agent tools bin cache unavailable: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
    return undefined;
  }
}

/** Above these, `.tools/` is not hashed and the setup output is not reused (the script runs). */
export const AGENT_TOOLS_INPUTS_MAX_FILES = 1_000;
export const AGENT_TOOLS_INPUTS_MAX_BYTES = 16 * 1024 * 1024;

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Fingerprint of everything `setup.sh` can depend on inside `.tools/`: the stat fingerprint of
 * `bin/` and the content of every other file (path, size, sha256). Undefined when `.tools/` is
 * larger than the caps or cannot be read; the caller then runs the script as before.
 */
export async function fingerprintToolsInputs(
  toolsDir: string,
): Promise<string | undefined> {
  try {
    const rows = [`bin\0${(await fingerprintToolsBin(join(toolsDir, "bin"))) ?? "-"}`];
    let files = 0;
    let bytes = 0;
    const walk = async (rel: string): Promise<boolean> => {
      const entries = await readdir(join(toolsDir, rel), { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        const path = rel ? join(rel, entry.name) : entry.name;
        if (!rel && entry.name === "bin") continue;
        if (entry.isDirectory()) {
          if (!(await walk(path))) return false;
          continue;
        }
        const st = await stat(join(toolsDir, path)).catch(() => undefined);
        if (!st?.isFile()) continue;
        files += 1;
        bytes += st.size;
        if (
          files > AGENT_TOOLS_INPUTS_MAX_FILES ||
          bytes > AGENT_TOOLS_INPUTS_MAX_BYTES
        )
          return false;
        rows.push(`${path}\0${st.size}\0${await hashFile(join(toolsDir, path))}`);
      }
      return true;
    };
    if (!(await walk(""))) return undefined;
    return createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 32);
  } catch {
    return undefined;
  }
}

/** The cached setup output for this fingerprint, or undefined on a miss. */
export async function cachedSetupOutput(
  cache: AgentToolsCache,
  fingerprint: string,
): Promise<string | undefined> {
  try {
    const agentDir = await agentCacheDir(cache);
    const tools = join(agentDir, `setup-${fingerprint}`, "tools");
    if (!(await stat(tools)).isDirectory()) return undefined;
    await touch(agentDir);
    return tools;
  } catch {
    return undefined;
  }
}

/**
 * Store what `setup.sh` left in the session's local dir under `setup-<fingerprint>`. `copy`
 * copies a directory tree, symlinks kept as links (the caller runs `cp -a`). Logs and returns on
 * any error: a failed capture costs only the next session's reuse.
 */
export async function captureSetupOutput(
  cache: AgentToolsCache,
  fingerprint: string,
  localDir: string,
  copy: (from: string, to: string) => Promise<boolean>,
  log: (msg: string) => void = () => {},
): Promise<void> {
  try {
    const agentDir = await agentCacheDir(cache);
    const name = `setup-${fingerprint}`;
    const tmp = await makeCacheTemp(agentDir);
    if (!(await copy(localDir, join(tmp, "tools")))) {
      await rm(tmp, { recursive: true, force: true });
      log(`agent tools setup cache not written: copy failed`);
      return;
    }
    await publishCacheEntry(tmp, agentDir, name);
    await pruneAgentToolsCache(cache, "setup-", name);
    log(`agent tools setup cache written`);
  } catch (err) {
    log(
      `agent tools setup cache not written: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }
}
