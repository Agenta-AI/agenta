/**
 * The run's skill snapshot, put on the drive so the command sandbox (where Pi's `read` and `bash`
 * run) finds it at the path Pi's prompt lists.
 *
 * The runner builds the snapshot on its own disk (`<cwd>/agents/skills/<digest>`) and loads the
 * skill list from it; it mounts nothing, so it writes the files to the session folder's prefix of
 * the drive itself, once per digest. The completion marker goes last, so a snapshot whose marker
 * is on the drive is complete. Executable bits are set in the sandbox (`SandboxDrive.addModes`).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PI_SKILL_SNAPSHOT_MARKER } from "../../sandbox_agent/pi-assets.ts";
import type { ObjectStore } from "./drive-objects.ts";

type Log = (message: string) => void;

/** Uploads in flight at once: a snapshot is many small files, and the first tool call waits for them. */
const UPLOAD_CONCURRENCY = 8;

async function files(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  await walk(dir);
  return found;
}

/** Put the snapshot at `snapshotDir` (inside `cwd`) on the session folder's prefix, unless its marker is already there. */
export async function publishSkillSnapshot(cwd: string, snapshotDir: string, objects: ObjectStore, log: Log): Promise<void> {
  const markerPath = join(snapshotDir, PI_SKILL_SNAPSHOT_MARKER);
  const marker = await readFile(markerPath).catch(() => undefined);
  if (!marker) return;
  const rel = (path: string) => relative(cwd, path);
  const onDrive = await objects.get(rel(markerPath));
  if (onDrive?.equals(marker)) return;
  const t0 = Date.now();
  const all = (await files(snapshotDir)).filter((p) => p !== markerPath);
  const queue = [...all];
  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) await objects.put(rel(path), await readFile(path));
    }),
  );
  await objects.put(rel(markerPath), marker);
  log(`[inprocess] skill snapshot put on the drive files=${all.length} ms=${Date.now() - t0}`);
}
