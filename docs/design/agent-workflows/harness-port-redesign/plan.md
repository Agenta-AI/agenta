# Build plan

Scope set by the user (2026-06-17): full A to E arc, cold per invoke (no warm daemon).
See [`status.md`](status.md) for the decisions and [`proposal.md`](proposal.md) for the
target shape. Each phase ships independently and keeps `/invoke` and `/inspect` working.

Reading key for the file column: `ports.py`, `rivet_harness.py`, `schemas.py`,
`agent.py`, `pi_harness.py`, `pi_http_harness.py` are under `services/oss/src/`;
`runRivet.ts`, `runPi.ts`, `server.ts`, `cli.ts`, `toolBridge*.ts`, `agenta-otel.ts` are
under `services/agent/src/`.

## Phase A. Capabilities and a structured result

Goal: kill the `if harness == "pi"` branches and stop flattening the run to one string.

| Task | Files |
| --- | --- |
| Add a `HarnessCapabilities` dataclass (the rivet `AgentCapabilities` flags we use: `mcp_tools`, `images`, `file_attachments`, `plan_mode`, `reasoning`, `permissions`, `usage`, `streaming_deltas`, `session_lifecycle`) | `ports.py` |
| Probe capabilities once per harness via the rivet SDK `getAgent(id)`; cache; pass to the result | `runRivet.ts` |
| Replace harness-name branches (tools native vs MCP, tracing `emitSpans`) with capability checks | `runRivet.ts` |
| Widen `HarnessResult` / `AgentRunResult` to carry `messages`, `usage`, `tool_calls`, `stop_reason`, `capabilities` (data already accumulates in the event handler) | `ports.py`, `runPi.ts`, `rivet_harness.py` |
| Keep `output` as the derived final string so `/invoke` is unchanged | `agent.py` |

Done when: a Pi run and a Claude run both return a structured result; no code path reads
`harness == "pi"`; the `/invoke` response body is byte-identical for a simple turn.

## Phase B. Event streaming through the port

Goal: forward the rivet `session/update` stream through the port instead of consuming it
privately for tracing.

| Task | Files |
| --- | --- |
| Define an `AgentEvent` type (variants: `message`, `thought`, `tool_call`, `plan`, `usage`, `done`) mapped from ACP `session/update` | `ports.py`, `runPi.ts` |
| Add an event sink to `invoke` (callback or async generator); tracing reads from it rather than its own `session.onEvent` | `ports.py`, `rivet_harness.py`, `runRivet.ts`, `agenta-otel.ts` |
| Transport: stream events over the `/run` hop (NDJSON or SSE) for the HTTP sidecar; keep a final JSON result frame | `server.ts`, `cli.ts`, `rivet_harness.py` |
| Optional: expose a streaming surface from `agent.py` (feeds WP-4 multi message output); `/invoke` still returns the final message | `agent.py` |

Done when: tracing is built from the forwarded event stream (no private subscription in
`runRivet.ts`); a caller can observe `message`/`tool_call`/`usage` events live; `/invoke`
still returns one final message.

## Phase C. First class sessions (cold, replay backed)

Goal: a real `AgentSession` object backed by persisted history. Continue a conversation by
replaying persisted events into a fresh cold sandbox, not by the caller passing transcript
text and not by a warm ACP `session/load`.

| Task | Files |
| --- | --- |
| Add `create_session(config) -> AgentSession`, `resume_session(id)`, `AgentSession.prompt(...)`, `AgentSession.destroy()` to the port | `ports.py` |
| Define a `SessionStore` analogue of rivet's `SessionPersistDriver` (`get_session`, `list_events`, `insert_event`); persist the `AgentEvent` stream from Phase B | new module under `services/oss/src/agent_pi/` |
| Implement continuation as replay: on `resume`, load persisted events, rebuild turn context, run in a fresh cold sandbox (replaces `buildTurnText` transcript replay) | `rivet_harness.py`, `runRivet.ts` |
| Wire the store: backend DB on the platform, file standalone (default assumption, open Q3) | `agent.py`, new module |
| Optional: model `session/fork` for "try N variations of a turn" (defer unless a caller exists, open Q5) | `ports.py`, `runRivet.ts` |

Done when: a second turn against a `session_id` reconstructs context from the store (not
from caller-supplied `messages`); destroying a session drops its history; cold lifecycle
is unchanged (no warm daemon).

## Phase D. Content blocks, permissions, skills, hooks

Goal: richer input and the remaining config surface.

| Task | Files |
| --- | --- |
| Turn `prompt` into ACP content blocks (`text`, `image`, `audio`, `resource`, `resource_link`); gate images/files on `images`/`file_attachments` capability | `ports.py`, `runRivet.ts`, `runPi.ts` |
| Surface attachments in the workflow input schema so the playground can send them | `schemas.py` |
| Add a `permission_policy` to the session config (auto-allow, deny, delegate-to-callback); replace the hardcoded auto-approve | `ports.py`, `runRivet.ts` |
| Optional: surface permission requests as events for human in the loop | `ports.py`, `runRivet.ts`, `agent.py` |
| Add `skills` to the session config, resolved before the run and laid into `cwd` (or via rivet `setSkillsConfig`) | `ports.py`, `rivet_harness.py`, `runRivet.ts` |
| Add `hooks` as config artifacts laid into the workspace / agent dir (not a port verb; same shape as the Pi extension install) | `ports.py`, `runRivet.ts` |

Done when: an image attachment reaches a capable harness; a deny policy blocks a tool; a
skill file and a hook artifact are present in the run and exercised.

## Phase E. Retire the `Runtime` exec port

Goal: fold "where it runs" fully into the environment seam backed by rivet providers.

| Task | Files |
| --- | --- |
| Rename/replace `Runtime` with an `Environment` seam (`start`, `dispose`, `destroy`, `pause`, provisioning `put_file`); back lifecycle with `destroySandbox`/`dispose`/`pauseSandbox` | `ports.py`, `rivet_harness.py`, `local_runtime.py` |
| Move provisioning (AGENTS.md, auth, extension upload) behind `Environment.put_file` | `runRivet.ts`, `rivet_harness.py` |
| Keep `exec` only while the legacy in-process Pi subprocess transport needs it; otherwise remove | `ports.py`, `pi_harness.py` |
| Update `_build_harness` to construct the environment from provider config, not an exec runtime | `agent.py` |

Done when: the rivet path no longer depends on `Runtime.exec`; lifecycle calls map to
rivet provider lifecycle; the legacy Pi path still runs or is explicitly retired.

## Cross cutting

- **Legacy adapters.** `PiHarness` and `PiHttpHarness` must satisfy the widened port at
  each phase, or be adapted behind a shim. Decide per phase whether to keep them.
- **Tracing.** The `createRivetOtel` event-stream tracer is the reference consumer of the
  Phase B stream; keep its output stable so existing traces do not regress.
- **No regressions to `/invoke` / `/inspect`.** Verify after every phase with a live
  playground run (the WP-8 verification path).
