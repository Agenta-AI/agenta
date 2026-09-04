/**
 * `HarnessSessionLifecycle` — probing the harness and opening its ACP session.
 *
 * LIFECYCLE MIGRATION, STEP 5 (S7b). This unit owns two acquire stages, `probe_capabilities` and
 * `create_session`, plus the session teardown.
 *
 * IT TAKES AN EXPLICIT INPUT, NOT `AcquireContext`. The mount unit needed the context because its
 * six helpers shared mutable state and called each other. Nothing here does: probing and opening
 * are straight-line, their inputs are read-only, and their outputs are returned rather than
 * assigned. Threading the context through anyway would suggest a coupling that does not exist.
 *
 * TWO MODES, ONE STAGE NAME. `openSession` either LOADS a native conversation by id or CREATES a
 * fresh one. Both emit `create_session`, with the mode in the ` mode=...` field, so a dashboard
 * grouping by stage keeps one series with a mode dimension.
 *
 * CONTINUITY IS BEST EFFORT, AND THAT IS DELIBERATE. A resume that throws is caught, logged, and
 * falls through to a cold `createSession`. The worst outcome is a conversation that replays
 * instead of resuming, which costs latency and never correctness. What the caller must NOT do is
 * treat a successful `resumeSession` as proof that history loaded — see `loadedFromContinuity`.
 */
import { conciseError } from "../engines/sandbox_agent/errors.ts";
import { probeCapabilities } from "../engines/sandbox_agent/capabilities.ts";
import type { Log, TimingLog } from "./timing.ts";

export interface ProbeInput {
  sandbox: { createSession?: unknown };
  acpAgent: string;
  timingLog: TimingLog;
}

export interface ProbeDeps {
  probeCapabilities?: typeof probeCapabilities;
}

/**
 * Ask the harness what it supports.
 *
 * The caller branches on CAPABILITIES, never on the harness name. That is what lets a new harness
 * work without touching the acquire path.
 */
export async function probe(
  input: ProbeInput,
  deps: ProbeDeps = {},
): Promise<Awaited<ReturnType<typeof probeCapabilities>>> {
  const probeCapabilitiesStartedAt = Date.now();
  try {
    return await (deps.probeCapabilities ?? probeCapabilities)(
      input.sandbox as never,
      input.acpAgent as never,
    );
  } finally {
    input.timingLog("probe_capabilities", probeCapabilitiesStartedAt);
  }
}

export interface OpenSessionInput {
  sandbox: {
    resumeSession: (localSessionId: string) => Promise<{ id: string; agentSessionId?: string }>;
    createSession: (request: unknown) => Promise<{ id: string }>;
  };
  /** The session persist driver. Typed loosely so this unit does not restate the SDK's record. */
  persist: {
    updateSession: (record: never) => Promise<unknown>;
    listEvents?: (request: {
      sessionId: string;
      limit?: number;
    }) => Promise<{ items: unknown[] }>;
  };
  acpAgent: string;
  harness: string;
  cwd: string;
  /** The shared init payload both modes send. */
  sessionInit: Record<string, unknown>;
  /** The native session id to resume, when the store says one is eligible. */
  priorAgentSessionId: string | undefined;
  /** Whether the native transcript path is backed by durable storage for this acquire. */
  nativeHistoryDurable: boolean;
  /** The runner-local key both modes use for the persist record. */
  localSessionId: string | undefined;
  /** For the continuity log line only. */
  continuitySessionKey: string | undefined;
  log: Log;
  timingLog: TimingLog;
}

export interface OpenSessionResult {
  session: { id: string; agentSessionId?: string };
  /**
   * Whether the native conversation was loaded.
   *
   * READ THE CAVEAT. This compares the returned `agentSessionId` to the one we asked for, which
   * proves the ADAPTER ACCEPTED THE ID. It does NOT prove the adapter replayed the turns. A
   * `session/load` that succeeds at the transport layer and loads nothing would still set this
   * true. The adapter matrix records the gap and requires a positive history check before a
   * reopen may claim continuity; this unit reports what it can observe and no more.
   */
  loadedFromContinuity: boolean;
  /** Whether `session/load` emitted prior conversation content, not merely accepted the id. */
  nativeHistoryVerified: boolean;
  mode: "load" | "create";
}

const HISTORY_SESSION_UPDATES = new Set([
  "user_message_chunk",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
]);

/**
 * `sandbox-agent` persists every ACP envelope observed while `session/load` runs. A real native
 * replay therefore leaves at least one conversation update behind; an adapter that merely accepts
 * the id leaves none. This is the positive proof the id comparison cannot provide.
 */
async function loadedHistoryWasObserved(
  persist: OpenSessionInput["persist"],
  localSessionId: string,
): Promise<boolean> {
  if (!persist.listEvents) return false;
  const page = await persist.listEvents({ sessionId: localSessionId, limit: 100 });
  return page.items.some((item) => {
    const event = item as {
      sender?: unknown;
      payload?: { method?: unknown; params?: { update?: { sessionUpdate?: unknown } } };
    };
    return (
      event.sender === "agent" &&
      event.payload?.method === "session/update" &&
      HISTORY_SESSION_UPDATES.has(
        String(event.payload.params?.update?.sessionUpdate ?? ""),
      )
    );
  });
}

/**
 * Open the harness session: load the native conversation when one is eligible, otherwise create
 * a fresh one.
 *
 * A load that throws degrades to a create. The `finally` still emits the ` mode=load` mark, so
 * the failed attempt is visible in timing rather than hidden behind the create that follows it.
 */
export async function openSession(
  input: OpenSessionInput,
): Promise<OpenSessionResult> {
  let session: { id: string; agentSessionId?: string } | undefined;
  let loadedFromContinuity = false;
  let nativeHistoryVerified = false;

  if (input.priorAgentSessionId && input.localSessionId) {
    await input.persist.updateSession({
      id: input.localSessionId,
      agent: input.acpAgent,
      agentSessionId: input.priorAgentSessionId,
      lastConnectionId: "",
      createdAt: Date.now(),
      sessionInit: input.sessionInit,
    } as never);
    const createSessionStartedAt = Date.now();
    try {
      session = await input.sandbox.resumeSession(input.localSessionId);
      loadedFromContinuity =
        session.agentSessionId === input.priorAgentSessionId;
      if (loadedFromContinuity && input.nativeHistoryDurable) {
        try {
          nativeHistoryVerified = await loadedHistoryWasObserved(
            input.persist,
            input.localSessionId,
          );
        } catch (err) {
          input.log(
            `[continuity] native history verification failed: ${conciseError(err, input.harness)}`,
          );
        }
      }
      input.log(
        `[continuity] session/load attempted session=${input.continuitySessionKey} ` +
          `harness=${input.harness} loaded=${loadedFromContinuity} ` +
          `historyDurable=${input.nativeHistoryDurable} ` +
          `historyVerified=${nativeHistoryVerified}`,
      );
    } catch (err) {
      input.log(
        `[continuity] resumeSession failed, falling back to cold createSession: ` +
          `${conciseError(err, input.harness)}`,
      );
    } finally {
      input.timingLog("create_session", createSessionStartedAt, " mode=load");
    }
  }

  if (!session) {
    const createSessionStartedAt = Date.now();
    try {
      session = await input.sandbox.createSession({
        ...(input.localSessionId ? { id: input.localSessionId } : {}),
        agent: input.acpAgent,
        cwd: input.cwd,
        sessionInit: input.sessionInit,
      });
    } finally {
      input.timingLog("create_session", createSessionStartedAt, " mode=create");
    }
    return {
      session,
      loadedFromContinuity,
      nativeHistoryVerified,
      mode: "create",
    };
  }

  return {
    session,
    loadedFromContinuity,
    nativeHistoryVerified,
    mode: "load",
  };
}

/**
 * Close the harness session gracefully.
 *
 * ORDERING IS LOAD-BEARING: this must run BEFORE the daemon is torn down, or the ACP adapter
 * subprocess reparents to PID 1 and never exits. The composer sequences it; the unit only refuses
 * to throw.
 */
export async function teardown(input: {
  sandbox: { destroySession?: (id: string) => Promise<unknown> } | undefined;
  session: { id: string } | undefined;
  /** True when the pause path already sent its own cancel. */
  alreadyRequested: boolean;
}): Promise<void> {
  if (!input.session || input.alreadyRequested) return;
  // try/catch rather than `.catch()`: a `destroySession` that throws SYNCHRONOUSLY never returns
  // a promise, so there is nothing to attach a rejection handler to and the throw escapes into
  // `destroy`, which must never throw. Teardown is best effort by design; a session the harness
  // has already lost is not a reason to fail the caller.
  try {
    await input.sandbox?.destroySession?.(input.session.id);
  } catch {
    // best-effort session teardown
  }
}

/**
 * ============================================================================================
 * REOPEN: closing and reopening the session on the SAME sandbox
 * ============================================================================================
 *
 * LIFECYCLE MIGRATION, STEP 6 (continued). A reopen is what makes the uniform tool, MCP, prompt
 * and harness-file routes cheaper than a rebuild: the sandbox, the daemon, the mounts and the
 * workspace all survive; only the ACP session is recreated.
 *
 * THE HARD PART IS NOT REOPENING. It is knowing whether the CONVERSATION survived.
 *
 * `adapter-matrix.md` section 6.2 is explicit that a matching `agentSessionId` proves the adapter
 * ACCEPTED the id, not that it replayed the turns. A `session/load` that succeeds at the transport
 * layer and loads nothing would look identical. So a reopen may not claim continuity on that
 * evidence, and the matrix gives two options: read back a positive signal, or treat the reopen as
 * a continuity loss and replay.
 *
 * WHAT WE CAN ACTUALLY OBSERVE: nothing. The ACP surface exposes no conversation length and no
 * last-message identifier, so the first option is unavailable today. Inventing a check that does
 * not check anything would be worse than having none.
 *
 * SO THE CONDITION IS REPLAYABILITY, NOT VERIFICATION. The runner does not always NEED native
 * history. When the request carries the full transcript, the turn replays it and a reopened
 * session that lost its memory is indistinguishable from one that kept it. When the request
 * carries only the last message, the harness's native memory IS the conversation, and losing it
 * silently truncates the user's context.
 *
 *   full transcript in the request -> reopen is safe. Replay covers the loss.
 *   last-message-only request      -> reopen needs proof we cannot obtain. FAIL CLOSED.
 *
 * That is the honest reading of the matrix's second option, and it keeps the route useful for the
 * common case instead of making it permanently inert.
 */
export interface ReopenInput extends OpenSessionInput {
  /** The live session to close before reopening. */
  current: { id: string } | undefined;
  /**
   * True when the incoming request carries the whole prior conversation, so the turn replays it
   * and native memory is not load-bearing. Computed by the caller from `carriesMinimalHistory`.
   */
  transcriptReplayable: boolean;
}

export type ReopenResult =
  | {
      ok: true;
      session: { id: string; agentSessionId?: string };
      loadedFromContinuity: boolean;
      nativeHistoryVerified: boolean;
    }
  | { ok: false; reason: "history-unverifiable" | "reopen-failed" };

/**
 * Close and reopen the harness session on the same sandbox.
 *
 * Returns `ok: false` rather than throwing: a refusal is an ordinary outcome the caller answers
 * with a rebuild. `history-unverifiable` is a REFUSAL BEFORE ANY CHANGE — nothing is closed and
 * the live session keeps running, so the caller's rebuild starts from a clean state rather than
 * from a session we already tore down.
 */
export async function reopen(input: ReopenInput): Promise<ReopenResult> {
  if (!input.transcriptReplayable) {
    input.log(
      "reopen refused: the request carries no transcript to replay, and native history cannot be verified",
    );
    return { ok: false, reason: "history-unverifiable" };
  }
  try {
    await teardown({
      sandbox: input.sandbox as never,
      session: input.current,
      alreadyRequested: false,
    });
    const opened = await openSession(input);
    return {
      ok: true,
      session: opened.session,
      loadedFromContinuity: opened.loadedFromContinuity,
      nativeHistoryVerified: opened.nativeHistoryVerified,
    };
  } catch (err) {
    input.log(`reopen failed: ${conciseError(err, input.harness)}`);
    return { ok: false, reason: "reopen-failed" };
  }
}
