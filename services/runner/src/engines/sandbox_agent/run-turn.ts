import {
  effectivePermission,
  permissionsFromRequest,
} from "../../permission-plan.ts";
import {
  resolvePromptText,
  type AgentRunRequest,
  type AgentRunResult,
  type EmitEvent,
  type ToolCallbackContext,
} from "../../protocol.ts";
import { seedForRun } from "../../redaction.ts";
import {
  ApprovalResponder,
  ApprovedExecutionGrants,
  ConversationDecisions,
  extractApprovalDecisions,
  extractClientToolOutputs,
} from "../../responder.ts";
import {
  buildWorkflowReferences,
  createInteraction,
  resolveInteraction,
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
import { invalidateContinuity } from "./environment.ts";
import { conciseError } from "./errors.ts";
import {
  PAUSED,
  PendingApprovalPauseController,
} from "./pause.ts";
import { findSwallowedPiError } from "./pi-error.ts";
import { buildRelayExecutionGuard } from "./relay-guard.ts";
import {
  createRunLimits,
  resolveRunLimits,
} from "./run-limits.ts";
import {
  RUN_LIMIT_TRIPPED,
  sendLastMessageOnly,
  type CurrentTurn,
  type ParkedApproval,
  type RunTurnOptions,
  type SessionEnvironment,
} from "./runtime-contracts.ts";
import {
  runCredential,
  serverPermissionsFromRequest,
  shouldSuppressPausedToolCallUpdate,
} from "./runtime-policy.ts";
import {
  appendSessionTurn,
} from "./session-continuity-durable.ts";
import {
  nextTurnIndex,
  sessionContinuityStore,
} from "./session-continuity.ts";
import { priorMessages } from "./transcript.ts";
import { resolveRunUsage } from "./usage.ts";

/**
 * Run one turn against an acquired environment: start a fresh otel run, wire this turn's pause
 * controller / decisions / responder into `env.currentTurn`, restart the tool relay,
 * send the prompt, resolve usage, and finish + flush the trace. It does NOT tear down the
 * environment (the caller owns `env.destroy`). On a continuation the prompt is only the new user
 * text (`buildTurnText` does not run); on a cold turn it is `plan.turnText`, exactly as before.
 */
export async function runTurn(
  env: SessionEnvironment,
  request: AgentRunRequest,
  emit?: EmitEvent,
  signal?: AbortSignal,
  opts: RunTurnOptions = {},
): Promise<AgentRunResult> {
  const { plan, logger, deps } = env;
  const sessionId = env.sessionId;
  const continuityStore = deps.sessionContinuityStore ?? sessionContinuityStore;
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
  // turn re-records them only if it pauses on ACP permission gates. (The dispatch has already
  // captured any prior park into `opts.resume` before calling us.)
  env.parkedApprovals.clear();
  env.parkedApproval = undefined;
  env.approvalGateCount = 0;
  env.nonParkablePauseCount = 0;
  // Hoisted so the catch can flush a partial trace (mirroring the pre-split `otel?` handling —
  // a createOtel throw must still return `{ ok: false }`, not propagate raw) and the finally can
  // stop this turn's relay on EVERY exit path (a cleared sink must never orphan it).
  let otel: ReturnType<typeof createSandboxAgentOtel> | undefined;
  let activeTurn: CurrentTurn | undefined;

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

  try {
    const promptText = resolvePromptText(request);
    // Cold: replay the full transcript (plan.turnText). Continuation or loaded: send only new text.
    const turnText = sendLastMessageOnly(opts) ? promptText : plan.turnText;

    const run = (deps.createOtel ?? createSandboxAgentOtel)({
      harness: plan.harness,
      model: env.model,
      skills: plan.skillDirs.map((s) => s.name),
      traceparent: request.context?.propagation?.traceparent,
      baggage: request.context?.propagation?.baggage,
      endpoint: request.telemetry?.exporters?.otlp?.endpoint,
      authorization: request.telemetry?.exporters?.otlp?.headers?.authorization,
      captureContent: request.telemetry?.capture?.content?.enabled,
      // Seed from the keys actually APPLIED to this run (`plan.secrets`) plus the mount's STS
      // pair — neither lives in the sidecar's process env.
      redactor: seedForRun(
        { secrets: plan.secrets, telemetry: request.telemetry },
        [
          env.mountCreds?.accessKey,
          env.mountCreds?.secretKey,
          env.mountCreds?.sessionToken,
        ],
      ),
      emitSpans: !plan.isPi || plan.isDaytona,
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
      const workflowRefs = buildWorkflowReferences(
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
          references: workflowRefs ? Object.values(workflowRefs) : undefined,
          traceId:
            run.traceId() ?? request.runContext?.trace?.trace_id,
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
    activeTurn = turn;
    env.currentTurn = turn;

    const permissionPlan = permissionsFromRequest(request);
    const storedDecisionMap = extractApprovalDecisions(request);
    if (storedDecisionMap.size > 0) {
      logger(
        `[HITL] resume state: decisions=${JSON.stringify([...storedDecisionMap.keys()])}`,
      );
    }
    const decisions = new ConversationDecisions(
      storedDecisionMap,
      extractClientToolOutputs(request),
    );
    const executionGrants = new ApprovedExecutionGrants();
    const responder =
      deps.responderFactory?.(request) ??
      new ApprovalResponder(permissionPlan, decisions, logger);
    // Every pause seeds the durable interactions plane, whichever gate paused.
    const recordPendingInteraction = (
      token: string,
      toolName: string | undefined,
      toolArgs: unknown,
      kind: "user_approval" | "client_tool" = "user_approval",
    ): void => {
      const cred = runCredential(request);
      if (!cred) return;
      const references = buildWorkflowReferences(request.runContext?.workflow);
      // Every gate leaves a durable inbox/audit row; workflow references are attribution, not a precondition.
      void createInteraction(
        sessionId,
        request.turnId ?? "",
        token,
        kind,
        { request: { tool: toolName ?? token, args: toolArgs }, references },
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
    const resolveInteractionToken = (
      token: string,
      verdict?: { approved: boolean; toolCallId: string },
    ): void => {
      if (verdict) {
        run.emitEvent({
          type: "interaction_response",
          id: token,
          kind: "user_approval",
          payload: verdict,
        });
      }
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
    const serverPermissions = serverPermissionsFromRequest(request);
    // The SAME name->spec index the relay execute loop hands to the relay execution guard, so
    // the approval card and the guard cannot disagree about a tool's permission/readOnly.
    const specsByName = toolSpecsByName(plan.toolSpecs);
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
      serverPermissions,
      log: logger,
      onPause: () => pause.pause(),
      onPausedToolCall: (id) => pause.markPausedToolCall(id),
      onAllowedExecution: (id) => pause.markAllowedExecution(id),
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
            plan.toolSpecs.map((spec) => [
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
      // Record EVERY parkable permission gate (only in keep-alive park mode) so the dispatch can
      // resume each one live. Fires per pending gate, so parallel gated tool calls in one turn
      // all park, each keyed by its own tool-call id. `info.gateType` names the plane (Claude ACP
      // vs Pi ACP) so the resume answers on the right one. `approvalGateCount` counts every gate;
      // a gate that lacked a resumable id is counted but not recorded, so the dispatch can tell
      // "every gate is resumable" (count === map size) from "a gate cannot be resumed live".
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

    // Resolve the ONE client-tool seam both delivery paths share. The correlation index is wired
    // for Claude only — Pi's relay toolCallId is already exact.
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

    // EVERY harness gets the guard: the relay dir is sandbox-writable, so a forged
    // `<id>.req.json` proves nothing about any dialog having run, and this runner-side
    // re-check is the only enforcement of the hard deny boundary against forged files.
    // `allow` passes and `deny` refuses identically everywhere; `ask` splits by harness —
    // Pi consumes a dialog-recorded execution grant (fail-closed parity with the in-sandbox
    // confirm), while a non-Pi MCP harness (Claude) passes `ask` because its own harness
    // enforces the ask dialog (the rendered `mcp__agenta-tools__<tool>` ask rules + the ACP
    // permission flow) before a call reaches the shim. See buildRelayExecutionGuard for the
    // stated residual (a forged file can still trigger an ask-tool without a dialog there).
    const relayGuard: RelayExecutionGuard = buildRelayExecutionGuard({
      isPi: plan.isPi,
      permissionPlan,
      executionGrants,
    });

    if (plan.useToolRelay) {
      turn.toolRelay = (deps.startToolRelay ?? startToolRelay)(
        plan.isDaytona
          ? (deps.sandboxRelayHost ?? sandboxRelayHost)(env.sandbox, {
              log: logger,
            })
          : (deps.localRelayHost ?? localRelayHost)(),
        plan.relayDir,
        plan.toolSpecs,
        request.toolCallback as ToolCallbackContext | undefined,
        request.runContext,
        env.clientToolRelayRef.current,
        relayGuard,
        {
          log: logger,
          // Derived from the run plan's client-tool pause disposition (the closed set lives at
          // the client-tool boundary; the relay only needs the boolean).
          writePausedAnswer: relayWritesPausedAnswer(
            plan.clientToolPauseDisposition,
          ),
        },
      );
      // Ordering invariant: the relay's stale-file sweep must complete before the
      // resume's respondPermission or the fresh prompt below can cause a legitimate
      // request, so nothing legitimate can predate the sweep and be swallowed as
      // stale. Optional-chained so a fake relay without `ready` is tolerated, and a
      // sweep failure never kills the turn.
      await turn.toolRelay?.ready?.catch?.(() => {});
    }

    // The prompt promise this turn races against the pause signal. A normal/continuation turn
    // sends a fresh prompt; a live approval resume answers the parked gate on the SAME session and
    // continues the ORIGINAL, still-pending prompt promise (the tool then runs with its original
    // byte-exact args). Either way, on a HITL pause the prompt resolves cancelled or never
    // resolves, and the pause signal ends the turn.
    let promptPromise: Promise<unknown>;
    if (opts.resume) {
      // The resume turn owns continued events; each decision answers one parked gate by id.
      // Carried gates keep the shared original prompt pending until a later answer.
      const decisions = opts.resume.decisions;
      promptPromise = Promise.resolve(decisions[0]?.promptPromise);
      promptPromise.catch(() => {});
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
          pause.markAllowedExecution(decision.toolCallId);
          executionGrants.grant(decision.toolName, decision.args);
        }
        // A live-resume deny closes the seeded call as a failed tool call; flag it so the egress
        // projects `tool-output-denied` (a decline), mirroring the cold decision-map deny path.
        if (decision.reply === "reject") {
          run.markToolCallDenied(decision.toolCallId);
        }
        // Answer this gate on the live session. Each parked gate holds its OWN pending
        // `respondPermission` on the harness, so answering them one by one settles each
        // independently — an approve and a deny in the same turn each land on the right call.
        await env.session.respondPermission(decision.permissionId, decision.reply);
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
      // The harness still holds carried gates inside the original prompt, so re-arm the pause after
      // this answer batch and let the normal park path refresh their approval TTL.
      if (opts.resume.carriedForward.length > 0) pause.pause();
    } else {
      promptPromise = Promise.resolve(
        env.session.prompt([{ type: "text", text: turnText }]),
      );
      promptPromise.catch(() => {});
    }
    const raced = await Promise.race([
      promptPromise,
      pause.signal.then(() => PAUSED),
      runLimitTripped.then(() => RUN_LIMIT_TRIPPED),
    ]);
    // A tripped run-limit ends the turn as an error: throw into the shared catch below so the
    // trace is flushed and the caller's teardown reclaims the (wedged) sandbox.
    if (raced === RUN_LIMIT_TRIPPED) {
      throw new Error(runLimitReason ?? "run limit tripped");
    }
    const stopReason =
      raced === PAUSED || pause.active ? "paused" : (raced as any)?.stopReason;
    // Terminalization drains queued gates, classifies pause-time completions, and gives allowed
    // executions their original per-call bound before the orphan sweep closes the turn.
    if (stopReason === "paused") {
      await pause.waitForEventDrain();
      settleBufferedPausedCompletions();
      const openAllowedExecutions = openToolCallIds()
        .filter((id) => pause.isAllowedExecution(id));
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
      settleBufferedPausedCompletions();
      run.settleOpenToolCalls(
        (id) =>
          pause.isPausedToolCall(id) || pause.isAllowedExecution(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
      const unexpectedOpenToolCallIds = openToolCallIds()
        .filter((id) => !pause.isPausedToolCall(id));
      if (unexpectedOpenToolCallIds.length > 0) {
        logger(
          "[HITL] paused-turn transcript invariant left non-gated calls open: " +
            unexpectedOpenToolCallIds.join(","),
        );
      }
    }
    const result = raced === PAUSED ? undefined : raced;
    // A parkable pause this turn: hand the still-pending prompt promise to EVERY parked record so a
    // later resume can await the same continuation (there is one prompt per turn, so every gate
    // shares it). Set after the race so `promptPromise` exists.
    if (opts.approvalParkMode && pause.active && env.parkedApprovals.size > 0) {
      for (const record of env.parkedApprovals.values()) {
        record.promptPromise = promptPromise;
      }
    }
    await turn.toolRelay?.stop();
    logger(`prompt stopReason=${stopReason}`);

    const usage = await resolveRunUsage({
      sandbox: env.sandbox,
      usageOutPath: plan.usageOutPath,
      isDaytona: plan.isDaytona,
      promptResult: result,
      streamUsage: run.usage(),
    });
    run.setUsage(usage);

    const swallowedPiError =
      plan.isPi &&
      !plan.isDaytona &&
      !run.output().trim() &&
      !run.events().some((e) => e.type === "tool_call")
        ? // The helper derives the transcript location from `piSessionWorkspaceDir(plan.cwd)`,
          // the same shared helper `configurePiSessionWorkspace` used to point Pi at it.
          findSwallowedPiError(plan.cwd)
        : undefined;
    let swallowedError: string | undefined;
    if (swallowedPiError) {
      swallowedError = conciseError(
        new Error(swallowedPiError),
        plan.harness,
        request.provider,
      );
      run.recordError(swallowedError, request.provider);
      run.emitEvent({ type: "error", message: swallowedError });
    }

    const output = run.finish();
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
    } else if (stopReason === "paused") {
      // A pause stopped mid-turn, after the harness may have written a partial turn natively.
      invalidateContinuity(sessionId, plan.harness, deps);
    }

    return {
      ok: true,
      output,
      messages: output ? [{ role: "assistant", content: output }] : [],
      events: emit ? [] : run.events(),
      usage,
      stopReason,
      capabilities: {
        ...env.capabilities,
        streamingDeltas: !!emit && env.capabilities.streamingDeltas,
      },
      sessionId,
      model: env.model ?? request.model,
      traceId: run.traceId(),
    } as AgentRunResult;
  } catch (err) {
    const error = conciseError(err, plan.harness, request.provider);
    otel?.recordError(error, request.provider);
    otel?.emitEvent({ type: "error", message: error });
    // An aborted turn may have left a partial turn in the native transcript.
    invalidateContinuity(sessionId, plan.harness, deps);
    // finish() must not throw uncaught — tracing must not mask the run error.
    try {
      otel?.finish();
    } catch {}
    await otel?.flush().catch(() => {});
    return { ok: false, error };
  } finally {
    // Release every run-limits timer (idempotent, never re-arms on a late event) on EVERY path.
    runLimits.dispose();
    // This turn owns its relay: stop it on EVERY exit path (the happy path already stopped it
    // after the prompt; stop is safe to repeat, matching the old finally). Null it afterwards so
    // a later `destroy()` — possibly after the dispatch cleared the sink — cannot double-stop or
    // orphan it.
    await activeTurn?.toolRelay?.stop().catch(() => {});
    if (activeTurn) activeTurn.toolRelay = undefined;
  }
}
