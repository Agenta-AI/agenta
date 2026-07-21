# Research — what the code gives us today

Everything below is verified against current code. `file:line` where a specific symbol is
cited. Anything not verified is listed as an open question, not a fact.

## Current wiring (what Overview renders now)

`web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/overview/index.tsx`
composes, via dynamic import:

- `DeploymentOverview` — `web/oss/src/components/pages/overview/deployments/DeploymentOverview.tsx`
  (dev / staging / prod environment cards).
- `VariantsOverview` — `web/oss/src/components/pages/overview/variants/VariantsOverview.tsx`
  (prompt/variant list).
- `ObservabilityOverview` — `web/oss/src/components/pages/overview/observability/ObservabilityOverview.tsx`
  (the Requests / Latency / Cost / Tokens charts).
- `LatestEvaluationRunsTable` — from `web/oss/src/components/EvaluationRunsTablePOC`.

The header block resolves the current workflow from `currentWorkflowAtom`
(`@/oss/state/workflow`) and works for both apps and evaluators. The four content views are
prompt-asset-shaped: environments, variants, evaluations. Only `ObservabilityOverview`
(the charts) is arguably agent-relevant, and even it is labelled in prompt terms
("Requests").

## Data sources available for agent-native views

### 1. Runs / outcomes — tracing

Agent execution emits OTel-style traces. DTOs in `api/oss/src/core/tracing/dtos.py`:
`SimpleTrace(Link, Lifecycle)` with `SimpleTraceKind` = {ADHOC, EVAL, PLAY} and
`SimpleTraceChannel` = {OTLP, WEB, SDK, API}; `Invocation(SimpleTrace)`. Spans carry
semantic-convention attributes (`ag.*`, `gen_ai.*`) verified present in the SDK and API:

- `ag.meta.final_result` — the run's result summary ("what it did"). **Verified present.**
- `ag.meta.agent_name`, `ag.meta.model_name`, `ag.meta.provider`.
- `ag.tool.name`, `ag.meta.tool.name`, `ag.meta.tool.call.{result,arguments,id}` — tool
  calls, for "which tools it used" and pass/fail.
- `ag.data.outputs.completion` — text output (for message-output agents).
- `ag.data.multimedia.image.url` — image output.
- `ag.metrics.unit.tokens.{total,prompt,completion,reasoning,cache_read,cache_creation,cached}`
  — token breakdown incl. cache savings.
- `ag.metrics.acc.duration.total` — run duration. **Verified present.**
- `ag.exception.{type,message,stacktrace,escaped}` — failure reason inline.
- `gen_ai.usage.{cost,input_tokens,output_tokens,total_tokens,cache_read.input_tokens}`.

Per-run cost, duration, tools-used, tokens, outcome, and failure reason are all derivable
from a single trace. The existing charts already aggregate over traces.

**Context usage** (how full the model's context window gets) — prior art exists and is now
settled across a stacked pair. Reuse it; do not reinvent:

- **PR #5402** (`fe-feat/session-context-info`, Arda) introduced the composer's
  context-budget indicator.
- **PR #5434** (`feat/extend-arda's-session-context-work`, Ashraf, stacked on #5402)
  supersedes the parts below and is the current source of truth.

Files:
- `web/oss/src/components/AgentChatSlice/assets/contextBudget.ts` — `computeContextBudget`
  (occupancy only).
- `web/oss/src/components/AgentChatSlice/components/ContextBudgetIndicator.tsx` — the ambient
  meter (`maxTokens: number | null` prop).
- `contextWindowForModel` — exported from `@agenta/entities/workflow`.

What #5434 establishes (and **corrects the earlier finding in this research**):

- **The context window IS available to the frontend — from the model catalog, not a
  hardcoded map.** The SDK's `model_catalog.py` ships each model's `context_window` on the
  **harness catalog** the FE already fetches — `GET /workflows/catalog/harnesses/`, a
  **global, project-independent** query atom (`harnessCatalogQueryAtom` in
  `web/packages/agenta-entities/src/workflow/state/inspectMeta.ts`, disk-seeded to
  localStorage, background-revalidated), exposed via `harnessCapabilitiesAtomFamily("")`.
  (NOT the `/inspect` response — inspect carries no behavior-changing `meta`; the file's own
  header comment says so.) #5434 deleted the hardcoded `MODEL_CONTEXT_WINDOWS` map +
  substring resolver and replaced them with an exact-id lookup:
  `contextWindowForModel(capabilities, harness, modelId)` →
  `capabilities[harness]?.model_catalog?.find(e => e.id === modelId)?.context_window ?? null`
  (`@agenta/entities/workflow`). No new endpoint, every model in the picker covered
  automatically, exact match instead of a guess. (This overrides the prior note that "the
  backend stores only cost"; the *registry* does, but the *harness-capabilities doc* carries
  `context_window`. No litellm follow-up needed.)
- **`harness` is now a required input.** `useAgentModelKeyStatus` returns `harness` (from
  `agent.harness.kind`, e.g. `pi_core` / `claude`); the lookup is per-harness + per-model.
- **`context_window: null` still happens** for some catalog entries (e.g. the Claude
  `default` alias) → degrade to a raw token count, no bar/percent. The fix is a data change
  in `model_catalog.py`, not frontend.
- **Occupancy is the locked measure.** #5434 dropped the `Σ` running-sum from both the data
  layer and the UI (it double-counted resent history and never dropped). Occupancy = the
  latest turn's total tokens = how full the window is now; drops after a compaction.
- **UI is an ambient meter**, not a raw dual readout: a slim fill bar + "Context N% used",
  escalating neutral → amber (`>= 0.75`) → red ("Context almost full", `>= 0.9`); exact
  counts (`407k / 1M tokens`) in the tooltip.
- **Token source (FE):** per-turn usage is stamped on assistant messages
  (`message.metadata.usage`, read via `getMessageUsage` in
  `web/oss/src/components/AgentChatSlice/assets/trace.ts`) — no new fetch, works for live and
  reloaded sessions.

Implication for Overview: the *concept*, the *denominator selector* (`contextWindowForModel`),
and the *occupancy measure* are all shared with the composer — only the *data path differs*.
The composer reads a single live session's `messages`. Overview aggregates across many
historical runs, so it reads per-run token totals from the trace store and, for each run,
resolves the denominator with `contextWindowForModel(capabilities, harness, model)`.

Two inputs to that call are **not co-located on a run** (confirmed for open question #8):

- **`capabilities`** — the global harness-catalog atom above. Readable anywhere with
  `useAtomValue(harnessCapabilitiesAtomFamily(""))`; no `AgentChatSlice` coupling. ✅
- **`model`** — sits on the run's **LLM child spans** (`ag.meta.request.model` /
  `ag.meta.response.model`, mapped in `api/oss/src/apis/fastapi/otlp/opentelemetry/semconv.py`),
  while the token total (`gen_ai.usage.total_tokens`) is rolled onto the **workflow root**
  span (`sdks/python/agenta/sdk/agents/tracing.py:record_usage`). So pairing (model, tokens)
  per run means reading the root **and** its LLM child — a per-run detail read, not just the
  root aggregate. A run can hold multiple LLM spans; occupancy = the latest turn's total.
- **`harness`** — **not emitted on any span.** It is an agent-config property
  (`agent.harness.kind`, e.g. `pi_core` / `claude`), stable per agent. Take it from the
  agent, exactly as the composer does via `useAgentModelKeyStatus`; do not expect it on the
  trace. If the agent's harness changed since an old run, or the run's model is absent from
  the current harness's catalog, `contextWindowForModel` returns `null` → the raw-token
  degrade already designed for.

Occupancy per run = that run's latest-turn total tokens vs. its model's window. This connects
to the known token-overhead behavior (a bare turn can cost ~15K tokens from advertised tool
schemas); context usage makes that visible on Overview.

### 2. Produced artifacts — session mounts

`api/oss/src/core/mounts/dtos.py` and `.../sessions/mounts/dtos.py`:

- `Mount(Identifier, Slug, Header, Lifecycle)` — project-scoped, optional `session_id`; a
  session mount is a mount viewed through a session (`SessionMount`).
- `MountFile { path: str, size: int = 0, is_folder: bool = False, mtime: Optional[int] }`
  — `mtime` is object-store LastModified epoch ms
  (`api/oss/src/core/mounts/dtos.py:58-65`). `MountFileList` enumerates them.
- `MountFileContent { path, content }` — preview a file.
- `MountCredentials` — short-lived, prefix-scoped signed creds; the master key never
  leaves the API, scoped to `<bucket>/<project_id>/<mount_id>/*`, expires in minutes. This
  is how the UI previews/downloads a file without proxying bytes through the API.

So "files the agent produced" (name, type via extension, size, mtime, preview, download)
is fully supported. Not every agent writes files — message-output agents use §1's
`ag.data.outputs.completion` instead. The row must adapt (file chips vs. message snippet).

### 3. Needs-you items — session interactions

`api/oss/src/core/sessions/interactions/dtos.py:10-21`:

- `SessionInteractionKind` = {`user_approval`, `user_input`, `client_tool`}.
- `SessionInteractionStatus` = {`pending`, `responded`, `resolved`, `cancelled`}.
  `pending` = "awaiting a reaction" — this is the count that drives a "needs you" badge.

`user_approval` = approve/deny gate; `user_input` = the agent asked a question;
`client_tool` = a tool the client must run. A pending interaction means the agent is
blocked on the human.

### 3b. Tool usage — same live layer as the context budget (no new fetch)

Tool usage is derivable from the same live `messages` array that PR #5402's
`ContextBudgetIndicator` reads — a "Tools used" readout can mirror the context-budget one
client-side, and the Overview "Most-used tools" panel has a clean live-session equivalent.
Tool calls are message *parts*:

- A part is a tool call when `part.type.startsWith("tool-")` or `part.type === "dynamic-tool"`
  (`web/oss/src/components/AgentChatSlice/AgentConversation.tsx:193-194`; also
  `state/expandState.ts:39`, `components/ApprovalDock.tsx:26`).
- Tool name: `partToolName(part)` (`assets/toolDisplay.ts:79` — `dynamic-tool` carries it on
  `toolName`, typed parts are `type.replace(/^tool-/, "")`); human label via
  `resolveToolDisplay`.
- Outcome per call: `part.state` — `output-available` = success, `output-error` /
  `output-denied` = failed (`SETTLED` set, `components/ToolActivity.tsx:35`); also
  `input-available` (running), `approval-requested` / `approval-responded` (HITL).
- Each part also carries `toolCallId`, `input`, `output`, `errorText`. `ToolActivity.tsx`
  already renders individual calls.

So which-tools / call-count / pass-fail are all computable from the live session with no new
backend work — the composer parallel to context budget. **Overview** aggregates across
historical runs instead, from the trace store (`ag.tool.name` / `ag.meta.tool.call.result`),
per §1. Same concept, two data paths (live messages vs. trace store) — same split as context
usage.

### 4. Triggers and schedules

`api/oss/src/core/triggers/dtos.py`:

- `TriggerProviderKind` = {COMPOSIO} (`:41`); `TriggerAuthScheme` = {OAUTH, API_KEY}
  (`:45`).
- `ConnectionStatus` values READY / NEEDS_AUTH / NEEDS_INPUT (`:117-119`);
  `TriggerConnectionStatus(ConnectionStatus)` (`:187`). This drives "connection healthy vs.
  needs reconnect".
- `TriggerSubscription` (`:265`) — a subscription (e.g. Composio webhook for Slack /
  GitHub). Schedules are cron (5-field, UTC), validated via croniter and matched via
  `croniter.match`.

So "trigger source" (schedule / inbound event / manual), "next scheduled run" (from cron),
and "connection needs reconnect" (from `ConnectionStatus`) are all available.

### 5. Aggregate metrics — existing charts

`ObservabilityOverview` already computes run count, latency, cost, tokens over the trace
store. Reusable as-is; only the labels change (Requests → Runs).

## FE surfaces that already consume this data (reuse, don't rebuild)

From the platform map: `AgentChatSlice` (`AgentChatTransport`, `ClientTools`,
`ApprovalDock`, `TurnInspector`), `pages/agents`, agent-home
(templates/composer/onboarding, `useCreateAgent` ephemeral→commit). Data layer is Fern
`@agenta/api-client` via `@agenta/sdk`, with entities modules `workflow` / `gatewayTool` /
`gatewayTrigger`. Overview should link into these, and can reuse `ApprovalDock` /
`TurnInspector` for drill-down.

## Seams where this can break (the plan pins each)

1. **Aggregation cost.** Outcomes + artifacts + needs-you span traces, mounts, and
   interactions across many sessions. Naïvely fanning out per row (object-store LIST per
   run) is expensive. Cheap: already-computed chart aggregates and bounded `LIMIT N`
   recent-run lookups. Expensive: windowed GROUP BYs and per-row object-store LISTs.
2. **Not every agent produces files.** The outcomes row must degrade to message output
   when a run wrote no mount files, so the feed is never empty for text agents.
3. **Empty vs. new vs. failing-first-run** are three different zero states and must not
   collapse into one "no data" panel.
4. **Workflow-kind gating.** Overview is shared across workflow kinds via
   `RequireWorkflowKind`. Agent views must render only for the agent kind; deployment /
   variant views stay for the kinds that use them.
5. **Staleness tolerance.** `mtime` / aggregates can lag. Acceptable for Overview if we
   label freshness; not acceptable to block first paint on a slow fan-out.
