/**
 * Recover a model-call error that Pi swallows on the local sandbox-agent path.
 *
 * When Pi's provider call fails (out-of-quota, bad key, rate limit, unknown model, ...),
 * Pi records the failed turn in its session transcript as an assistant message with
 * `stopReason: "error"` and a human-readable `errorMessage`, but its pi-acp bridge reports
 * the turn to the runner as a plain `{ stopReason: "end_turn" }` with NO content. The runner
 * then returns an `ok: true` run with empty output, and the user sees a silent "No response"
 * instead of the real failure.
 *
 * This reader closes that gap on the LOCAL path (Pi runs on the runner host, so its session
 * dir is on this filesystem). After a Pi turn that produced no output, the engine asks this
 * helper for the transcript's last assistant `errorMessage`; when present, the run is failed
 * loud with that message instead of returning an empty turn.
 *
 * It is deliberately best-effort and side-effect free: any filesystem/parse problem returns
 * `undefined` so a genuinely empty (but successful) turn is never turned into a false error.
 * Daytona is out of scope (the transcript lives in the remote sandbox); the empty-turn there
 * stays as-is until the harness surfaces the error over ACP.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

/** The most recent assistant error in one transcript, or undefined if none / unreadable. */
function lastAssistantError(jsonlPath: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return undefined;
  }
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

/** The `session` record of a transcript file, or undefined if unreadable / not a session. */
function readSessionRecord(jsonlPath: string): PiSessionRecord | undefined {
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return undefined;
  }
  const firstLine = raw.split("\n", 1)[0]?.trim();
  if (!firstLine) return undefined;
  try {
    const record = JSON.parse(firstLine) as PiSessionRecord;
    return record.type === "session" ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find the Pi transcript for a run (matched by its unique `cwd`) and return the last
 * assistant turn's `errorMessage`, or undefined when there is none.
 *
 * Each run gets a unique cwd, and Pi stamps the cwd on every transcript's `session` record,
 * so matching on cwd locates this run's transcript without depending on Pi's dir-name
 * encoding. Among matches (a resumed session can have several), the newest file wins.
 */
export function findSwallowedPiError(
  piAgentDir: string,
  cwd: string,
): string | undefined {
  const sessionsRoot = join(piAgentDir, "sessions");
  let dirs: string[];
  try {
    dirs = readdirSync(sessionsRoot);
  } catch {
    return undefined;
  }

  let newestPath: string | undefined;
  let newestMtime = -1;
  for (const dir of dirs) {
    const dirPath = join(sessionsRoot, dir);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, file);
      const session = readSessionRecord(filePath);
      if (session?.cwd !== cwd) continue;
      let mtime: number;
      try {
        mtime = statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
      if (mtime > newestMtime) {
        newestMtime = mtime;
        newestPath = filePath;
      }
    }
  }

  return newestPath ? lastAssistantError(newestPath) : undefined;
}
