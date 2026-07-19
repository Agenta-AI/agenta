import {
  PendingApprovalLatch,
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
  createSandboxAgentOtel,
  TOOL_NOT_EXECUTED_PAUSED,
} from "../../tracing/otel.ts";
import { attachPermissionResponder } from "./acp-interactions.ts";
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
 * controller / latch / decisions / responder into `env.currentTurn`, restart the tool relay,
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
  // `turn_index` is a true conversation-turn counter, not an acquire counter: it advances once per completed turn across every environment serving the session.
  // The shared store advances only on `record()` (paused turns record nothing), so park-and-resume consumes one index; compute it at turn start because a warm environment serves many turns.
  env.continuityTurnIndex = sessionId
    ? nextTurnIndex(sessionId, continuityStore)
    : undefined;
  // Reset the per-turn tool-call id record (the park folds the completed turn's ids into the
  // expected next-history fingerprint).
  env.lastTurnToolCallIds = [];
  // Reset the per-turn approval-park bookkeeping. A fresh turn starts with no parked gate; this
  // turn re-records it only if it pauses on a Claude ACP permission gate. (The dispatch has
  // already captured any prior park into `opts.resume` before calling us.)
  env.parkedApproval = undefined;
  env.approvalGateCount = 0;
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
  const runLimits = (deps.createRunLimits ?? createRunLimits)(
    (deps.resolveRunLimits ?? resolveRunLimits)(logger),
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

    const pause = new PendingApprovalPauseController(() => {
      // The sibling settle runs UNCONDITIONALLY, park mode or not: latch-loser tool calls
      // announced before the winning gate can never execute this turn, and skipping the settle
      // here would leave them as orphaned open parts whenever the dispatch later refuses the park
      // (multi-gate, pool full) — `env.destroy()` does not re-run it. The exclusion keeps the
      // gated (paused) call itself open, so the live resume is untouched.
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
      // Park mode: a parkable permission gate (Claude ACP or Pi ACP) recorded
      // `env.parkedApproval` BEFORE firing this pause (the onUserApprovalGate hook runs before
      // the single-pause latch). Keep the live session — the gated tool runs on the resume — so
      // skip ONLY the mcpAbort and the destroySession. The teardown is not lost: the dispatch
      // either parks the session or, if it decides not to (multi-gate, pool full), calls
      // `env.destroy()` which runs them. A non-parkable pause (keep-alive off, client tool)
      // never records `parkedApproval`, so it still tears down here exactly as today.
      if (opts.approvalParkMode && env.parkedApproval) return;
      // Abort any in-flight loopback `tools/call` (a paused Claude client tool) BEFORE the
      // session teardown, so its handler cannot write a result after the turn ends.
      env.mcpAbort.abort();
      env.sessionDestroyRequested = true;
      return env.sandbox.destroySession?.(env.session.id);
    });
    // A human pause resolves this signal exactly once, the moment the turn parks for input — the one
    // place every pause path converges, so the one place to retire the run-limits deadlines for good.
    void pause.signal.then(() => runLimits.notePaused());

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
          run.handleUpdate(update);
          // A sibling announced AFTER the pause won the latch can never execute; settle it
          // immediately so the client never holds an orphaned part (idempotent re-sweep).
          if (pause.active) {
            run.settleOpenToolCalls(
              (id) => pause.isPausedToolCall(id),
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
    const latch = new PendingApprovalLatch();
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
      if (!references?.workflow_revision) return;
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
    const resolveInteractionToken = (token: string): void => {
      const cred = runCredential(request);
      if (!cred) return;
      if (
        !buildWorkflowReferences(request.runContext?.workflow)
          ?.workflow_revision
      )
        return;
      void resolveInteraction(sessionId, token, () => cred);
    };
    const serverPermissions = serverPermissionsFromRequest(request);
    // The SAME name->spec index the relay execute loop hands to the relay execution guard, so
    // the approval card and the guard cannot disagree about a tool's permission/readOnly.
    const specsByName = toolSpecsByName(plan.toolSpecs);
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
      latch,
      serverPermissions,
      log: logger,
      onPause: () => pause.pause(),
      onPausedToolCall: (id) => pause.markPausedToolCall(id),
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
      // Record the parkable permission gate (only in keep-alive park mode) so the dispatch can
      // resume it live. Fires per pending gate (before the latch) so a parallel gate is counted;
      // the single-gate resume records only the FIRST gate's answer target. `info.gateType` names
      // the plane (Claude ACP vs Pi ACP) so the resume answers on the right one.
      onUserApprovalGate: opts.approvalParkMode
        ? (info) => {
            env.approvalGateCount += 1;
            if (
              env.approvalGateCount === 1 &&
              info.permissionId &&
              info.toolCallId
            ) {
              env.parkedApproval = {
                gateType: info.gateType,
                permissionId: info.permissionId,
                toolCallId: info.toolCallId,
                toolName: info.toolName,
                args: info.args,
                interactionToken: info.interactionToken,
              };
            }
          }
        : undefined,
    });

    // Resolve the ONE client-tool seam both delivery paths share. The correlation index is wired
    // for Claude only — Pi's relay toolCallId is already exact.
    env.clientToolRelayRef.current = buildClientToolRelay({
      responder,
      run,
      latch,
      pause,
      recordPendingInteraction,
      toolCallIndex: plan.isPi ? undefined : env.toolCallIndex,
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
      // The new (resume) turn owns streaming + tracing; the environment is already wired to route
      // continued events into this turn's sink (env.currentTurn was set above). Seed this run's
      // trace with the parked tool call so the completing `tool_call_update` closes it and the FE
      // approval part flips to output-available even if the adapter re-announces nothing. Then
      // answer the gate on the live session — the original prompt continues from here.
      run.handleUpdate({
        sessionUpdate: "tool_call",
        toolCallId: opts.resume.toolCallId,
        title: opts.resume.toolName,
        kind: opts.resume.toolName,
        rawInput: opts.resume.args,
      });
      promptPromise = Promise.resolve(opts.resume.promptPromise);
      promptPromise.catch(() => {});
      // A parked Pi dialog gate resumes on a FRESH turn whose relay and grant ledger are new;
      // grant the approved call here so the extension's execute record (written right after the
      // confirm resolves) passes the relay guard. Claude resumes grant too — harmlessly, no
      // guard consults it.
      if (opts.resume.reply === "once") {
        executionGrants.grant(opts.resume.toolName, opts.resume.args);
      }
      // A live-resume deny closes the seeded call as a failed tool call; flag it so the egress
      // projects `tool-output-denied` (a decline), mirroring the cold decision-map deny path.
      if (opts.resume.reply === "reject") {
        run.markToolCallDenied(opts.resume.toolCallId);
      }
      await env.session.respondPermission(
        opts.resume.permissionId,
        opts.resume.reply,
      );
      // The gate is answered: resolve the durable interaction row (the parked pending row the cold
      // path would otherwise resolve via its decision map). The fresh per-turn pause controller
      // starts with an EMPTY pausedToolCallIds set, so the resumed call's `tool_call_update` frames
      // are no longer suppressed and stream through — the "clear pausedToolCallIds on resume" step.
      resolveInteractionToken(opts.resume.interactionToken);
      logger(
        `[keepalive] resume answered gate reply=${opts.resume.reply} tool=${opts.resume.toolName ?? "?"}`,
      );
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
    // Pause notification is immediate, but terminalization must wait for managed cancellation
    // and already-queued ACP updates. Re-sweep after the drain so a sibling announced during
    // cancellation receives exactly one deterministic terminal result before `done`.
    if (stopReason === "paused") {
      await pause.waitForEventDrain();
      run.settleOpenToolCalls(
        (id) => pause.isPausedToolCall(id),
        TOOL_NOT_EXECUTED_PAUSED,
      );
    }
    const result = raced === PAUSED ? undefined : raced;
    // A parkable pause this turn: hand the still-pending prompt promise to the parked record so a
    // later resume can await the same continuation. (Set after the race so `promptPromise` exists.
    // The read is asserted because the onUserApprovalGate callback set the field via an async
    // mutation TS's flow analysis cannot see, so it would otherwise narrow the reset to `never`.)
    const parkedThisTurn = env.parkedApproval as ParkedApproval | undefined;
    if (opts.approvalParkMode && pause.active && parkedThisTurn) {
      parkedThisTurn.promptPromise = promptPromise;
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

    if (swallowedError) {
      // A failed turn may have left a partial turn in the native transcript: the prior record
      // is no longer a faithful resume point.
      invalidateContinuity(sessionId, plan.harness, deps);
      return { ok: false, error: swallowedError };
    }

    // Capture this harness's native session id for the next turn's setup. Only on a turn that
    // actually completed (not paused mid-turn — a park has not finished authoring the turn, so
    // it must not be marked authoritative) and only when the harness surfaced one.
    if (
      stopReason !== "paused" &&
      env.continuityTurnIndex !== undefined &&
      sessionId &&
      env.session?.agentSessionId
    ) {
      (deps.sessionContinuityStore ?? sessionContinuityStore).record(
        sessionId,
        plan.harness,
        env.session.agentSessionId,
        env.continuityTurnIndex,
      );
      // Append this turn to the durable turns log; fire-and-forget (a plain INSERT, no race).
      const syncCred = runCredential(request);
      if (syncCred && request.streamId) {
        const workflowRefs = buildWorkflowReferences(
          request.runContext?.workflow,
        );
        void (deps.appendSessionTurn ?? appendSessionTurn)(
          sessionId,
          plan.harness,
          env.continuityTurnIndex,
          {
            streamId: request.streamId,
            agentSessionId: env.session.agentSessionId,
            sandboxId: env.sandbox?.sandboxId,
            references: workflowRefs ? Object.values(workflowRefs) : undefined,
            traceId: run.traceId(),
          },
          { authorization: syncCred, log: logger },
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
