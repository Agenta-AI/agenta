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
 * This reader closes that gap. Before prompting, the engine captures the current transcript's
 * file and offset. After a Pi turn that produced no output, it asks this helper for an assistant
 * `errorMessage` appended after that cursor; when present, the run is failed loud with that
 * message instead of returning an empty turn. On a local run the transcript is
 * on this filesystem; on a Daytona run it lives inside the remote sandbox and is read through
 * the sandbox's daemon file API (the same API `usage.ts` and `pi-assets.ts` read through),
 * which must happen while the sandbox is still alive — the transcript dies with it.
 *
 * It is deliberately best-effort and side-effect free, and errs toward NO recovery: any
 * filesystem/parse problem returns `undefined` so a genuinely empty (but successful) turn is
 * never turned into a false error, and only the NEWEST transcript this run owns may supply
 * the error — an older sibling must never resurrect a failure the current turn did not have.
 * The remote probe is additionally bounded (one overall deadline, bounded head/tail parsing)
 * because it runs between the prompt settling and teardown: it must never hold the turn open.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { piSessionWorkspaceDir } from "./pi-assets.ts";

/** Overall deadline for the whole remote probe (listing plus reads). */
const REMOTE_PROBE_TIMEOUT_MS = 15_000;

/** Deadline for the remote `ls` child on its own (the daemon accepts a per-process timeout). */
const REMOTE_LS_TIMEOUT_MS = 10_000;

/** Bytes of a transcript's head that must contain the `session` record (it is line one). */
const SESSION_RECORD_HEAD_BYTES = 4 * 1024;

/**
 * Bytes of a transcript's tail scanned for the failed assistant record. The error is by
 * definition at the end (it is what ended the turn), so a bounded window is enough, and it
 * keeps a huge long-lived transcript from being decoded and split wholesale.
 */
const ERROR_SCAN_TAIL_BYTES = 64 * 1024;

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

/** The current Pi session's transcript and length immediately before one turn starts. */
export interface PiTranscriptCursor {
  sessionId: string;
  fileName?: string;
  offset: number;
}

function transcriptFileForSession(
  names: string[],
  sessionId: string,
): string | undefined {
  const suffix = `_${sessionId}.jsonl`;
  return names.find(
    (name) => name === `${sessionId}.jsonl` || name.endsWith(suffix),
  );
}

/**
 * The trailing assistant error in one transcript's content, or undefined if none.
 *
 * Scans BACKWARD from the end: the record that decides is the last assistant message, and
 * anything unparseable behind it (a partially written final record, trailing corruption)
 * disqualifies recovery entirely rather than letting the scan step over it to an older
 * error. A window cut mid-record at the START of the content is harmless: the backward scan
 * only reaches it when nothing behind it decided, and then "no recovery" is the right call.
 */
function lastAssistantError(raw: string): string | undefined {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    let record: PiMessageRecord;
    try {
      record = JSON.parse(trimmed) as PiMessageRecord;
    } catch {
      return undefined;
    }
    const msg = record.message;
    if (record.type !== "message" || msg?.role !== "assistant") continue;
    return msg.stopReason === "error" && msg.errorMessage
      ? msg.errorMessage.trim() || undefined
      : undefined;
  }
  return undefined;
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

function readLocalFile(path: string): Uint8Array | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

function listLocalTranscripts(
  sessionWorkspaceCwd: string,
): string[] | undefined {
  const transcriptDir = piSessionWorkspaceDir(sessionWorkspaceCwd);
  try {
    return readdirSync(transcriptDir).filter((name) => name.endsWith(".jsonl"));
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? [] : undefined;
  }
}

/**
 * Capture the transcript boundary before a Pi turn starts. An undefined cursor means the
 * boundary could not be established, so the caller must skip recovery for that turn.
 */
export function capturePiTranscriptCursor(
  sessionWorkspaceCwd: string,
  sessionId: string,
): PiTranscriptCursor | undefined;
export function capturePiTranscriptCursor(
  sessionWorkspaceCwd: string,
  sessionId: string,
  remote: { sandbox: any; timeoutMs?: number },
): Promise<PiTranscriptCursor | undefined>;
export function capturePiTranscriptCursor(
  sessionWorkspaceCwd: string,
  sessionId: string,
  remote?: { sandbox: any; timeoutMs?: number },
): PiTranscriptCursor | undefined | Promise<PiTranscriptCursor | undefined> {
  if (remote)
    return withDeadline(
      captureRemotePiTranscriptCursor(
        remote.sandbox,
        sessionWorkspaceCwd,
        sessionId,
      ),
      remote.timeoutMs ?? REMOTE_PROBE_TIMEOUT_MS,
    );
  const names = listLocalTranscripts(sessionWorkspaceCwd);
  if (!names) return undefined;
  const fileName = transcriptFileForSession(names, sessionId);
  if (!fileName) return { sessionId, offset: 0 };
  try {
    return {
      sessionId,
      fileName,
      offset: statSync(
        join(piSessionWorkspaceDir(sessionWorkspaceCwd), fileName),
      ).size,
    };
  } catch {
    // The file existed in the listing but vanished or became unreadable before stat. That is an
    // unknown boundary, not an empty transcript; skip recovery rather than scan an older error.
    return undefined;
  }
}

/**
 * Find the Pi transcript for a run (identified by its Pi session id and workspace cwd) and
 * return the last assistant turn's `errorMessage`, or undefined when there is none.
 *
 * The transcript location is derived from the same shared helper (`piSessionWorkspaceDir`)
 * that `configurePiSessionWorkspace` uses to point Pi at it, so the two can never disagree.
 * Because that directory is passed to Pi explicitly (PI_CODING_AGENT_SESSION_DIR), Pi writes
 * transcripts flat into it, one `.jsonl` per session, with the session id in the filename and
 * header. Matching both that id and the stamped cwd guards against stale or copied transcripts.
 *
 * Without `remote`, the transcript is read from this process's filesystem (a local run) and
 * the answer is synchronous. With `remote`, it is read out of the given sandbox (a Daytona
 * run) through the daemon file API, and the answer is a promise that resolves within
 * `remote.timeoutMs` (default 15s) — on deadline it resolves undefined, never rejects.
 */
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
  cursor: PiTranscriptCursor,
): string | undefined;
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
  cursor: PiTranscriptCursor,
  remote: { sandbox: any; timeoutMs?: number },
): Promise<string | undefined>;
export function findSwallowedPiError(
  sessionWorkspaceCwd: string,
  cursor: PiTranscriptCursor,
  remote?: { sandbox: any; timeoutMs?: number },
): string | undefined | Promise<string | undefined> {
  if (remote)
    return withDeadline(
      findRemoteSwallowedPiError(remote.sandbox, sessionWorkspaceCwd, cursor),
      remote.timeoutMs ?? REMOTE_PROBE_TIMEOUT_MS,
    );
  return findLocalSwallowedPiError(sessionWorkspaceCwd, cursor);
}

function findLocalSwallowedPiError(
  sessionWorkspaceCwd: string,
  cursor: PiTranscriptCursor,
): string | undefined {
  const names = listLocalTranscripts(sessionWorkspaceCwd);
  if (!names) return undefined;
  const fileName =
    cursor.fileName ?? transcriptFileForSession(names, cursor.sessionId);
  if (!fileName || !names.includes(fileName)) return undefined;
  const data = readLocalFile(
    join(piSessionWorkspaceDir(sessionWorkspaceCwd), fileName),
  );
  if (data === undefined) return undefined;
  const session = sessionRecordOf(
    decodeWindow(data, "head", SESSION_RECORD_HEAD_BYTES),
  );
  if (session?.id !== cursor.sessionId || session.cwd !== sessionWorkspaceCwd)
    return undefined;
  if (data.length <= cursor.offset) return undefined;
  return lastAssistantError(
    decodeWindow(data.subarray(cursor.offset), "tail", ERROR_SCAN_TAIL_BYTES),
  );
}

/** Resolve undefined when `promise` has not settled within `timeoutMs`; never rejects. */
function withDeadline<T>(
  promise: Promise<T | undefined>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise.catch(() => undefined), deadline]).finally(() =>
    clearTimeout(timer),
  );
}

function asBytes(data: unknown): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  return data instanceof Uint8Array
    ? data
    : new Uint8Array(data as ArrayBuffer);
}

/** Decode a bounded byte window of a daemon file read (which may arrive as string or bytes). */
function decodeWindow(
  data: unknown,
  window: "head" | "tail",
  bytes: number,
): string {
  if (typeof data === "string")
    return window === "head" ? data.slice(0, bytes) : data.slice(-bytes);
  const view =
    data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  const slice =
    window === "head"
      ? view.subarray(0, bytes)
      : view.subarray(Math.max(0, view.length - bytes));
  // A multibyte character cut at the window edge decodes lossily; the damage lands in the
  // window's partial boundary line, which the parsers already treat as noise.
  return new TextDecoder().decode(slice);
}

async function listRemoteTranscripts(
  sandbox: any,
  sessionWorkspaceCwd: string,
): Promise<string[] | undefined> {
  const transcriptDir = piSessionWorkspaceDir(sessionWorkspaceCwd);
  try {
    const ls = await sandbox.runProcess({
      command: "ls",
      args: ["-1", transcriptDir],
      timeoutMs: REMOTE_LS_TIMEOUT_MS,
    });
    if (ls?.exitCode !== 0) return undefined;
    return String(ls?.stdout ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter((name) => name.endsWith(".jsonl"));
  } catch {
    return undefined;
  }
}

async function captureRemotePiTranscriptCursor(
  sandbox: any,
  sessionWorkspaceCwd: string,
  sessionId: string,
): Promise<PiTranscriptCursor | undefined> {
  const names = await listRemoteTranscripts(sandbox, sessionWorkspaceCwd);
  if (!names) return undefined;
  const fileName = transcriptFileForSession(names, sessionId);
  if (!fileName) return { sessionId, offset: 0 };
  try {
    const stat = await sandbox.runProcess({
      command: "stat",
      args: [
        "-c",
        "%s",
        "--",
        `${piSessionWorkspaceDir(sessionWorkspaceCwd)}/${fileName}`,
      ],
      timeoutMs: REMOTE_LS_TIMEOUT_MS,
    });
    const rawOffset = String(stat?.stdout ?? "").trim();
    if (!/^\d+$/.test(rawOffset)) return undefined;
    const offset = Number(rawOffset);
    if (stat?.exitCode !== 0 || !Number.isSafeInteger(offset)) return undefined;
    return { sessionId, fileName, offset };
  } catch {
    return undefined;
  }
}

async function findRemoteSwallowedPiError(
  sandbox: any,
  sessionWorkspaceCwd: string,
  cursor: PiTranscriptCursor,
): Promise<string | undefined> {
  const names = await listRemoteTranscripts(sandbox, sessionWorkspaceCwd);
  if (!names) return undefined;
  const fileName =
    cursor.fileName ?? transcriptFileForSession(names, cursor.sessionId);
  if (!fileName || !names.includes(fileName)) return undefined;
  let data: Uint8Array;
  try {
    data = asBytes(
      await sandbox.readFsFile({
        path: `${piSessionWorkspaceDir(sessionWorkspaceCwd)}/${fileName}`,
      }),
    );
  } catch {
    return undefined;
  }
  const session = sessionRecordOf(
    decodeWindow(data, "head", SESSION_RECORD_HEAD_BYTES),
  );
  if (session?.id !== cursor.sessionId || session.cwd !== sessionWorkspaceCwd)
    return undefined;
  if (data.length <= cursor.offset) return undefined;
  return lastAssistantError(
    decodeWindow(data.subarray(cursor.offset), "tail", ERROR_SCAN_TAIL_BYTES),
  );
}
