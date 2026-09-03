import { apiBase } from "../../apiBase.ts";
import {
  effectivePermission,
  permissionsFromRequest,
} from "../../permission-plan.ts";
import {
  currentUserTurn,
  resolvePromptText,
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
  type ToolCallbackContext,
} from "../../protocol.ts";
import { sandboxVisibleSecretValues, seedForRun } from "../../redaction.ts";
import { startPlatformCredentialLease } from "../../sessions/auth.ts";
import {
  ApprovalResponder,
  ApprovedExecutionGrants,
  ConversationDecisions,
  extractApprovalDecisions,
  extractClientToolOutputs,
  extractInBandApprovalAnswers,
} from "../../responder.ts";
import {
  buildInteractionData,
  buildWorkflowReferenceList,
  createInteraction,
  resolveInteraction,
  seedDecisionMap,
} from "../../sessions/interactions.ts";
import { toolSpecsByName } from "../../tools/public-spec.ts";
import {
  localRelayHost,
  sandboxRelayHost,
  startToolRelay,
  type RelayExecutionGuard,
} from "../../tools/relay.ts";
import {
  APPROVED_EXECUTION_RESULT_UNKNOWN,
  createSandboxAgentOtel,
  INTERRUPTED_BY_USER,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../tracing/otel.ts";
import {
  attachPermissionResponder,
  buildGateDescriptor,
} from "./acp-interactions.ts";
import {
  buildClientToolRelay,
  relayWritesPausedAnswer,
} from "./client-tools.ts";
import { buildExecutableToolGate } from "./executable-tools.ts";
import { invalidateContinuity } from "./environment.ts";
import { createHarnessTracePort } from "./harness-trace-port.ts";
import {
  attachmentCapabilityGate,
  buildPromptBlocks,
  collectAttachmentRefs,
  collectLegacyInlineImages,
  resolveCurrentTurnAttachments,
  restoreReferencedWorkingCopies,
  type AcpPromptBlock,
} from "./attachments.ts";
import { describeCodexSubscriptionAuthFault } from "./codex-assets.ts";
import {
  classifyRunError,
  CREDENTIAL_RACE_REPORTS_PER_SESSION,
  withinCredentialPropagationWindow,
} from "./errors.ts";
import { cancelHarnessTurn } from "./cancel-turn.ts";
import { reapLeakedExecChildren } from "./reap-exec.ts";
import { PAUSED, PendingApprovalPauseController } from "./pause.ts";
import {
  capturePiTranscriptCursor,
  findSwallowedPiError,
  isOnlyHarnessRetryNotices,
} from "./pi-error.ts";
import { buildGatewayToolGate } from "./gateway-gate.ts";
import { buildRelayExecutionGuard } from "./relay-guard.ts";
import {
  buildApprovedContentWiring,
  createCommitAuthorizationState,
} from "./approved-content.ts";
import { createRunLimits, resolveRunLimits } from "./run-limits.ts";
import {
  httpLivenessProbe,
  resolveSandboxLivenessLimits,
  sandboxHealthUrl,
  startSandboxLivenessProbe,
} from "./sandbox-liveness.ts";
import {
  RUN_LIMIT_TRIPPED,
  sendLastMessageOnly,
  type CurrentTurn,
  type ParkedApproval,
  type ParkedApprovedExecution,
  type RunTurnOptions,
  type SessionEnvironment,
} from "./runtime-contracts.ts";
import {
  resolveRunOtlpTarget,
  runCredential,
  serverPermissionsFromRequest,
  shouldSuppressPausedToolCallUpdate,
} from "./runtime-policy.ts";
import { appendSessionTurn } from "./session-continuity-durable.ts";
import { nextTurnIndex, sessionContinuityStore } from "./session-continuity.ts";
import { reconstructHistoryIfNeeded } from "./reconstruct-history.ts";
import { carriesApprovalReplyOnly } from "./session-identity.ts";
import { buildTurnText, priorMessages } from "./transcript.ts";
import { resolveRunUsage } from "./usage.ts";

/**
 * Run one turn against an acquired environment: start a fresh otel run, wire this turn's pause
 * controller / decisions / responder into `env.currentTurn`, restart the tool relay,
 * send the prompt, resolve usage, and finish + flush the trace. It does NOT tear down the
 * environment (the caller owns `env.destroy`). On a continuation the prompt is only the new user
 * text (`buildTurnText` does not run); on a cold turn it is `plan.prompt.turnText`,
 * exactly as before.
 */
export async function runTurn(
  env: SessionEnvironment,
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  opts: RunTurnOptions = {},
): Promise<AgentRunResult> {
  // INVARIANT: this function MUST REACH `attachPermissionResponder` WITHIN ONE MACROTASK TICK
  // of being invoked. The session-lifetime `onPermissionRequest` registered in
  // `acquireEnvironment` routes every gate into `env.currentTurn.onPermissionRequest`, which is
  // `undefined` until that call wires it. A gate that arrives before then takes the between-turns
  // branch in `session-events.ts` (`routePermissionRequestToActiveTurn`) and is answered
  // `reject` by policy — so a legitimate gate becomes a refusal the user never sees a card for.
  // It is a yield, not a timing race, so making awaited work faster does not shrink the
  // exposure. Do NOT add unconditional I/O anywhere above that call; hand pre-turn reads in
  // through `opts` instead (see `opts.seededDecisions`).
  const { plan, logger, deps } = env;
  const initialCredential = opts.credential ?? (() => runCredential(request));
  const initialOtlpTarget = resolveRunOtlpTarget(request, initialCredential);
  // Session-owned turns receive the watchdog's lease through opts.credential. A standalone
  // Agenta run owns the same reusable lease here so even a single 12-hour turn exports with a
  // current credential. External collector headers stay static and never enter this exchange.
  const platformCredentialLease =
    !opts.credential && initialOtlpTarget.authorizationSource === "platform"
      ? startPlatformCredentialLease(apiBase(), runCredential(request))
      : undefined;
  const credential =
    opts.credential ?? platformCredentialLease?.credential ?? initialCredential;
  const otlpTarget = resolveRunOtlpTarget(request, credential);
  const sessionId = env.sessionId;
  const toolRunContext = env.sessionId
    ? { ...request.runContext, session: { id: env.sessionId } }
    : request.runContext;
  // Race marker for a user Stop (the control-plane `cancel`/`steer` command drops the alive lock, the
  // heartbeat aborts `signal`). Distinct from PAUSED/RUN_LIMIT_TRIPPED so the turn ends CLEANLY
  // (honest interrupted transcript, keep-warm) instead of falling through to the error catch.
  const CANCELLED = Symbol("cancelled");
  /**
   * Did the harness confirm it stopped? Set only on the cancelled path, and only when the ACP
   * cancel was sent AND the harness answered its open prompt inside the settle budget. It rides
   * out on the result because it is the one fact that decides park versus delete for a Stop.
   */
  let cancelSettled = false;
  const continuityStore = deps.sessionContinuityStore ?? sessionContinuityStore;
  /**
   * Should a credential refusal this turn be reported as a delivery race rather than a bad key?
   *
   * Two conditions, and it MUTATES the session's report counter, so it is called only from the
   * classifier's credential-refusal branch — never speculatively. The window says the race is
   * physically possible (a Daytona Secret delivered to this sandbox moments ago); the counter
   * says the explanation has not been spent on this conversation already.
   *
   * A run with no session id cannot be counted, so it always gets the honest copy. There is no
   * conversation to loop within, and the alternative — blaming a key that may be perfectly good —
   * is the failure this whole branch exists to remove.
   */
  const reportCredentialRace = (): boolean => {
    if (!withinCredentialPropagationWindow(env.modelSecretDeliveredAt)) {
      return false;
    }
    if (!sessionId) {
      logger(
        "[credential-race] credential_delivery_failed (no session id, uncounted): a Daytona " +
          "Secret for this run was delivered inside the propagation window",
      );
      return true;
    }
    const occurrence = continuityStore.noteCredentialRaceReport(sessionId);
    if (occurrence > CREDENTIAL_RACE_REPORTS_PER_SESSION) {
      logger(
        `[credential-race] NOT credential_delivery_failed (occurrence ${occurrence} > ` +
          `${CREDENTIAL_RACE_REPORTS_PER_SESSION} for this session): a second fresh sandbox ` +
          "refused the same way, so the key is the better explanation; falling through to the " +
          "model-authentication advice",
      );
      return false;
    }
    logger(
      `[credential-race] credential_delivery_failed (occurrence ${occurrence}/` +
        `${CREDENTIAL_RACE_REPORTS_PER_SESSION} for this session): the model credential was ` +
        "delivered as a Daytona Secret inside the propagation window, so this refusal is " +
        "delivery, not the user's key",
    );
    return true;
  };
  const turnStartedAt = new Date().toISOString();
  // `turn_index` is a true conversation-turn counter, not an acquire counter: it advances once per completed turn across every environment serving the session.
  // The shared store advances only on `record()` (paused turns record nothing), so park-and-resume consumes one index; compute it at turn start because a warm environment serves many turns.
  env.continuityTurnIndex = sessionId
    ? nextTurnIndex(sessionId, continuityStore)
    : undefined;
  // Reset the per-turn tool-call id record (the park folds the completed turn's ids into the
  // expected next-history fingerprint).
  env.lastTurnToolCallIds = [];
  // Reset the per-turn approval-park bookkeeping. A fresh turn starts with no parked gates; this
  // turn re-records them only if it pauses on parkable ACP permission gates. (The dispatch has
  // already captured any prior park into `opts.resume` before calling us.)
  const carriedApprovedExecutions = opts.resume
    ? [...(env.parkedApprovedExecutions?.values() ?? [])]
    : [];
  const parkedApprovedExecutions = new Map<string, ParkedApprovedExecution>();
  env.parkedApprovedExecutions = parkedApprovedExecutions;
  env.parkedApprovals.clear();
  env.parkedApproval = undefined;
  env.approvalGateCount = 0;
  // A fresh turn never inherits an approval. Only a resume may consume records minted before
  // the park; anything else starts empty, so no call can execute on the strength of an approval
  // raised for an earlier turn.
  if (!opts.resume) env.commitAuthorization = undefined;
  env.nonParkablePauseCount = 0;
  // Hoisted so the catch can flush a partial trace (mirroring the pre-split `otel?` handling —
  // a createOtel throw must still return `{ ok: false }`, not propagate raw) and the finally can
  // stop this turn's relay on EVERY exit path (a cleared sink must never orphan it).
  let otel: ReturnType<typeof createSandboxAgentOtel> | undefined;
  let activeTurn: CurrentTurn | undefined;
  const harnessTrace = createHarnessTracePort({
    env,
    request: () => request,
    target: otlpTarget,
    resume: !!opts.resume,
  });
  // Assigned once the turn's interaction plumbing exists; called from the `finally` so EVERY exit
  // path (done, paused, cancelled, error) settles the durable rows this turn's in-band answers
  // consumed. Without it, a resume the harness does not re-gate leaves them `pending` forever.
  let settleInBandInteractions: (() => Promise<void>) | undefined;

  // Time-based run deadlines (total/idle/TTFB/per-tool-call) for THIS turn: an idle/wedged harness
  // has no deadline anywhere, so a silent or hung turn would hold its sandbox forever. Tripping a
  // limit resolves the prompt race with `RUN_LIMIT_TRIPPED`, which ends the turn as an error so the
  // caller's teardown (`runSandboxAgent`'s `finally`, or the keep-alive dispatch's evict-on-failure)
  // reclaims the sandbox exactly as any other error does. Disposed in the `finally` on every path.
  // A human pause retires the deadlines (`notePaused`): a HITL wait is legitimate, not a wedge.
  const resolvedRunLimits = (deps.resolveRunLimits ?? resolveRunLimits)(logger);
  const runLimits = (deps.createRunLimits ?? createRunLimits)(
    resolvedRunLimits,
    { log: logger },
  );
  let runLimitTrip: (() => void) | undefined;
  let runLimitReason: string | undefined;
  const runLimitTripped = new Promise<void>((resolve) => {
    runLimitTrip = resolve;
  });
  runLimits.onTrip((reason) => {
    runLimitReason = reason;
    runLimitTrip?.();
  });

  // The run limits above cannot see a sandbox that DIED under the turn: the ACP prompt they
  // race against never settles once the peer is gone, and `notePaused()` retires them entirely
  // while a turn waits for a human. So probe the sandbox's own HTTP surface, independently of
  // the wedged ACP channel, and end the turn through the same trip path any other limit uses.
  // See `sandbox-liveness.ts` and issue #6418.
  const sandboxHealth = sandboxHealthUrl(env.sandbox);
  const sandboxLiveness = sandboxHealth
    ? startSandboxLivenessProbe({
        probe: httpLivenessProbe(sandboxHealth),
        limits: resolveSandboxLivenessLimits(logger),
        onGone: (reason: string) => {
          runLimitReason = reason;
          runLimitTrip?.();
        },
        log: logger,
      })
    : undefined;
  if (!sandboxHealth) {
    logger("[sandbox-liveness] no health URL on this sandbox; probe disabled");
  }

  try {
    // AGENTA_SESSIONS_RECONSTRUCT defaults on so minimal-history clients keep their conversation;
    // only the literal "false" opts out. The compose default supplies an empty string, not "true".
    // Server-side history reconstruction rebuilds prior turns from the durable record log.
    // The server already persisted this turn, so reconstruction filters its turn id.
    // Reassign `request` so every downstream reader sees the same reconstructed history.
    // An out-of-band approval reply carries no user text of its own, so this must be decided from
    // the INBOUND request: reconstruction prepends the original user turn, after which
    // `resolvePromptText` would hand back that stale command and the model would restart the task.
    const approvalReplyOnly = carriesApprovalReplyOnly(request);
    const inboundRequest = request;
    // On a LIVE approval resume the rebuilt history is never sent to the harness: the resume
    // continues the ORIGINAL prompt promise (`opts.resume` below), so `turnText` is discarded and
    // the harness already holds the conversation. Reconstruction there only enriches the trace and
    // the responder's view, so a failed records fetch must NOT fail the turn: `{ok:false}` makes
    // the dispatch evict the live session and retry cold, where reconstruction throws again — one
    // 500 from the records endpoint would lose the human's approval AND the parked session. Keep
    // the inbound request and continue. A cold turn still fails loudly, where it matters.
    let reconstructed: AgentRunRequest | null = null;
    let historicalWorkingCopiesRestored = false;
    let historicalAttachmentsPresent = false;
    const restoreHistoricalWorkingCopies = async (
      messages: NonNullable<AgentRunRequest["messages"]>,
    ) => {
      historicalWorkingCopiesRestored = true;
      historicalAttachmentsPresent ||= messages.some(
        (message) => collectAttachmentRefs(message).length > 0,
      );
      return restoreReferencedWorkingCopies(
        env.sandbox,
        plan,
        messages,
        sessionId,
        credential,
        { log: logger },
      );
    };
    try {
      reconstructed = await reconstructHistoryIfNeeded(
        request,
        sessionId,
        credential,
        logger,
        !opts.continuation && !opts.resume
          ? { restore: restoreHistoricalWorkingCopies }
          : undefined,
      );
    } catch (err) {
      if (!opts.resume) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      logger(
        `[reconstruct] live resume: keeping the inbound history (${detail})`,
      );
    }
    if (reconstructed) request = reconstructed;

    if (
      !opts.continuation &&
      !opts.resume &&
      !historicalWorkingCopiesRestored
    ) {
      const messages = request.messages ?? [];
      const current = currentUserTurn(request);
      const historical = current.message ? messages.slice(0, -1) : messages;
      const restored = await restoreHistoricalWorkingCopies(historical);
      request = {
        ...request,
        messages: current.message ? [...restored, current.message] : restored,
      };
    }

    const promptText = approvalReplyOnly
      ? resolvePromptText(request)
      : currentUserTurn(request).text;
    // Cold: replay the full transcript. Continuation or loaded: send only new text. When history
    // was rebuilt from records, recompute the transcript from it — the prebuilt
    // plan.prompt.turnText predates the reconstruction. An approval reply has no new text
    // either way, so it sends the approval-resume frame `buildTurnText` renders (the
    // harness already holds the prior turns when the session was loaded natively;
    // otherwise the rebuilt transcript comes with it).
    const turnText = sendLastMessageOnly(opts)
      ? approvalReplyOnly
        ? buildTurnText(inboundRequest, logger)
        : promptText
      : reconstructed || historicalAttachmentsPresent
        ? buildTurnText(request, logger)
        : plan.prompt.turnText;

    const runRedactor = seedForRun(request, sandboxVisibleSecretValues(env));
    const run = (deps.createOtel ?? createSandboxAgentOtel)({
      harness: plan.harness,
      model: env.model,
      skills: plan.workspace.skillDirs.map((s) => s.name),
      traceparent: request.context?.propagation?.traceparent,
      baggage: request.context?.propagation?.baggage,
      endpoint: otlpTarget.endpoint,
      // The session keepalive owns this getter and refreshes its value while a long turn runs.
      // Resolve it only when the trace batch leaves the runner, not when the turn starts.
      authorization: otlpTarget.authorization,
      captureContent: request.telemetry?.capture?.content?.enabled,
      // Seed from the request's typed model/MCP credential material (`requestSecretValues` —
      // on a Daytona Secrets run the opaque values left the plaintext env for the secret plan
      // but still transit runner memory) plus the mount's STS pair — none of which lives in the
      // sidecar's process env.
      redactor: runRedactor,
      emitSpans: harnessTrace.runnerEmitsSpans,
      // Every emitted event is a progress signal for the idle/TTFB deadlines (message/thought
      // deltas, tool calls and results, usage, ...) — the one seam every harness's output flows
      // through. Per-tool-call timers are driven separately from `handleUpdate` below.
      emit: emit && runLimits.wrapEmit(emit),
    });
    otel = run;

    run.start({
      prompt: promptText,
      sessionId,
      messages: [
        ...priorMessages(request),
        { role: "user", content: promptText },
      ],
    });
    await harnessTrace.start(run, runRedactor);
    const resultTraceId = harnessTrace.traceId(run);

    let promptBlocks: AcpPromptBlock[] = [{ type: "text", text: turnText }];
    if (!opts.resume) {
      const current = currentUserTurn(request);
      const refs = collectAttachmentRefs(current.message);
      const resolved =
        refs.length > 0
          ? await resolveCurrentTurnAttachments({
              message: current.message,
              sessionId,
              auth: credential,
              sandbox: env.sandbox,
              plan,
              capabilities: env.capabilities,
              modelCapabilities: request.modelCapabilities,
              provider: request.modelConnection?.provider,
              emit: (event) => run.emitEvent(event),
            })
          : [];
      const legacyImages = collectLegacyInlineImages(current.message);
      const nativeLegacyImages = [];
      for (const image of legacyImages) {
        const gate = attachmentCapabilityGate({
          acpAgent: plan.acpAgent,
          provider: request.modelConnection?.provider,
          capabilities: env.capabilities,
          // Legacy inline images predate the catalog, so a caller that declares nothing keeps
          // the historical image-capable assumption; a caller that declares modalities is
          // authoritative and its answer decides. Codex is excluded because its bridge rejects
          // the whole prompt rather than degrading.
          modelCapabilities:
            plan.acpAgent === "codex"
              ? request.modelCapabilities
              : (request.modelCapabilities ?? { inputModalities: ["image"] }),
          mediaType: image.mimeType,
          byteLength: Buffer.from(image.data, "base64").byteLength,
        });
        if (gate.outcome === "native") nativeLegacyImages.push(image);
        logger(
          `[attachments] legacy inline image delivery=${
            gate.outcome === "native" ? "native" : "degraded"
          } reason=${gate.reasonCode}`,
        );
      }
      promptBlocks = buildPromptBlocks(
        turnText,
        resolved,
        nativeLegacyImages,
        current.text,
      );
      if (promptBlocks.length === 0) {
        promptBlocks = [
          {
            type: "text",
            text: "[inline image could not be delivered to this harness]",
          },
        ];
      }
    }

    const sessionTurnClient = deps.appendSessionTurn ?? appendSessionTurn;
    const syncCred = runCredential(request);
    const turnLedgerContext =
      sessionId &&
      env.continuityTurnIndex !== undefined &&
      syncCred &&
      request.streamId
        ? {
            sessionId,
            turnIndex: env.continuityTurnIndex,
            authorization: syncCred,
            streamId: request.streamId,
          }
        : undefined;
    if (turnLedgerContext) {
      const workflowRefs = buildWorkflowReferenceList(
        request.runContext?.workflow,
      );
      // Row existence proves only that a turn started. Native continuation is trustworthy only
      // after `end_time` is set.
      await sessionTurnClient(
        turnLedgerContext.sessionId,
        plan.harness,
        turnLedgerContext.turnIndex,
        {
          streamId: turnLedgerContext.streamId,
          turnId: request.turnId,
          agentSessionId: env.session?.agentSessionId,
          sandboxId: env.sandbox?.sandboxId,
          references: workflowRefs,
          traceId: resultTraceId ?? request.runContext?.trace?.trace_id,
          spanId: request.runContext?.trace?.span_id,
          startTime: turnStartedAt,
        },
        { authorization: turnLedgerContext.authorization, log: logger },
      ).catch(() => {});
    }

    const pause = new PendingApprovalPauseController(() => {
      // Do NOT force-settle open tool calls here, at first pause. With concurrent approvals a
      // second gated call may still be in flight (its permission request lands a tick after the
      // first gate pauses the turn), and settling it here would orphan a call that is about to
      // emit its own approval card. The orphan settle is deferred to the post-drain sweep below
      // (which runs on every paused turn, after `waitForEventDrain` lets every pending gate mark
      // its call paused) plus the in-band re-sweep in `handleUpdate` for a sibling announced after
      // the pause. Both exclude paused gates and allowed executions, so each keeps its own
      // terminal outcome while only a genuine orphan settles.
      // Park mode: at least one parkable permission gate (Claude ACP or Pi ACP) recorded into
      // `env.parkedApprovals` BEFORE firing this pause (the onUserApprovalGate hook runs as each
      // gate resolves). Keep the live session — the gated tools run on the resume — so skip ONLY
      // the mcpAbort and the destroySession. The teardown is not lost: the dispatch either parks
      // the session or, if it decides not to (mixed non-parkable set, pool full), calls
      // `env.destroy()` which runs them. A pause with no parkable gate (keep-alive off, client
      // tool only) records nothing, so it still tears down here exactly as today.
      if (opts.approvalParkMode && env.parkedApprovals.size > 0) return;
      // Abort any in-flight loopback `tools/call` (a paused Claude client tool) BEFORE the
      // session teardown, so its handler cannot write a result after the turn ends.
      env.mcpAbort.abort();
      env.sessionDestroyRequested = true;
      return env.sandbox.destroySession?.(env.session.id);
    });
    if (opts.resume?.carriedForward.length) {
      for (const gate of opts.resume.carriedForward) {
        env.parkedApprovals.set(gate.toolCallId, gate);
        env.parkedApproval ??= gate;
        pause.markPausedToolCall(gate.toolCallId);
      }
      env.approvalGateCount = env.parkedApprovals.size;
    }
    // A human pause resolves this signal exactly once, the moment the turn parks for input — the one
    // place every pause path converges, so the one place to retire the run-limits deadlines for good.
    void pause.signal.then(() => runLimits.notePaused());

    const openToolCallIds = (): string[] => run.openToolCallIds?.() ?? [];
    const approvedExecutionSeeds = new Map<string, ParkedApprovedExecution>(
      carriedApprovedExecutions.map((seed) => [seed.toolCallId, seed]),
    );
    const bufferedPausedCompletedFrames = new Map<string, unknown>();
    const toolCallClosureWaiters = new Map<string, Set<() => void>>();
    const notifyToolCallClosed = (toolCallId: string): void => {
      if (openToolCallIds().includes(toolCallId)) return;
      const waiters = toolCallClosureWaiters.get(toolCallId);
      if (!waiters) return;
      toolCallClosureWaiters.delete(toolCallId);
      for (const waiter of waiters) waiter();
    };
    const waitForToolCallClosure = (
      toolCallId: string,
      timeoutMs: number,
    ): Promise<boolean> => {
      if (!openToolCallIds().includes(toolCallId)) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        let timeout: NodeJS.Timeout | undefined;
        let finished = false;
        const finish = (closed: boolean): void => {
          if (finished) return;
          finished = true;
          if (timeout) clearTimeout(timeout);
          const waiters = toolCallClosureWaiters.get(toolCallId);
          waiters?.delete(onClosed);
          if (waiters?.size === 0) toolCallClosureWaiters.delete(toolCallId);
          resolve(closed);
        };
        const onClosed = (): void => finish(true);
        const waiters = toolCallClosureWaiters.get(toolCallId) ?? new Set();
        waiters.add(onClosed);
        toolCallClosureWaiters.set(toolCallId, waiters);
        timeout = setTimeout(() => finish(false), timeoutMs);
      });
    };

    // Publish this turn's sink so the session-lifetime listeners route into it. handleUpdate
    // reproduces the old per-event routing (suppress paused frames, handleUpdate, pause re-sweep).
    const turn: CurrentTurn = {
      run,
      pause,
      toolRelay: undefined,
      handleUpdate: (update) => {
        // Per-tool-call deadline: starts on the announcement, ends on a terminal status. Tracked
        // regardless of the pause-suppression below (a call already timed out must not linger just
        // because a later sibling frame gets suppressed).
        const rawFrame = update as {
          sessionUpdate?: unknown;
          toolCallId?: unknown;
          status?: unknown;
        };
        if (rawFrame?.sessionUpdate === "tool_call" && rawFrame.toolCallId) {
          runLimits.noteToolCallStart(String(rawFrame.toolCallId));
        } else if (
          rawFrame?.sessionUpdate === "tool_call_update" &&
          rawFrame.toolCallId &&
          (rawFrame.status === "completed" || rawFrame.status === "failed")
        ) {
          runLimits.noteToolCallEnd(String(rawFrame.toolCallId));
        }
        if (!shouldSuppressPausedToolCallUpdate(update, pause)) {
          // Record the emitted tool-call ids (unique, first-seen order): the park folds them
          // into the expected next-history fingerprint so a tool-using turn continues live.
          const frame = update as {
            sessionUpdate?: unknown;
            toolCallId?: unknown;
          };
          if (
            frame?.sessionUpdate === "tool_call" &&
            typeof frame.toolCallId === "string" &&
            frame.toolCallId &&
            !env.lastTurnToolCallIds.includes(frame.toolCallId)
          ) {
            env.lastTurnToolCallIds.push(frame.toolCallId);
          }
          if (
            frame?.sessionUpdate === "tool_call" &&
            typeof frame.toolCallId === "string" &&
            frame.toolCallId
          ) {
            const announced = update as {
              name?: unknown;
              title?: unknown;
              kind?: unknown;
              rawInput?: unknown;
              input?: unknown;
            };
            const existing = approvedExecutionSeeds.get(frame.toolCallId);
            const toolName =
              [announced.name, announced.title, announced.kind].find(
                (value): value is string =>
                  typeof value === "string" && value.length > 0,
              ) ?? existing?.toolName;
            approvedExecutionSeeds.set(frame.toolCallId, {
              toolCallId: frame.toolCallId,
              toolName,
              args: announced.rawInput ?? announced.input ?? existing?.args,
            });
          }
          const toolCallId =
            typeof rawFrame.toolCallId === "string"
              ? rawFrame.toolCallId
              : undefined;
          if (
            pause.active &&
            (rawFrame.sessionUpdate === "tool_call" ||
              rawFrame.sessionUpdate === "tool_call_update") &&
            rawFrame.status === "completed" &&
            toolCallId &&
            !pause.isPausedToolCall(toolCallId) &&
            !pause.isAllowedExecution(toolCallId)
          ) {
            bufferedPausedCompletedFrames.set(toolCallId, update);
            return;
          }
          run.handleUpdate(update);
          if (
            toolCallId &&
            (rawFrame.status === "completed" || rawFrame.status === "failed")
          ) {
            notifyToolCallClosed(toolCallId);
          }
          // A sibling announced after the pause with neither a gate nor an allow cannot execute;
          // the idempotent re-sweep closes it so the client never holds an orphaned part.
          if (pause.active) {
            run.settleOpenToolCalls(
              (id) =>
                pause.isPausedToolCall(id) || pause.isAllowedExecution(id),
              TOOL_NOT_EXECUTED_PAUSED,
            );
          }
        }
      },
      onPermissionRequest: undefined,
    };
    const permissionPlan = permissionsFromRequest(request);
    // Unconditional: an EMPTY decision map on a turn the transcript called a resume is the
    // interesting case, and the old `size > 0` guard was exactly the condition that hid it.
    const storedDecisionMap = extractApprovalDecisions(request, logger);
    // The transcript is not the only place an answer can live: a client that answered out of
    // band, or whose resume never reached us, leaves the decision only on the interactions
    // plane. The caller reads and claims those rows (`loadDurableDecisions`) and hands them in,
    // so this merge is SYNCHRONOUS — see the invariant at the top of this function.
    //
    // History wins: `seedDecisionMap` sets only keys the transcript does not already carry,
    // because an envelope this turn actually received in band is the fresher fact.
    const adopted = seedDecisionMap(
      storedDecisionMap,
      opts.seededDecisions ?? [],
    );
    if (adopted.length) {
      logger(
        `[HITL] seeded decisions from interaction rows: ${JSON.stringify(adopted.map((entry) => entry.key))}`,
      );
    }
    logger(
      `[HITL] resume state: decisions=${JSON.stringify([...storedDecisionMap.keys()])}`,
    );

    activeTurn = turn;
    env.currentTurn = turn;
    const decisions = new ConversationDecisions(
      storedDecisionMap,
      extractClientToolOutputs(request),
    );
    const executionGrants = new ApprovedExecutionGrants();
    const seedApprovedExecution = (seed: ParkedApprovedExecution): void => {
      approvedExecutionSeeds.set(seed.toolCallId, seed);
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId: seed.toolCallId,
        title: seed.toolName,
        kind: seed.toolName,
        rawInput: seed.args,
      });
      pause.markAllowedExecution(seed.toolCallId);
      executionGrants.grant(seed.toolName, seed.args);
    };
    const responder =
      deps.responderFactory?.(request) ??
      new ApprovalResponder(permissionPlan, decisions, logger);
    // Every pause seeds the durable interactions plane, whichever gate paused.
    const recordPendingInteraction = (
      token: string,
      toolName: string | undefined,
      toolArgs: unknown,
      kind: "user_approval" | "client_tool" = "user_approval",
      toolCallId?: string,
    ): void => {
      const cred = runCredential(request);
      if (!cred) return;
      // Every gate leaves a durable inbox/audit row; workflow references are attribution, not a
      // precondition. The row also carries the turn's effective config when the SDK stamped one,
      // so an out-of-band answer replays THIS turn, not the referenced variant's HEAD.
      void createInteraction(
        sessionId,
        request.turnId ?? "",
        token,
        kind,
        buildInteractionData(request, toolName ?? token, toolArgs, toolCallId),
        () => cred,
      );
    };
    // Transition the durable interaction row to resolved once its gate is answered. Used both by
    // the cold decision-map path (via attachPermissionResponder) and the live approval resume,
    // which answers the parked gate directly. The turn-start `cancelStaleInteractions` sweep
    // (server.ts) cancels only PENDING gates of OTHER turns and spares this gate two ways: an
    // interactions-plane answer already transitioned it to responded, and an in-band answer is
    // detected at sweep time (`inBandAnswerToken`) and exempted via the sweep's `tokens` — the
    // row stays pending until this resolve lands it as resolved, never cancelled.
    // Seeded with the tokens the CALLER already claimed. `loadDurableDecisions` resolves a row
    // before adopting its decision, so those rows are terminal before this turn starts, and any
    // further transition on them is a guaranteed 404. Without this seed a healthy run logged
    // `resolve failed ... HTTP 404` every time — an error line for work that had already
    // succeeded, which is worse than noise: it trains the reader to ignore a real failure.
    const resolvedInteractionTokens = new Set<string>(
      (opts.seededDecisions ?? []).map((entry) => entry.token),
    );
    const resolveInteractionToken = (
      token: string,
      verdict?: { approved: boolean; toolCallId: string },
    ): void => {
      const alreadyResolved = resolvedInteractionTokens.has(token);
      resolvedInteractionTokens.add(token);
      if (verdict) {
        run.emitEvent({
          type: "interaction_response",
          id: token,
          kind: "user_approval",
          payload: verdict,
        });
      }
      // The EVENT above still goes out — a re-raised gate answered from a seeded decision is a
      // real answer the UI must see, and suppressing it would leave the approval part stuck in
      // the UI while the run moves on. Only the durable transition is skipped, because the row is
      // already terminal. A claimed token may have emitted this event in an EARLIER turn too, so
      // a client can see it twice for the same id; same id and same payload, so it must be
      // treated as idempotent rather than as two answers.
      if (alreadyResolved) return;
      const cred = runCredential(request);
      if (!cred) return;
      void resolveInteraction(
        sessionId,
        token,
        () => cred,
        verdict
          ? {
              verdict: verdict.approved ? "approved" : "denied",
              tool_call_id: verdict.toolCallId,
            }
          : undefined,
      );
    };
    // A resume's approval envelope is a CONSUMED decision even when the harness never re-raises
    // the gate: on a cold replay the transcript already contains the human's answer, so the agent
    // just proceeds and no reply path ever reaches `resolveInteractionToken`. That is exactly how a
    // gate outlives its turn as a forever-actionable `pending` row. Settle the leftovers here, with
    // the verdict the human actually gave, so the row lands `resolved` and not `cancelled`. A row
    // already terminal (resolved by the reply path, or cancelled by the turn-start sweep) simply
    // 404s the transition — the CAS is the arbiter, this is only a last writer.
    //
    // Deliberately does NOT go through `resolveInteractionToken`: that emits an
    // `interaction_response` event, and this can run once the turn's event stream is closed,
    // which would land a record after the turn's terminal `done`. The durable row is the only
    // thing to fix.
    //
    // Awaited, and awaited BEFORE the terminal record is emitted. `record()` hands `done`
    // straight to the sink, so the moment `finish()` runs the API's gate reconciliation may
    // consume it and cancel this still-pending row — after which the transition below finds a
    // terminal row and 404s, filing a decision the human actually made as an abandonment.
    settleInBandInteractions = async (): Promise<void> => {
      const cred = runCredential(request);
      if (!cred) return;
      const settling: Promise<unknown>[] = [];
      for (const answer of extractInBandApprovalAnswers(request)) {
        if (resolvedInteractionTokens.has(answer.token)) continue;
        resolvedInteractionTokens.add(answer.token);
        logger(
          `[HITL] settling in-band answer with no harness gate token=${answer.token} ` +
            `approved=${answer.approved}`,
        );
        settling.push(
          resolveInteraction(sessionId, answer.token, () => cred, {
            verdict: answer.approved ? "approved" : "denied",
            tool_call_id: answer.toolCallId,
          }),
        );
      }
      await Promise.all(settling);
    };
    const serverPermissions = serverPermissionsFromRequest(request);
    // The SAME name->spec index the relay execute loop hands to the relay execution guard, so
    // the approval card and the guard cannot disagree about a tool's permission/readOnly.
    const specsByName = toolSpecsByName(plan.tools.toolSpecs);
    const settleBufferedPausedCompletions = (): void => {
      for (const [toolCallId, update] of [
        ...bufferedPausedCompletedFrames.entries(),
      ]) {
        bufferedPausedCompletedFrames.delete(toolCallId);
        if (pause.isPausedToolCall(toolCallId)) continue;
        if (pause.isAllowedExecution(toolCallId)) {
          run.handleUpdate(update);
          notifyToolCallClosed(toolCallId);
          continue;
        }
        const frame = update as {
          sessionUpdate?: unknown;
          name?: unknown;
          title?: unknown;
          kind?: unknown;
          rawInput?: unknown;
          input?: unknown;
        };
        const { gate } = buildGateDescriptor(
          // No ACP permission request frame exists for a buffered completion re-check; the
          // tool-call frame alone carries the identity.
          undefined,
          {
            toolCallId,
            name: frame.name,
            title: frame.title,
            kind: frame.kind,
            rawInput: frame.rawInput,
            input: frame.input,
          },
          run,
          serverPermissions,
          specsByName,
          plan.acpAgent === "codex",
        );
        const permission = effectivePermission(gate, permissionPlan);
        if (permission === "allow") {
          run.handleUpdate(update);
          notifyToolCallClosed(toolCallId);
          continue;
        }
        // Execution of an ask-policy call requires an answered allow; both harness gate paths fail
        // closed. A completed frame during a pause for an unanswered ask-policy call is therefore
        // a cancellation-closure artifact, not evidence of execution.
        if (
          frame.sessionUpdate === "tool_call" &&
          !openToolCallIds().includes(toolCallId)
        ) {
          run.handleUpdate({
            ...(update as Record<string, unknown>),
            status: undefined,
          });
        }
        run.settleOpenToolCalls(
          (id) => id !== toolCallId,
          TOOL_NOT_EXECUTED_PAUSED,
        );
      }
    };
    // `@ag.file` markers: resolve and freeze at the gate, verify and consume at the relay. The
    // relay hook runs on EVERY harness and does not depend on a dialog, which is what keeps a
    // forged request file from executing a commit the guard's non-Pi `ask` pass-through would
    // otherwise let through. Built before the responder because the gate hook is one of its
    // callbacks.
    env.commitAuthorization ??= createCommitAuthorizationState();
    const approvedContent = buildApprovedContentWiring({
      state: env.commitAuthorization,
      isDaytona: plan.isDaytona,
      workspaceCwd: plan.workspace.cwd,
      sandbox: env.sandbox,
      callback: request.toolCallback as ToolCallbackContext | undefined,
      runContext: request.runContext,
      permissionPlan,
      toolSpecs: plan.tools.toolSpecs,
      turnId: request.turnId ?? "",
      sessionId,
      log: logger,
    });

    // Build the per-turn permission handler WITHOUT attaching to the live session: the
    // session-lifetime `onPermissionRequest` (in acquireEnvironment) routes into it via
    // `currentTurn`. A capturing shim reuses attachPermissionResponder unchanged; its
    // respondPermission delegates to the real session.
    attachPermissionResponder({
      session: {
        onPermissionRequest: (handler: (req: unknown) => void) => {
          turn.onPermissionRequest = handler;
        },
        respondPermission: (id: string, reply: string) =>
          env.session.respondPermission(id, reply),
      },
      run,
      responder,
      acpAgent: plan.acpAgent,
      serverPermissions,
      log: logger,
      onPause: () => pause.pause(),
      onPausedToolCall: (id) => pause.markPausedToolCall(id),
      onAllowedExecution: (id) => pause.markAllowedExecution(id),
      onAnsweredDeny: (id) => {
        pause.markAnsweredDeny(id);
        // A denied call keeps no approved content. See `onDenied`.
        approvedContent.onDenied(id);
      },
      onNonParkablePause: () => {
        env.nonParkablePauseCount += 1;
      },
      onCreateInteraction: recordPendingInteraction,
      onResolveInteraction: resolveInteractionToken,
      toolSpecsByName: specsByName,
      // Pi runs only: presence of the specs map turns Pi gate envelope detection on AND is how
      // the runner recovers specPermission/readOnlyHint (the envelope carries identity, never
      // policy). Absent for Claude, so a title collision there keeps the base path.
      piToolSpecsByName: plan.isPi
        ? new Map(
            plan.tools.toolSpecs.map((spec) => [
              spec.name,
              {
                permission: spec.permission,
                readOnly: spec.readOnly,
                // callRef tools only: bound paths are runner-filled at execution, so the
                // approval card and decision keys must not carry the model's values for them.
                contextBindings: spec.callRef
                  ? spec.contextBindings
                  : undefined,
              },
            ]),
          )
        : undefined,
      // A resolved custom-tool allow becomes an execution grant the relay guard consumes, so
      // only a dialog-approved (or policy-allowed) call ever executes from the relay dir.
      onPiGateAllowed: (info) =>
        executionGrants.grant(info.toolName, info.args),
      // A Claude/Codex allow for a runner-executed tool becomes an execution grant too, but for
      // the loopback MCP seam rather than the relay: the harness gate has already decided this
      // call, so the seam consumes the grant instead of asking the human a second time.
      onExecutableGateAllowed: (info) =>
        executionGrants.grant(info.toolName, info.args),
      // Runs only after a non-deny verdict, and only for a gate about to pause: a denied call
      // must perform zero workspace reads.
      onResolveApprovedContent: approvedContent.onResolveApprovedContent,
      shouldRegateStaleApproval: approvedContent.shouldRegateStaleApproval,
      // Record EVERY parkable permission gate (only in keep-alive park mode) so the dispatch can
      // resume each one live. Fires per pending gate, so parallel gated tool calls in one turn
      // all park, each keyed by its own tool-call id. `info.gateType` names the ACP gate type so
      // the resume answers on the right plane. `approvalGateCount` counts every gate; a gate that
      // lacked a resumable id is counted but not recorded, so the dispatch can tell "every gate
      // is resumable" (count === map size) from "a gate cannot be resumed live".
      onUserApprovalGate: opts.approvalParkMode
        ? (info) => {
            env.approvalGateCount += 1;
            if (!info.permissionId || !info.toolCallId) return;
            const record: ParkedApproval = {
              gateType: info.gateType,
              permissionId: info.permissionId,
              toolCallId: info.toolCallId,
              toolName: info.toolName,
              args: info.args,
              interactionToken: info.interactionToken,
            };
            env.parkedApprovals.set(info.toolCallId, record);
            // The first recorded gate is the per-turn representative for logging and the
            // per-turn-uniform validation reads (gate type, history, credentials).
            env.parkedApproval ??= record;
          }
        : undefined,
    });

    // Non-Pi loopback tools use the correlation index; Pi's relay toolCallId is already exact.
    env.clientToolRelayRef.current = buildClientToolRelay({
      responder,
      run,
      pause,
      recordPendingInteraction,
      toolCallIndex: plan.isPi ? undefined : env.toolCallIndex,
      onNonParkablePause: () => {
        env.nonParkablePauseCount += 1;
      },
      log: logger,
    });
    env.executableToolGateRef.current =
      !plan.isPi && !plan.isDaytona
        ? buildExecutableToolGate({
            responder,
            run,
            pause,
            recordPendingInteraction,
            toolCallIndex: env.toolCallIndex,
            permissionPlan,
            executionGrants,
            log: logger,
          })
        : undefined;

    // The relay dir is sandbox-writable, so every harness rechecks the hard deny boundary
    // against forged files. `ask` consumes a Pi grant but passes for non-Pi after the local
    // loopback gate or Claude's Daytona ACP gate; Codex Daytona remains outside this slice.
    const relayGuard: RelayExecutionGuard = buildRelayExecutionGuard({
      isPi: plan.isPi,
      permissionPlan,
      executionGrants,
    });

    // The semantic gateway gate. It is wired for EVERY harness and every placement, because the
    // relay seam it runs at is the one point all of them pass through and no dialog upstream has
    // decided anything about the integration tool the model named.
    const gatewayGate = buildGatewayToolGate({
      responder,
      run,
      pause,
      recordPendingInteraction,
      toolCallIndex: plan.isPi ? undefined : env.toolCallIndex,
      permissionPlan,
      onNonParkablePause: () => {
        env.nonParkablePauseCount += 1;
      },
      log: logger,
    });

    if (plan.tools.useToolRelay) {
      turn.toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(env.sandbox, {
              log: logger,
            })
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.workspace.relayDir,
        plan.tools.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
        toolRunContext,
        env.clientToolRelayRef.current,
        relayGuard,
        {
          log: logger,
          // Derived from the run plan's client-tool pause disposition (the closed set lives at
          // the client-tool boundary; the relay only needs the boolean).
          writePausedAnswer: relayWritesPausedAnswer(
            plan.tools.clientToolPauseDisposition,
          ),
          authorizer: approvedContent.authorizer,
          gatewayPolicy: request.gatewayPolicy,
          gatewayGate,
        },
      );
      // Ordering invariant: the relay's stale-file sweep must complete before the
      // resume's respondPermission or the fresh prompt below can cause a legitimate
      // request, so nothing legitimate can predate the sweep and be swallowed as
      // stale. Optional-chained so a fake relay without `ready` is tolerated, and a
      // sweep failure never kills the turn.
      await turn.toolRelay?.ready?.catch?.(() => {});
    }

    // Capture the append-only transcript boundary before this turn can write into it. Recovery
    // must never attribute an error already present here to the prompt below.
    const piSessionId = env.session?.agentSessionId;
    const piTranscriptCursor =
      plan.isPi && piSessionId
        ? await (plan.isDaytona
            ? capturePiTranscriptCursor(plan.workspace.cwd, piSessionId, {
                sandbox: env.sandbox,
              })
            : capturePiTranscriptCursor(plan.workspace.cwd, piSessionId))
        : undefined;

    // The prompt promise this turn races against the pause signal. A normal/continuation turn
    // sends a fresh prompt; a live approval resume answers the parked gate on the SAME session and
    // continues the ORIGINAL, still-pending prompt promise (the tool then runs with its original
    // byte-exact args). Either way, on a HITL pause the prompt resolves cancelled or never
    // resolves, and the pause signal ends the turn.
    let promptPromise: Promise<unknown>;
    // When the prompt was issued, so a reap after a Stop can tell a process this turn started
    // from one the SESSION started earlier (an stdio MCP server). A resumed turn keeps the
    // resume's own start, which only ever makes the reap more conservative. See `reap-exec.ts`.
    let promptStartedAtMs = Date.now();
    if (opts.resume) {
      // The resume turn owns continued events; each decision answers one parked gate by id.
      // Carried gates keep the shared original prompt pending until a later answer.
      const decisions = opts.resume.decisions;
      promptPromise = Promise.resolve(decisions[0]?.promptPromise);
      promptPromise.catch(() => {});
      for (const seed of carriedApprovedExecutions) {
        seedApprovedExecution(seed);
      }
      for (const decision of decisions) {
        // Seed this run's trace with the parked tool call so the completing `tool_call_update`
        // closes it and the FE approval part flips to output-available even if the adapter
        // re-announces nothing.
        run.handleUpdate({
          sessionUpdate: "tool_call",
          toolCallId: decision.toolCallId,
          title: decision.toolName,
          kind: decision.toolName,
          rawInput: decision.args,
        });
        // A parked Pi dialog gate resumes on a FRESH turn whose relay and grant ledger are new;
        // grant the approved call here so the extension's execute record (written right after the
        // confirm resolves) passes the relay guard. Claude resumes grant too — harmlessly, no
        // guard consults it.
        if (decision.reply === "once") {
          approvedExecutionSeeds.set(decision.toolCallId, {
            toolCallId: decision.toolCallId,
            toolName: decision.toolName,
            args: decision.args,
          });
          pause.markAllowedExecution(decision.toolCallId);
          executionGrants.grant(decision.toolName, decision.args);
        }
        // A live-resume deny closes the seeded call as a failed tool call; flag it so the egress
        // projects `tool-output-denied` (a decline), mirroring the cold decision-map deny path.
        if (decision.reply === "reject") {
          run.markToolCallDenied(decision.toolCallId);
          pause.markAnsweredDeny(decision.toolCallId);
          // Before the harness is answered, and for the same reason as the ACP deny path above:
          // the records this call parked on must not outlive the human's "no".
          approvedContent.onDenied(decision.toolCallId);
        }
        // Answer this gate on the live session. Each parked gate holds its OWN pending
        // `respondPermission` on the harness, so answering them one by one settles each
        // independently — an approve and a deny in the same turn each land on the right call.
        await env.session.respondPermission(
          decision.permissionId,
          decision.reply,
        );
        // The gate is answered: resolve its durable interaction row (the parked pending row the
        // cold path would otherwise resolve via its decision map). Only carried-forward ids were
        // re-marked paused, so answered calls stream their terminal frames normally.
        resolveInteractionToken(decision.interactionToken, {
          approved: decision.reply === "once",
          toolCallId: decision.toolCallId,
        });
        logger(
          `[keepalive] resume answered gate reply=${decision.reply} tool=${decision.toolName ?? "?"}`,
        );
      }
      // The harness still holds carried gates inside the original prompt, so the turn must end
      // paused again — but pause() both destroys the live session and settles the race signal
      // below, so pausing here would kill a freshly-approved execution mid-flight and the
      // paused-settle would replace its REAL result with the UNKNOWN sentinel (issue #5907).
      // Give each answered/allowed execution its closure window FIRST, on the same per-call
      // bound the paused-settle uses, then re-arm the pause and let the normal park path
      // refresh the carried gates' approval TTL. Pi is exempt on purpose: it prepares the whole
      // batch before executing any call, so while a carried sibling gate is pending closure is
      // impossible and the paused-settle's park-and-carry branch owns those spans.
      if (opts.resume.carriedForward.length > 0) {
        if (!plan.isPi) {
          const answeredAllowedIds = decisions
            .filter((decision) => decision.reply === "once")
            .map((decision) => decision.toolCallId);
          await Promise.all(
            answeredAllowedIds.map((toolCallId) =>
              waitForToolCallClosure(toolCallId, resolvedRunLimits.toolCallMs),
            ),
          );
        }
        pause.pause();
      }
    } else {
      promptStartedAtMs = Date.now();
      promptPromise = Promise.resolve(env.session.prompt(promptBlocks));
      promptPromise.catch(() => {});
    }
    // A user Stop aborts `signal`. That abort does NOT reach the harness: the signal is handed to
    // `SandboxAgent.start` for its health wait only, never to the ACP transport or the prompt
    // request, so the prompt promise below stays pending and the harness keeps working. (An earlier
    // comment here claimed the abort severed the harness fetch. It does not, which is why the
    // cancelled branch has to send a real `session/cancel` — see `cancel-turn.ts`.)
    //
    // So the race is won by the abort event itself. Resolve to CANCELLED both when the abort lands
    // first AND when the prompt rejection lands first while already aborted, so the outcome is
    // deterministic regardless of ordering. A real (non-abort) prompt rejection is re-thrown into
    // the shared catch.
    const cancelled = new Promise<typeof CANCELLED>((resolve) => {
      if (signal?.aborted) resolve(CANCELLED);
      else
        signal?.addEventListener("abort", () => resolve(CANCELLED), {
          once: true,
        });
    });
    const raced = await Promise.race([
      promptPromise.then(
        (value) => value,
        (err) => (signal?.aborted ? CANCELLED : Promise.reject(err)),
      ),
      pause.signal.then(() => PAUSED),
      runLimitTripped.then(() => RUN_LIMIT_TRIPPED),
      cancelled,
    ]);
    // A tripped run-limit ends the turn as an error: throw into the shared catch below so the
    // trace is flushed and the caller's teardown reclaims the (wedged) sandbox.
    if (raced === RUN_LIMIT_TRIPPED) {
      throw new Error(runLimitReason ?? "run limit tripped");
    }
    const stopReason =
      raced === CANCELLED
        ? "cancelled"
        : raced === PAUSED || pause.active
          ? "paused"
          : (raced as any)?.stopReason;
    // Terminalization drains queued gates, classifies pause-time completions, and gives allowed
    // executions their original per-call bound before the orphan sweep closes the turn.
    if (stopReason === "paused") {
      await pause.waitForEventDrain();
      settleBufferedPausedCompletions();
      // A gateway run passes TWO gates on ONE tool-call id: the ACP gate on the outer `run_tool`,
      // whose spec permission is `allow` and which therefore marks an allowed execution, and the
      // gateway's semantic gate on the TARGET action, which answers `ask` and parks that same id.
      // A call that is both cannot close — the human has not answered yet — so waiting for its
      // closure burns the whole tool-call bound before the turn can end. Exclude it here, at the
      // computation, rather than at the wait below: this list also seeds `parkedApprovedExecutions`
      // on the Pi batch branch, where a parked call has no seed and would be carried and
      // re-announced next turn as an approved execution it never was.
      // Before the gateway, allowed and paused were disjoint by construction.
      const openAllowedExecutions = openToolCallIds().filter(
        (id) => pause.isAllowedExecution(id) && !pause.isPausedToolCall(id),
      );
      const piBatchBlockedByApproval = Boolean(
        opts.resume &&
        plan.isPi &&
        opts.approvalParkMode &&
        env.parkedApprovals.size > 0,
      );
      if (piBatchBlockedByApproval) {
        // Pi prepares every call in a parallel batch before it executes any of them. While a
        // sibling gate is pending, closure is impossible, so carry the approved spans and park.
        for (const toolCallId of openAllowedExecutions) {
          const seed = approvedExecutionSeeds.get(toolCallId) ?? {
            toolCallId,
            toolName: undefined,
            args: undefined,
          };
          parkedApprovedExecutions.set(toolCallId, seed);
          run.settleOpenToolCalls(
            (id) => id !== toolCallId,
            APPROVED_EXECUTION_RESULT_UNKNOWN,
          );
        }
      } else {
        await Promise.all(
          openAllowedExecutions.map(async (toolCallId) => {
            const closed = await waitForToolCallClosure(
              toolCallId,
              resolvedRunLimits.toolCallMs,
            );
            if (closed) return;
            run.settleOpenToolCalls(
              (id) => id !== toolCallId,
              APPROVED_EXECUTION_RESULT_UNKNOWN,
            );
          }),
        );
      }
      settleBufferedPausedCompletions();
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id) || pause.isAllowedExecution(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
      const unexpectedOpenToolCallIds = openToolCallIds().filter(
        (id) => !pause.isPausedToolCall(id),
      );
      if (unexpectedOpenToolCallIds.length > 0) {
        logger(
          "[HITL] paused-turn transcript invariant left non-gated calls open: " +
            unexpectedOpenToolCallIds.join(","),
        );
      }
    }
    if (stopReason === "cancelled") {
      // Tell the HARNESS to stop before anything else. The abort only made the runner stop
      // waiting; without this the harness still holds an open prompt and a running tool, and the
      // sandbox could never be parked. A settled cancel is what earns the warm park below; see
      // `cancel-turn.ts`.
      const cancel = await cancelHarnessTurn({
        sandbox: env.sandbox,
        sessionId: env.session?.id,
        promptPromise,
        log: logger,
      });
      cancelSettled = cancel.settled;
      // Codex leaves its shell child running inside the sandbox we are about to park; Pi and
      // Claude kill theirs. Reap it here, never in the bridge: the Codex shell is a child of a
      // vendored Rust binary the JS bridge holds no pid for, and a bridge patch would ship only
      // through a Daytona snapshot rebuild. Best effort, and it cannot change the park decision.
      if (cancel.settled && plan.acpAgent === "codex") {
        await reapLeakedExecChildren({
          sandbox: env.sandbox,
          turnElapsedMs: Date.now() - promptStartedAtMs,
          log: logger,
        }).catch(() => undefined);
      }
      // The harness has been asked to stop, so the Pi trace port and the environment teardown must
      // not ask again. Their `destroySession` also aborts `env.mcpAbort`, which belongs to the
      // ENVIRONMENT and must survive a park (the approval-park path skips it for the same reason).
      if (cancel.requested) env.sessionDestroyRequested = true;
      // The user Stopped the turn: let any in-flight frames settle, honor real completions that
      // already arrived, then settle every STILL-open tool call with the interrupt sentinel so the
      // transcript closes HONESTLY — no orphaned "running" parts, no synthetic success. A deliberate
      // human halt is not retryable; steer surfaces any new instruction as the next turn's prompt.
      await pause.waitForEventDrain().catch(() => {});
      settleBufferedPausedCompletions();
      run.settleOpenToolCalls(() => false, INTERRUPTED_BY_USER);
    }
    const result = raced === PAUSED || raced === CANCELLED ? undefined : raced;
    // A parkable pause this turn: hand the still-pending prompt promise to EVERY parked record so a
    // later resume can await the same continuation (there is one prompt per turn, so every gate
    // shares it). Set after the race so `promptPromise` exists.
    if (opts.approvalParkMode && pause.active && env.parkedApprovals.size > 0) {
      for (const record of env.parkedApprovals.values()) {
        record.promptPromise = promptPromise;
      }
    }
    await turn.toolRelay?.stop();
    if (stopReason === "cancelled") {
      // `agent_end` publishes Pi's partial native trace. Ask the adapter to finish that lifecycle
      // before draining; the outer environment teardown would otherwise cancel Pi only after the
      // spool had already timed out and then sweep the late batch.
      await harnessTrace.cancelBeforeDrain();
    }
    logger(`prompt stopReason=${stopReason}`);

    // Pi publishes the usage sidecar immediately before its native trace batch. Draining that
    // batch first is therefore the cross-filesystem publication barrier for both local and
    // Daytona runs. Runner-traced harnesses still need usage before trace finalization so the
    // runner can stamp it on its own span.
    let traceFinish =
      plan.isPi && stopReason !== "paused"
        ? await harnessTrace.finish()
        : undefined;
    const usage = await resolveRunUsage({
      sandbox: env.sandbox,
      usageOutPath: plan.workspace.usageOutPath,
      isDaytona: plan.isDaytona,
      promptResult: result,
      streamUsage: run.usage(),
    });
    run.setUsage(usage);
    if (!plan.isPi && stopReason !== "paused") {
      traceFinish = await harnessTrace.finish();
    }
    const nativeTraceBatches = traceFinish?.pickedUpBatches;

    // A retried turn is empty too. pi-acp streams "Retrying (attempt 1/3, waiting 2s)..." as an
    // assistant message chunk, so a provider refusal that Pi retries leaves `output()` non-empty
    // with chatter alone — which used to skip the recovery below and ship that chatter as the
    // turn's answer. See `isOnlyHarnessRetryNotices`.
    const visibleOutput = run.output().trim();
    const swallowedPiError =
      plan.isPi &&
      stopReason === "end_turn" &&
      piTranscriptCursor &&
      (!visibleOutput || isOnlyHarnessRetryNotices(visibleOutput)) &&
      !run.events().some((e) => e.type === "tool_call")
        ? // The helper derives the transcript location from
          // `piSessionWorkspaceDir(plan.workspace.cwd)`, the same shared helper
          // `configurePiSessionWorkspace` used to point Pi at it. On Daytona the
          // transcript lives inside the remote sandbox, so it is read through the
          // sandbox's file API here, before teardown takes the only copy with it.
          await (plan.isDaytona
            ? findSwallowedPiError(plan.workspace.cwd, piTranscriptCursor, {
                sandbox: env.sandbox,
              })
            : findSwallowedPiError(plan.workspace.cwd, piTranscriptCursor))
        : undefined;
    let swallowedError: string | undefined;
    if (swallowedPiError) {
      const classified = classifyRunError(
        new Error(swallowedPiError),
        plan.harness,
        request.modelConnection?.provider,
        {
          connection: {
            slug: request.connection?.slug,
            deployment: request.modelConnection?.deployment,
          },
          // The recovery path needs the same signal as the catch below. Pi records the
          // provider's refusal in its transcript and ends the turn cleanly, so a credential
          // race that arrives THIS way is the identical failure wearing a different shape —
          // and without the predicate it would still be reported as the user's key problem.
          daytonaCredentialFresh: reportCredentialRace,
        },
      );
      swallowedError = classified.message;
      run.recordError(swallowedError, request.modelConnection?.provider);
      run.emitEvent({
        type: "error",
        message: classified.message,
        code: classified.code,
      });
    }
    if (nativeTraceBatches === 0 && !swallowedError) {
      await harnessTrace.emitMissingBatchFallback(run);
    }

    // Before `finish()`, which emits the terminal `done` the API reconciles gates against.
    await settleInBandInteractions?.();
    const output = run.finish(stopReason);
    await run.flush();
    const turnEndedAt = new Date().toISOString();

    if (swallowedError) {
      // A failed turn may have left a partial turn in the native transcript: the prior record
      // is no longer a faithful resume point.
      invalidateContinuity(sessionId, plan.harness, deps);
      return { ok: false, error: swallowedError };
    }

    // A pause has not finished authoring the turn, so only a completed execution can advance the
    // in-memory resume pointer or complete the durable ledger row.
    if (
      stopReason !== "paused" &&
      stopReason !== "cancelled" &&
      env.continuityTurnIndex !== undefined &&
      sessionId
    ) {
      const agentSessionId = env.session?.agentSessionId;
      if (agentSessionId) {
        (deps.sessionContinuityStore ?? sessionContinuityStore).record(
          sessionId,
          plan.harness,
          agentSessionId,
          env.continuityTurnIndex,
        );
      }

      const completeTurn = sessionTurnClient.complete;
      if (turnLedgerContext && completeTurn) {
        await completeTurn(
          turnLedgerContext.sessionId,
          turnLedgerContext.turnIndex,
          {
            agentSessionId,
            endTime: turnEndedAt,
          },
          { authorization: turnLedgerContext.authorization, log: logger },
        ).catch(() => {});
      }
    } else if (stopReason === "paused" || stopReason === "cancelled") {
      // A pause/cancel stopped mid-turn, after the harness may have written a partial turn natively.
      invalidateContinuity(sessionId, plan.harness, deps);
    }

    return {
      ok: true,
      output,
      messages: output ? [{ role: "assistant", content: output }] : [],
      events: emit ? [] : run.events(),
      usage,
      stopReason,
      ...(stopReason === "cancelled" ? { cancelSettled } : {}),
      capabilities: {
        ...env.capabilities,
        streamingDeltas: !!emit && env.capabilities.streamingDeltas,
      },
      sessionId,
      model: env.model ?? request.model,
      traceId: resultTraceId,
    } as AgentRunResult;
  } catch (err) {
    const classified = classifyRunError(
      err,
      plan.harness,
      request.modelConnection?.provider,
      {
        authFault: () => describeCodexSubscriptionAuthFault(plan),
        connection: {
          slug: request.connection?.slug,
          deployment: request.modelConnection?.deployment,
        },
        daytonaCredentialFresh: reportCredentialRace,
      },
    );
    const error = classified.message;
    await harnessTrace.cancelBeforeDrain();
    const traceFinish = await harnessTrace.finish();
    const nativeTraceBatches = traceFinish?.pickedUpBatches;
    // A valid native Pi batch already carries the harness failure. Otherwise preserve the
    // runner-owned error and usage fallback under the caller trace context.
    if (harnessTrace.runnerEmitsSpans) {
      otel?.recordError(error, request.modelConnection?.provider);
    } else if (nativeTraceBatches === 0) {
      await harnessTrace.emitMissingBatchFallback(otel, error);
    }
    otel?.emitEvent({
      type: "error",
      message: error,
      code: classified.code,
    });
    // An aborted turn may have left a partial turn in the native transcript.
    invalidateContinuity(sessionId, plan.harness, deps);
    // Same ordering as the happy path: settle the durable rows before the terminal record goes out.
    await settleInBandInteractions?.();
    // finish() must not throw uncaught — tracing must not mask the run error.
    try {
      otel?.finish();
    } catch {}
    await otel?.flush().catch(() => {});
    return { ok: false, error };
  } finally {
    platformCredentialLease?.release();
    // Backstop for the exits that reach neither branch above (cancel, abort). Idempotent via the
    // resolved-token set, so the ordered calls make this a no-op on the paths that took them, and
    // never throws — a row whose gate is gone is unanswerable however the turn ended.
    void settleInBandInteractions?.();
    // Release every run-limits timer (idempotent, never re-arms on a late event) on EVERY path.
    runLimits.dispose();
    // Same contract for the sandbox liveness probe: one timer, released on EVERY path.
    sandboxLiveness?.dispose();
    // This turn owns its relay: stop it on EVERY exit path (the happy path already stopped it
    // after the prompt; stop is safe to repeat, matching the old finally). Null it afterwards so
    // a later `destroy()` — possibly after the dispatch cleared the sink — cannot double-stop or
    // orphan it.
    await activeTurn?.toolRelay?.stop().catch(() => {});
    if (activeTurn) activeTurn.toolRelay = undefined;
    // Release the turn's frozen approval bytes unless a gate parked on them. A parked approval
    // is the ONE case that must survive: the human is about to answer it, and the resume commits
    // the exact bytes they saw. Everything else — a finished turn, an abort, a denial, a crash —
    // drops the whole store, which is the backstop against a long-lived parked session leaking
    // megabytes of frozen content.
    if (env.parkedApprovals.size === 0) env.commitAuthorization = undefined;
  }
}
