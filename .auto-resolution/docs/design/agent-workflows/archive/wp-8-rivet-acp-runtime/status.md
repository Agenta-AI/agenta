> **Historical record.** This is a work-package note. It describes the design as it was at the time and may reference components that no longer exist. For the current design see the [agent-workflows docs](../../README.md); for the live state see [sdk-local-backend/status.md](../sdk-local-backend/status.md).
# Status

Source of truth for this WP. Keep it current.

## Current state

IMPLEMENTED and verified end to end (2026-06-17). The agent service drives the harness
over ACP through a rivet `sandbox-agent` daemon, behind the unchanged `Harness` port and
`/invoke` contract. Verified: Pi and Claude Code locally; harness swap as one config
value; the full UI playground run through the live dev stack; message history; and the
agent's spans nested under the `/invoke` workflow span. Tools are wired over MCP with a
documented harness limitation, and Daytona is wired with a documented snapshot
prerequisite (both below).

### What was verified

| Requirement | Status | How |
| --- | --- | --- |
| Drive the harness over ACP via rivet | done | `runRivet.ts` + `sandbox-agent@0.4.2`; Pi & Claude answer over ACP |
| Harness swap as config | done | `AGENTA_AGENT_HARNESS=pi\|claude`; same config, both answer (host) |
| Run locally (self-hosted) | done | rivet `local` provider; host CLI + dockerized sidecar in the dev stack |
| Tracing nested under `/invoke` | done | live: `_agent`→`invoke_agent`→`turn 0`→`chat <model>` in one trace, span_ids chained |
| End to end from the UI | done | playground run in pi-agents → "Success" reply via the rivet path |
| Message history | done | prior turns replayed as transcript context (client/playground holds history) |
| Tools | mechanism | MCP bridge → `/tools/call` built & bridge-verified; harness MCP support gates it (below) |
| Daytona sandbox | wired | provider branch implemented + auth upload; needs a rivet+Pi snapshot (below) |

### Implementation map

- `services/agent/src/runRivet.ts` — the rivet driver (same `/run` contract as `runPi`).
- `services/agent/src/agenta-otel.ts` — added `createRivetOtel` (ACP-event-stream tracer).
- `services/agent/src/toolBridge.ts` + `toolBridgeServer.ts` — tools over MCP → `/tools/call`.
- `services/agent/src/{server,cli}.ts` — route `/run` to `runRivet` (`AGENT_BACKEND`, or auto by request shape).
- `services/oss/src/agent_pi/rivet_harness.py` — `RivetHarness` (HTTP sidecar or subprocess).
- `services/oss/src/agent.py` — `_build_harness()` rivet branch (`AGENTA_AGENT_RUNTIME=rivet`).
- `hosting/docker-compose/ee/docker-compose.dev.yml` — rivet env on the `services` container.

### Tracing: propagate trace context into the harness (the WP-1/WP-2 mechanism)

For Pi we DON'T build spans in the runner. We propagate the caller's trace context into
Pi and let Pi emit its real span tree (`invoke_agent` → `turn N` → `chat <model>` /
`execute_tool`, with real token usage), via the `agenta` Pi extension. The extension is
bundled self-contained with esbuild (`scripts/build-extension.mjs` → `dist/extensions/
agenta.js`), installed into Pi's agent dir (local: copied; Daytona: uploaded via the
sandbox FS API), and reads everything from env (`AGENTA_TRACEPARENT`, `AGENTA_OTLP_*`,
`AGENTA_TOOL_*`). It is inert when no Agenta env is set, so a global install is safe.
Verified live: `chat gpt-5.5` carries `input_tokens`/`cost` and nests under the caller's
`/invoke` span, in both REST (ApiKey) and the browser playground (session JWT).

Cumulative roll-up: the harness span tree and the `_agent` workflow span are exported in
separate OTLP batches (different processes), so Agenta's per-batch cumulative roll-up
cannot bridge them. We close that by passing the run's token/cost totals back (Pi writes
them on `agent_end` to `AGENTA_USAGE_OUT`; `runRivet` returns them; `agent.py` stamps
`gen_ai.usage.*` on the workflow span in-process). Verified: `_agent` shows
`ag.metrics.tokens.cumulative` and the trace list Usage/Cost columns populate.

For non-Pi harnesses (e.g. Claude) the runner still builds the span tree from the ACP
event stream (`createRivetOtel`, `emitSpans:true`) as a uniform fallback.

The runner-built chat span is named from the model the harness actually resolved, not the
requested one: `runRivet` creates the tracer after `applyModel`, so when a harness rejects
the requested id and keeps its own default (Claude ignores `gpt-5.5`; the in-sandbox Pi on
Daytona only advertises `default`), the span is `chat` rather than falsely `chat gpt-5.5`.
Pi-local sets the requested model and the Pi extension emits the real `chat <model>`.

### Tools: Pi-native (no MCP)

Pi tools are delivered the Pi-native way: the same extension calls `pi.registerTool` for
each backend-resolved spec, and each tool's `execute` POSTs back to Agenta's
`/tools/call` (the WP-7 envelope; the provider key + connection auth stay server-side).
Verified live: a real Composio `github_whoami` tool runs in the dockerized playground and
shows an `execute_tool` span. Other (MCP-capable) harnesses get tools over ACP MCP via
`toolBridge.ts` instead.

### Daytona status — working (fast, traced)

`sandbox=daytona` runs Pi end to end in ~10s (verified live via `/invoke`), with the full
trace tree. Per invoke runRivet creates an ephemeral sandbox from the pre-baked snapshot
`agenta-rivet-pi` (rivet `-full` image + `pi` baked in, built by
`poc/build_rivet_snapshot.py`), uploads AGENTS.md, runs the ACP session, and destroys it
in `finally`. The earlier ~150s came from a per-invoke `npm install pi`; the snapshot
removes it (`AGENTA_RIVET_DAYTONA_INSTALL_PI=false`).

Credentials: the `agent-pi` sidecar gets scoped `DAYTONA_API_KEY`/`API_URL`/`TARGET`. The
model provider key (OpenAI/Anthropic) is resolved from the project vault and injected as
the sandbox env var, so no Codex/OAuth subscription token leaves the box (OAuth upload
remains a fallback only when no key exists).

Tracing: the in-sandbox harness can't reach Agenta's OTLP, so on Daytona the **runner**
builds the span tree from the ACP event stream (reliable export from the sidecar) and the
token total is passed back onto the `_agent` workflow span. Verified: 4-span tree
`_agent → invoke_agent → turn → chat`, `_agent` tokens populated.

Known limitation: the freshly-provisioned Pi inside the Daytona snapshot advertises only
`model: default` over ACP (it lacks the model catalog the dev's local Pi loads from its
`auth.json`), so a playground `model` choice is not honored on Daytona — Pi runs its
default with whatever provider key the vault supplied. The model axis is honored on
Pi-local. Settling the in-sandbox Pi model config is follow-up.

Notable fixes: the rivet daytona provider's default `image` conflicts with `snapshot`
("Cannot specify a snapshot when using a build info entry") — suppressed by passing
`image: undefined` in the create opts. The Daytona preview proxy uses cookie auth — a
cookie-persisting `fetch` is passed to `SandboxAgent.start`. Unhandled rejections from the
rivet SDK are caught in `server.ts` so one bad run can't crash the sidecar.

### Credentials (API key or OAuth)

Auth is a resolved credential, not hardcoded. The agent fetches the project vault's
`provider_key` secrets and injects each as its env var (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, …) into the harness; the harness uses whichever its model needs. With
no key the harness falls back to its own login (OAuth): local Pi uses the Codex login;
Claude needs an Anthropic key (verified: with credit, `/invoke` returns a clean reply; the
guardrail surfaces "insufficient credit"/"authentication failed" as one line).

## Decisions

| Decision | Rationale |
| --- | --- |
| Adopt rivet unmodified (no Rust fork) | It gives ACP, harness swap, local, and streaming. The only gap (the jail) is deferred. |
| Licensing is clear for commercial use | rivet is Apache-2.0 (binary self-buildable, no phone-home); all shipped deps are MIT/Apache-2.0. Claude Code (proprietary) and Daytona's AGPL server are user-brought, weak coupling. Never bundle Claude Code. See [`research.md`](research.md#licensing-verified-safe-to-adopt-commercially). |
| Drive the harness over ACP via rivet | Satisfies "ACP, not Pi JSON". |
| Keep the `Harness` port and `/invoke` unchanged | The seam is right; only the adapter below it changes. Keep the legacy Pi adapters working. |
| Add `RivetHarness` (Python) + `runRivet.ts` (wraps the rivet SDK) | Thin Python adapter over a TS runner; reuse the `/run` contract. |
| Sandbox and harness are two orthogonal config axes | Swap each independently; matches rivet (provider vs `agent`). |
| One daemon and one sandbox per invoke (cold) | Mirrors the shipped code-evaluator `DaytonaRunner` (ephemeral per execution). Makes daemon env per-invoke and needs no jail. |
| Inject trace + secrets at the daemon's birth (SDK `env` local, sandbox `env_vars` Daytona) | Per-invoke daemon means per-invoke env. No fork of rivet or adapters needed. |
| Tracing is in scope; standalone traces are not acceptable | Pi reuses `agenta-otel` as a Pi extension; Claude Code uses `CLAUDE_CODE_ENABLE_TELEMETRY` + `OTEL_*` + `TRACEPARENT` in `-p` mode. |
| Local run = run the open-source rivet server locally; Python wraps the client | Rivet is Apache-2.0. Not a special case. |
| Session = persisted message history + ephemeral sandbox; continue via ACP `session/load` | No persistent FS writes, so nothing on disk to keep. Zero at-rest cost. |
| Concurrency mirrors evaluations (taskiq + Redis + shared semaphore) | Each slot = one ephemeral sandbox; the semaphore caps Daytona cost/quota. |
| Tools split into definition + swappable body, per-harness over MCP; deferred build | Enables test variants with mock bodies; body model is general, not Agenta-specific. |
| Input variables substituted into AGENTS.md | Mirrors prompt-template variables. |
| Secrets via launch env, never in the agent-visible filesystem | No jail. |
| `model` semantics owned by the harness adapter | The adapter normalizes per harness. Not an open question. |
| Adapters live in the SDK | Backend and standalone share one implementation. |

## Open questions

1. **SDK API names.** Verify the exact rivet SDK package name and method signatures
   (`start` / `createSession` / `prompt` / event names) against the installed version
   during Phase 0.
2. **Message-history store and truncation.** Backend DB on the platform, local file
   standalone; pick a truncation or summarization policy so replay does not grow tokens
   unbounded.
3. **Concurrency placement.** Dispatch agent invokes through the taskiq worker, or bound a
   synchronous `/invoke` with a semaphore? Depends on what the playground expects.
4. **Claude Code ACP-mode span completeness.** Confirm the current beta behavior before
   relying on Claude Code traces; a known bug may drop `interaction`/`tool` spans.
5. **Daytona snapshot contents.** Settle exactly what the snapshot pre-installs (rivet,
   both harness CLIs, both adapters, the `agenta-otel` extension) and how it is built.

## Future (returns only if we change the lifecycle)

- A warm shared daemon multiplexing concurrent invokes would re-introduce the per-session
  env problem (fork an adapter to read ACP `_meta.traceparent`, TypeScript not Rust) and
  the need for a filesystem jail. The per-invoke model avoids both.

## Next step

Phase 0 spike. See [`plan.md`](plan.md).
