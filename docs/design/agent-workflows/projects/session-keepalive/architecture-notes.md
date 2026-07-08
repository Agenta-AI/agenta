# Session keep-alive: architecture research notes

Input for the plan-feature pass. Produced 2026-07-07 from a code-grounded design review of services/runner. Source analysis: [../approval-boundary/cold-replay-failure-report.md](../approval-boundary/cold-replay-failure-report.md) (Part 3, option 2).

## The idea in one paragraph

Today the runner destroys the sandbox and harness session at the end of every turn. Keep-alive means: when a turn finishes, keep the session alive for a short time (a TTL, for example 60 seconds). If the next user message arrives inside that window, continue the same live session with just the new text. The harness keeps its own full memory (tool calls, results, thinking) because the process never died. If the window expires or anything mismatches, fall back to today's cold replay. Nothing can get worse than today.

## Verified grounding

- The runner is a long-lived Node daemon on :8765 (`src/server.ts:491`), one replica in every deployed topology (compose and Helm default). Per-process state already exists (`inFlightSandboxes` set, replica id, `owner:session:<id>` affinity keys in `src/sessions/alive.ts:32-36`). An in-memory `Map<sessionId, LiveSession>` pool is viable today.
- The conversation key already rides the wire end to end: FE `agentRequest.ts:303` sends `session_id`, SDK `handler.py:253` forwards it, runner `protocol.ts:386` receives it. No wire change needed.
- `runSandboxAgent` (`src/engines/sandbox_agent.ts:321-1047`) builds sandbox, session, relay, prompt per request; the `finally` (1004-1047) unconditionally destroys everything. On approval pause, `PendingApprovalPauseController.pause()` (`pause.ts:24-29`) also destroys the session.
- The `sandbox-agent` package's `Session` object supports repeated `prompt()` calls, re-attachable `onEvent`/`onPermissionRequest` listeners (they return unsubscribe functions), and `respondPermission(permissionId, reply)` callable at any later time (pending requests park in `SandboxAgent.pendingPermissionRequests`). Nothing forces one prompt per session.
- The CLI path (`src/cli.ts`, local SDK adapter) is process-per-request; keep-alive is inert there by construction.

## Design

### Pool and keying
- New `src/engines/sandbox_agent/session-pool.ts`: `LiveSession` records keyed by `<projectId>:<request.sessionId>` (amended after review: the caller-supplied `sessionId` alone must not be the key; the project scope comes from the request's authenticated context, the same values the mount-signing call uses, so two projects can never share a live harness process). States: `busy` -> `idle` (TTL timer) or `awaiting_approval` (longer approval TTL) -> `destroyed`.
- Credential epoch (amended after review): the park records the mount-credential expiry and a hash of the resolved credential identities. An expired or rotated epoch is treated as a fingerprint mismatch: evict and cold-start with fresh credentials. Parked sessions must not outlive their baked credentials.
- Requests without a `sessionId` never park (non-playground callers keep today's semantics).

### Continuation versus cold decision
Each parked session records two fingerprints:
1. `configFingerprint`: canonical-JSON hash over config-bearing request fields (harness, sandbox, model, provider, deployment, endpoint, credentialMode, agentsMd, systemPrompt, appendSystemPrompt, tools, skills, customTools, mcpServers, toolCallback.endpoint, permissions, sandboxPermission, harnessFiles, workflow revision id/version, is_draft). Exclude per-turn volatiles (messages, turnId, trace propagation, telemetry headers which rotate ~15 min, secret values).
2. `historyFingerprint`: ordered prior user-message texts plus ordered tool-call ids (both survive the egress/ingress round trip byte-stable), plus `promptCount`. Pinned contract (amended after review): computed over the message array the server receives, which is the frontend's PRUNED array (the FE drops answer-less assistant turns before sending). Unit tests pin the pruned-array contract so a future FE pruning change trips a test instead of silently breaking continuations; a fingerprint miss degrades to cold replay, never a wrong continuation.

On an incoming request with a pool hit:
- Continue (normal): fingerprints match, tail is a fresh user message -> `session.prompt(newUserText)`. No `buildTurnText`.
- Continue (approval resume): fingerprints match, a parked pending-permission id exists, the new content is an approval envelope whose `toolCallId` matches the parked gate -> answer the parked RPC (below).
- Cold: anything else (mismatch, miss, dead, busy). Evict, destroy, run today's path. A validation failure must never fail the turn.

### Turn-flow refactor
Split `runSandboxAgent` into:
- `acquireEnvironment(request)`: mount signing through `createSession` + MCP wiring (today lines 328-699). Session-scoped: sandbox handle, session handle, internal tool-MCP server (its URL is baked into sessionInit, so it must live as long as the session), relay dir, mounted cwd, workspace, skills dirs. Finalizers register incrementally as each resource is acquired; a mid-acquire failure runs the finalizers registered so far (reverse order) through the same `destroy()` the pool uses. A half-built environment cannot leak.
- `runTurn(env, request, emit, signal)`: per-turn otel run, fresh `PendingApprovalLatch`, fresh `ConversationDecisions`, swap the environment's current-turn sink to this turn's handlers, restart toolRelay, prompt, resolve usage, flush otel.

Listener model (amended after review): `onEvent`/`onPermissionRequest` attach ONCE in `acquireEnvironment` for the session's lifetime and demux into a mutable `currentTurn` sink that `runTurn` swaps in and out. Per-turn detach/attach is wrong for this package: the listener registries are plain Sets, an event with no listener is silently dropped, and a permission request with no listener is CANCELLED, so any detach window is a drop/cancel window. Events arriving with no active turn hit an explicit between-turns handler (permission requests park in slice 2 or cancel by policy; stray events are logged and dropped deliberately).

### The approval interaction (the big win)
F-040 (docs/design/agent-workflows/projects/qa/f040-park-terminal-plan.md) destroyed the session on pause for three reasons: (a) the HTTP turn must end (Claude never resolves `prompt()` on an unanswered gate), (b) the sandbox would leak if the turn never ended, (c) the package blocks manual `session/cancel`, so destroy was the only clean cancel. A TTL park invalidates (b) and (c) and preserves (a): the turn still ends with `stopReason: "paused"` (the existing race at `sandbox_agent.ts:899-912` still works), but the `LiveSession` parks holding the still-pending `prompt()` promise and the unanswered permission id.

On approval: `respondPermission(parkedId, "once" | "reject")` -> the original prompt promise continues -> the new turn's emitter streams the remaining events -> the tool executes with its original byte-exact arguments. This removes the argument-drift and task-restart failure classes at the root. The exact-args decision-map machinery stays untouched as the cold fallback (approval TTL expired, restart, etc.).

Required changes in park mode: the pause controller must not fire the destroy callback (inject a park callback); do not abort `mcpAbort` (a paused client tool's loopback call must stay in flight); do not settle the paused call with `TOOL_NOT_EXECUTED_PAUSED` (it will actually run); add `resume()` clearing `pausedToolCallIds` so post-resume `tool_call_update` frames stream again (`shouldSuppressPausedToolCallUpdate`, `sandbox_agent.ts:180`). The "a pause sends NO harness reply" contract (`acp-interactions.ts:68-72`) is unchanged; the reply just arrives later on the same session. The interactions plane needs `resolveInteraction` for the parked token on resume (hook exists at `sandbox_agent.ts:850`), ordered against `cancelStaleInteractions` (`server.ts:275`).

Note: `acp-fetch.ts` already disables undici header/body timeouts specifically so a paused HITL turn's held ACP connection survives human-timescale delays. The holding infrastructure exists.

Scope (amended after review): the park-and-answer path applies to Claude ACP permission gates ONLY in v1. The other three gate mechanisms stay cold, each for a structural reason: Pi custom-tool gates block on the file relay inside the sandbox with their own deadline (`RELAY_TIMEOUT_MS` 60 s default; the dispatch shim polls a response file), Pi builtin gates block synchronously inside `extensions/agenta.ts` on `relayPermissionCheck`, and a client-tool MCP pause deterministically ABORTS the in-flight HTTP request (`tool-mcp-http.ts`), so by turn end there is nothing held to answer. The dispatch takes the park-and-answer path only for a parked Claude ACP permission id; any other pending-gate shape evicts to cold. Tests assert the non-Claude gates stay cold. The full consequence table is in plan.md Q7.

Execution context on resume (amended after review): the ORIGINAL turn's baked environment executes the tool (its signed mount credentials, resolved secrets, callback auth, harness env, sandbox); the NEW turn's context owns streaming and tracing (otel run, emitter, interaction resolve). The credential epoch bounds staleness: expired or rotated credentials evict instead of resuming.

### Lifecycle and safety
- Flags: `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off), `AGENTA_RUNNER_SESSION_TTL_MS` (60000), `AGENTA_RUNNER_SESSION_APPROVAL_TTL_MS` (600000), `AGENTA_RUNNER_SESSION_POOL_MAX` (~8).
- Eviction: LRU on idle entries when full; never evict busy. Parking is best-effort; pool full -> tear down as today.
- Teardown triggers: TTL expiry, fingerprint mismatch, credential-epoch expiry, explicit stop (`POST /kill` drains the pool), runner shutdown, rejected parked prompt promise.
- Runner shutdown (corrected after review): `inFlightSandboxes` is not sufficient; `destroyInFlightSandboxes` only calls `destroySandbox` and skips the relay stop, `mcpAbort`, `closeToolMcp`, `destroySession`, dispose, unmount, and temp-dir removal. Each `LiveSession` carries the complete idempotent `destroy()` (all the finalizers the old `finally` ran), and the SIGTERM/SIGINT path drains the pool through `pool.destroyAll()` (timeout-bounded). `inFlightSandboxes` stays as a second line of defense for the sandbox handle only.
- Idle cost: local = host RAM only (a few hundred MB per session: daemon + adapter + harness processes; the 2026-07-06 child-process-leak notes in the finally block list exactly what to track). Daytona = billed idle time; existing backstops (15-min auto-stop, ephemeral auto-delete, `provider.ts:41-98`) still reap leaks. Enable local-only first.

### Failure modes (detect -> degrade, never fail the turn)
| Failure | Detection | Fallback |
|---|---|---|
| Sandbox dies mid-idle | parked promise rejection; liveness probe on acquire | evict, cold replay |
| Request after TTL | pool miss | cold replay |
| Two turns race one session | busy flag (single-threaded check-and-set) | supersede: destroy, cold-start new turn |
| Continuation throws mid-turn | try/catch in runTurn | destroy; retry once cold |
| Client disconnects | session-owned runs already survive (`server.ts:237-246`) | on abort: destroy, don't park |
| Approval reply after approval-TTL | pool miss | cold replay + existing decision-map path |
| Multi-replica miss (future) | pool miss | cold replay; later route via `owner:session` affinity |

### Slices
1. Keep-alive across normal turn boundaries, local only, flag off by default. ~350-500 lines: session-pool.ts, split of sandbox_agent.ts, dispatch wrapper in server.ts, tests through the existing `SandboxAgentDeps` / `createAgentServer(run)` seams. Runner-only; zero wire/SDK/FE change; flag off = byte-identical behavior.
2. Keep-alive across approval pauses, Claude ACP permission gates only. ~200-300 lines: pause.ts park mode, respondPermission resume, interaction resolve ordering. Pi relay gates, Pi builtin gates, and client-tool MCP pauses stay cold (asserted by tests). Highest correctness value.
3. Daytona: remove the `isDaytona` gate after slices 1-2 are tested and have run in real use without problems; verify cookie-fetch session reuse and tunnel-mounted cwd survival across a park. Real operational risk is billed idle time and remote liveness.

## Relation to session resume (option 3, ../harness-session-resume/plan.md)
Independent and complementary. Keep-alive covers the fast conversational loop and the approval window with zero storage work; session resume covers long gaps, runner restarts, and replica moves via the harness's own session files plus `session/load`. Build order: keep-alive slice 1 -> slice 2 -> session-resume slice A; they do not block each other.
