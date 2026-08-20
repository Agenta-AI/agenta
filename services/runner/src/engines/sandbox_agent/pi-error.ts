/**
 * Recover a model-call error that Pi swallows on the sandbox-agent path.
 *
 * When Pi's provider call fails (out-of-quota, bad key, rate limit, unknown model, ...),
 * Pi records the failed turn in its session transcript as an assistant message with
 * `stopReason: "error"` and a human-readable `errorMessage`, but its pi-acp bridge reports
 * the turn to the runner as a plain `{ stopReason: "end_turn" }` with NO content. The runner
 * then returns an `ok: true` run with empty output, and the user sees a silent "No response"
 * instead of the real failure.
 *
 * This reader closes that gap. After a Pi turn that produced no output, the engine asks this
 * helper for the transcript's last assistant `errorMessage`; when present, the run is failed
 * loud with that message instead of returning an empty turn. On a local run the transcript is
 * on this filesystem; on a Daytona run it lives inside the remote sandbox and is read through
 * the sandbox's daemon file API (the same API `usage.ts` and `pi-assets.ts` read through),
 * which must happen while the sandbox is still alive — the transcript dies with it.
 *
 * It is deliberately best-effort and side-effect free: any filesystem/parse problem returns
 * `undefined` so a genuinely empty (but successful) turn is never turned into a false error.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { piSessionWorkspaceDir } from "./pi-assets.ts";

/** A Pi transcript `session` record (first line of the .jsonl). */
interface PiSessionRecord {
  type?: string;
  id?: string;
  cwd?: string;
}

/** A Pi transcript `message` record. */
interface PiMessageRecord {
  type?: string;
  message?: {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
    content?: unknown[];
  };
}

/** The most recent assistant error in one transcript's content, or undefined if none. */
function lastAssistantError(raw: string): string | undefined {
  let found: string | undefined;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: PiMessageRecord;
    try {
      record = JSON.parse(trimmed) as PiMessageRecord;
    } catch {
      continue;
    }
    const msg = record.message;
    if (record.type !== "message" || msg?.role !== "assistant") continue;
    // Keep scanning so a later successful turn clears an earlier error; only an error that
    // is the LAST assistant turn (and is what produced the empty output) is surfaced.
    if (msg.stopReason === "error" && msg.errorMessage) {
      found = msg.errorMessage.trim() || undefined;
    } else {
      found = undefined;
    }
  }
  return found;
}

/** The `session` record of a transcript's content, or undefined if not a session. */
function sessionRecordOf(raw: string): PiSessionRecord | undefined {
  const firstLine = raw.split("\n", 1)[0]?.trim();
  if (!firstLine) return undefined;
  try {
    const record = JSON.parse(firstLine) as PiSessionRecord;
    return record.type === "session" ? record : undefined;
  } catch {
    return undefined;
  }
}

function readLocalFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Find the Pi transcript for a run (identified by its unique `sessionWorkspaceCwd`) and
 * return the last assistant turn's `errorMessage`, or undefined when there is none.
 *
 * The transcript location is derived from the same shared helper (`piSessionWorkspaceDir`)
 * that `configurePiSessionWorkspace` uses to point Pi at it, so the two can never disagree.
 * Because that directory is passed to Pi explicitly (PI_CODING_AGENT_SESSION_DIR), Pi writes
 * transcripts flat into it, one `.jsonl` per session. Pi also stamps the cwd on every
 * transcript's `session` record; matching on it guards against stale or copied transcripts.
 * Among matches (a resumed session can have several), the newest file wins.
 *
 * Without `remote`, the transcript is read from this process's filesystem (a local run) and
 * the answer is synchronous. With `remote`, it is read out of the given sandbox (a Daytona
 * run) through the daemon file API, and the answer is a promise.
 */
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
): string | undefined;
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
  remote: { sandbox: any },
): Promise<string | undefined>;
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
  remote?: { sandbox: any },
): string | undefined | Promise<string | undefined> {
  if (remote)
    return findRemoteSwallowedPiError(remote.sandbox, sessionWorkspaceCwd);
  return findLocalSwallowedPiError(sessionWorkspaceCwd);
}

function findLocalSwallowedPiError(
  sessionWorkspaceCwd: string,
): string | undefined {
  const transcriptDir = piSessionWorkspaceDir(sessionWorkspaceCwd);
  let files: string[];
  try {
    files = readdirSync(transcriptDir);
  } catch {
    return undefined;
  }

  let newestRaw: string | undefined;
  let newestMtime = -1;
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = join(transcriptDir, file);
    const raw = readLocalFile(filePath);
    if (raw === undefined) continue;
    if (sessionRecordOf(raw)?.cwd !== sessionWorkspaceCwd) continue;
    let mtime: number;
    try {
      mtime = statSync(filePath).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newestRaw = raw;
    }
  }

  return newestRaw ? lastAssistantError(newestRaw) : undefined;
}

async function findRemoteSwallowedPiError(
  sandbox: any,
  sessionWorkspaceCwd: string,
): Promise<string | undefined> {
  const transcriptDir = piSessionWorkspaceDir(sessionWorkspaceCwd);
  let names: string[];
  try {
    // `-t` sorts newest-first, standing in for the local reader's mtime comparison (the
    // remote listing carries no timestamps to compare).
    const ls = await sandbox.runProcess({
      command: "ls",
      args: ["-1t", transcriptDir],
      timeoutMs: 10_000,
    });
    names = String(ls?.stdout ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return undefined;
  }

  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    let raw: string;
    try {
      const bytes = await sandbox.readFsFile({
        path: `${transcriptDir}/${name}`,
      });
      raw = typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes);
    } catch {
      continue;
    }
    if (sessionRecordOf(raw)?.cwd !== sessionWorkspaceCwd) continue;
    // The newest transcript this run owns decides, exactly like the local mtime pick: a
    // stale sibling behind it must not resurrect an older error.
    return lastAssistantError(raw);
  }
  return undefined;
}
