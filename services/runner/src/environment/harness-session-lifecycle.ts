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
  persist: { updateSession: (record: never) => Promise<unknown> };
  acpAgent: string;
  harness: string;
  cwd: string;
  /** The shared init payload both modes send. */
  sessionInit: Record<string, unknown>;
  /** The native session id to resume, when the store says one is eligible. */
  priorAgentSessionId: string | undefined;
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
  mode: "load" | "create";
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
      input.log(
        `[continuity] session/load attempted session=${input.continuitySessionKey} ` +
          `harness=${input.harness} loaded=${loadedFromContinuity}`,
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
    return { session, loadedFromContinuity, mode: "create" };
  }

  return { session, loadedFromContinuity, mode: "load" };
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
  await input.sandbox?.destroySession?.(input.session.id).catch(() => {});
}
