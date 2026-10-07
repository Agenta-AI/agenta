/**
 * Pi's conversation file, kept by the runner alone.
 *
 * Pi writes its session files to a folder on the runner's own disk. This keeps that folder and the
 * conversation's `pi-sessions` prefix of the drive the same: `restore` before a session opens
 * (another runner, or this one after a restart, may have written the file last), `save` after
 * every turn. The prefix is signed apart from the session folder, so the command sandbox, which
 * mounts the session folder, can neither read nor change the agent's history, and the runner
 * needs no mount for it.
 *
 * The local folder belongs to one workspace instance (`<cwd>-pi-sessions/<instance>/`), not to the
 * conversation: a replacement workspace for the same conversation restores into its own folder, so
 * the old instance's `dispose` can never remove a file the new one is using. The store is the only
 * durable copy, so the folder goes when its workspace is dropped, and a runner start sweeps every
 * folder a previous process left.
 *
 * A turn in flight when the runner dies is lost from the file, as it is from the conversation.
 */
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SerialQueue } from "../sandbox/serial-queue.ts";
import type { ObjectStore } from "./drive-objects.ts";

type Log = (message: string) => void;

const TRANSCRIPT_DIR_SUFFIX = "-pi-sessions";

/**
 * The folder of a conversation's Pi files on the runner's own disk: beside the session folder, never
 * in it. Each workspace instance keeps its files in its own subfolder.
 */
export function transcriptDir(cwd: string): string {
  return `${cwd}${TRANSCRIPT_DIR_SUFFIX}`;
}

/**
 * Remove every `*-pi-sessions` folder under the runner's mounts root (`<root>/<project>/<mount>-pi-sessions`).
 * Called once before this process holds any in-process workspace, so each folder is a previous
 * process's; `restore` rebuilds a file from the store when its conversation comes back.
 */
export async function sweepTranscriptDirs(root: string, log: Log): Promise<number> {
  let removed = 0;
  for (const project of await readdir(root).catch(() => [] as string[])) {
    for (const name of await readdir(join(root, project)).catch(() => [] as string[])) {
      if (!name.endsWith(TRANSCRIPT_DIR_SUFFIX)) continue;
      await rm(join(root, project, name), { recursive: true, force: true });
      removed += 1;
    }
  }
  if (removed > 0) log(`[inprocess] removed ${removed} conversation file folder(s) a previous runner process left`);
  return removed;
}

const isTranscript = (name: string) => name.endsWith(".jsonl") && !name.includes("/");

export class TranscriptStore {
  private readonly steps = new SerialQueue();
  /** What was saved last, per file: size and modification time. */
  private readonly saved = new Map<string, string>();

  constructor(
    /** The runner-local folder Pi reads and writes. */
    readonly dir: string,
    private readonly store: ObjectStore,
    private readonly log: Log,
  ) {}

  /**
   * Make the folder match the store, the durable copy: every file the store has, and no other,
   * except a local file that is the one this process saved last. A local file this process did not
   * save (one a failed save left behind before a restart) holds a turn the store never got, so
   * resuming from it would disagree with every other runner.
   */
  restore(): Promise<void> {
    return this.steps.run(async () => {
      await mkdir(this.dir, { recursive: true });
      const remote = (await this.store.list("")).filter((o) => isTranscript(o.rel));
      const savedLast = async (name: string) => {
        const local = await stat(join(this.dir, name)).catch(() => undefined);
        return !!local && this.saved.get(name) === `${local.size}:${local.mtimeMs}`;
      };
      const names = new Set(remote.map((o) => o.rel));
      for (const name of (await readdir(this.dir)).filter(isTranscript)) {
        if (names.has(name) || (await savedLast(name))) continue;
        await rm(join(this.dir, name), { force: true });
        this.log(`[inprocess] removed the conversation file ${name}: the store never got it`);
      }
      for (const o of remote) {
        if (await savedLast(o.rel)) continue;
        const body = await this.store.get(o.rel);
        if (!body) continue;
        await writeFile(join(this.dir, o.rel), body);
        const st = await stat(join(this.dir, o.rel));
        this.saved.set(o.rel, `${st.size}:${st.mtimeMs}`);
      }
    });
  }

  /** Put every file that changed since it was last saved. */
  save(): Promise<void> {
    return this.steps.run(async () => {
      for (const name of (await readdir(this.dir).catch(() => [] as string[])).filter(isTranscript)) {
        const st = await stat(join(this.dir, name)).catch(() => undefined);
        if (!st) continue;
        const stamp = `${st.size}:${st.mtimeMs}`;
        if (this.saved.get(name) === stamp) continue;
        await this.store.put(name, await readFile(join(this.dir, name)));
        this.saved.set(name, stamp);
      }
    });
  }

  /**
   * Remove this instance's folder, after any save in flight (the store keeps the file). The
   * conversation's parent folder goes too once no other instance uses it.
   */
  dispose(): Promise<void> {
    return this.steps.run(async () => {
      await rm(this.dir, { recursive: true, force: true });
      await rmdir(dirname(this.dir)).catch(() => {});
    });
  }
}
