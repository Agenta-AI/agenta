# OTel Instrumentation for the pi.dev Agent Harness

Status: research only. No code changed. Research date: 2026-06-15.

This file answers the five research questions in the agent-workflows brief:
how to instrument the pi.dev harness with OpenTelemetry (OTel), what already
exists, what span conventions to use, how spans get out of a sandbox, and how
all of that lands in Agenta's existing OTel ingestion.

## Summary

- **pi.dev is "Pi", a minimal agent harness by Earendil Inc.** (the company is
  "earendil-works" on GitHub, repo `earendil-works/pi`). It is a coding-agent
  toolkit: a unified multi-provider LLM API, an agent loop with tool calling,
  a TUI, and a CLI. It ships as npm packages `@earendil-works/pi-ai`,
  `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui`. MIT licensed.
- **"pi instruments" is not a built-in OTel exporter.** Pi has no native OTel
  emitter in its docs. What it has is an **extension event system**: an
  extension registers handlers with `pi.on(<event>, handler)` and gets
  lifecycle events for the agent loop (session, agent_start/agent_end,
  turn_start/turn_end, tool_execution_start/end, before_provider_request /
  after_provider_response, message_start/message_end). "Instrumentation" =
  writing (or installing) an extension that listens to those events and turns
  them into OTel spans. There is no first-party Pi telemetry dashboard to
  reuse.
- **Three community OTel extensions for Pi already exist** and all emit OTLP:
  `maxmalkin/pi-OTEL`, `mprokopov/pi-otel-telemetry`, and the `pi-otel` covered
  by the nikiforovall blog. They all use **OTel GenAI semantic conventions**
  (`gen_ai.*`), not OpenInference. They are TypeScript Pi extensions.
- **Agenta already ingests exactly this.** Agenta exposes an OTLP/HTTP
  protobuf endpoint at `POST /otlp/v1/traces` and normalizes incoming spans
  through an adapter registry that already understands **OTel GenAI semconv**,
  **OpenLLMetry (Traceloop)**, **OpenInference (Arize)**, **Logfire**, and
  **Vercel AI**. A Pi extension that emits `gen_ai.*` spans over OTLP/HTTP to
  Agenta's endpoint would flow through the existing pipeline with little or no
  new backend code.
- **Recommended path:** emit OTel GenAI-semconv spans from a Pi extension
  (fork/reuse one of the three), export OTLP/HTTP to Agenta's
  `/otlp/v1/traces` with `Authorization: ApiKey <key>` and `?project_id=<id>`,
  and let the existing GenAI-semconv adapter map them. Add a thin Agenta-side
  adapter only if we want richer agent/turn structure than `gen_ai.*` carries.

## What "pi instruments" is

**Product.** pi.dev = "Pi", "a minimal agent harness" by Earendil Inc. Tagline
"Adapt Pi to your workflows, not the other way around." Four operating modes:
interactive TUI, print/JSON output, RPC (stdin/stdout JSONL), and an SDK for
embedding in Node.js. It deliberately omits MCP, sub-agents, permission popups,
and plan mode from the core, expecting you to add them via extensions.
Source: https://pi.dev/ , https://github.com/earendil-works/pi/blob/main/README.md

**Packages** (npm, scope `@earendil-works`):
- `pi-ai` — unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.)
- `pi-agent-core` — agent runtime: tool calling + state management
- `pi-coding-agent` — interactive coding-agent CLI
- `pi-tui` — terminal UI library
Source: https://github.com/earendil-works/pi/blob/main/README.md

**The instrumentation mechanism is the extension event bus, not a built-in
exporter.** Pi's official docs have an "Extensions" page but **no telemetry /
OTel / observability page**. Extensions are TypeScript modules that subscribe
to lifecycle events:

```ts
pi.on(eventName, async (event, ctx) => {
  // ctx is an ExtensionContext: ctx.sessionManager (read-only session),
  // ctx.signal (abort-aware), ctx.ui (interaction)
});
```

Events relevant to telemetry (exact names from the Extensions doc):
- Session lifecycle: `session_start` (reasons: startup/reload/new/resume/fork),
  `session_shutdown`, `project_trust`, `resources_discover`.
- Agent loop: `before_agent_start`, `agent_start` (once per user prompt),
  `agent_end` (has `event.messages`), `turn_start`, `turn_end` (per LLM
  response cycle).
- Messages: `message_start`, `message_update`, `message_end` (user, assistant,
  tool-result messages).
- Tools: `tool_execution_start` (has `toolCallId`, `toolName`, `args`),
  `tool_execution_update`, `tool_execution_end`; plus `tool_call` (pre-exec,
  can block) and `tool_result` (post-exec, can modify).
- Provider/model: `before_provider_request` (built payload, before HTTP),
  `after_provider_response` (HTTP status/headers, before stream consumed),
  `model_select`, `thinking_level_select`.
- Input: `input`, `user_bash`.
Source: https://pi.dev/docs/latest/extensions

So when the agent-workflows README says runs are "instrumented through pi
instruments," concretely that means: **a Pi extension hooks these events and
produces spans/metrics.** There is no proprietary "instruments" object to
adopt; it is the standard extension API. (UNVERIFIED: whether "pi instruments"
is an internal Agenta shorthand for a specific bundled extension vs. the
generic extension mechanism. The public Pi docs only expose `pi.on` + tools.)

Installation pattern for an extension (from pi-OTEL):
`pi install git:github.com/<owner>/<repo>` (or `pi install npm:<pkg>`), then
`/reload`. Source: https://github.com/maxmalkin/pi-OTEL

## Existing libraries

### Pi-specific OTel extensions (closest fit — reuse candidates)

All three are TypeScript Pi extensions emitting OTLP and using OTel GenAI
semconv. They differ mainly in span tree shape and whether they also emit
metrics.

1. **`maxmalkin/pi-OTEL`** — "OpenTelemetry harness for the Pi coding agent."
   - Span tree: `pi.session` -> `pi.agent_turn` -> (`gen_ai.chat <model>`,
     `tool.<name>`).
   - Attributes follow OTel GenAI semconv. Honors standard OTLP env vars:
     `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT`
     (appends `/v1/traces`), `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k=v`),
     `OTEL_SERVICE_NAME` (default `pi`), `OTEL_RESOURCE_ATTRIBUTES`.
     Pi-specific: `PI_OTEL_DISABLED` (default `0`),
     `PI_OTEL_CAPTURE_CONTENT` (default `0`, gates prompt/completion/tool I/O).
     Same keys accepted in `settings.json` under `otel`. Falls back to
     `http://localhost:4318/v1/traces` (OTLP/HTTP).
   - Runtime commands: `/otel-status`, `/otel-flush`.
   - Source: https://github.com/maxmalkin/pi-OTEL

2. **`pi-otel` (nikiforovall)** — emits one trace tree per user prompt.
   - Span tree: `pi.interaction` (root, per prompt) -> `pi.turn` ->
     (`pi.llm_request`, `pi.tool.<name>`). Deliberately **does not** make the
     session a span ("a pi session can run for hours; long-running root spans
     are an OTel anti-pattern") — it correlates via `gen_ai.conversation.id`.
   - Attributes: GenAI semconv — `gen_ai.system`, `gen_ai.request.model`,
     `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, finish reason,
     tool call ids, `gen_ai.conversation.id`.
   - Config: default endpoint `http://localhost:4317` (OTLP **gRPC**),
     `settings.json` `otel` block `{enabled, endpoint, protocol:"grpc"}`,
     `OTEL_*` env overrides, `PI_OTEL_DISABLED=1` to disable. Default backend
     is a local .NET Aspire dashboard (auto-spawned via `/otel start`); any
     OTLP backend works (Grafana LGTM, Jaeger, Honeycomb).
   - Sources: https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html

3. **`mprokopov/pi-otel-telemetry`** — traces **and metrics**.
   - Span tree: `session` (root) -> `agent.prompt` (per user message) ->
     `agent.turn` (LLM call + tool cycle) -> `tool.<name>` (e.g. `tool.bash`,
     `tool.read`, `tool.edit`). Span events: `llm.request`, `model.changed`,
     `session.compacted`.
   - Metrics: `pi.tokens.input`, `pi.tokens.output` (counters); `pi.tool.calls`,
     `pi.tool.errors` (counters, labelled `tool.name`); `pi.tool.duration`
     (histogram ms); `pi.turns`, `pi.prompts` (counters);
     `pi.session.duration` (histogram s).
   - Attributes: `session.id`, `session.cwd`, token counts, user identity;
     turn spans `turn.index`, `llm.usage.input_tokens`,
     `llm.usage.output_tokens`; tool spans `tool.name`, `tool.call_id`,
     `tool.duration_ms`.
   - Config: `OTEL_EXPORTER_OTLP_ENDPOINT` default `http://localhost:4318`
     (OTLP/HTTP), `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` /
     `..._METRICS_ENDPOINT` overrides, `PI_OTEL_DEBUG=true`.
   - Source: https://github.com/mprokopov/pi-otel-telemetry

**Takeaway:** there is no single canonical Pi OTel package; the three diverge on
span-tree shape and span names (`pi.session` vs `pi.interaction` vs `session`).
What they agree on is **GenAI semconv `gen_ai.*` attributes over OTLP**. For
Agenta we should pick/fork one and pin the span tree we want; don't assume a
stable upstream contract.

### Framework instrumentations (not Pi-specific)

- **OpenInference (Arize)** — OTel-based semantic conventions + auto-instrumentors
  for LangChain, LlamaIndex, OpenAI SDK, etc. Defines 10 span kinds via the
  required `openinference.span.kind` attribute: `LLM`, `EMBEDDING`,
  `RETRIEVER`, `RERANKER`, `TOOL`, `CHAIN`, `AGENT`, `GUARDRAIL`, `EVALUATOR`,
  `PROMPT`. It does **not** ship a Pi instrumentor — Pi isn't one of its
  supported frameworks — so using OpenInference for Pi means writing the span
  kinds by hand in a Pi extension. Fit: good vocabulary for agent/tool/chain
  structure, but no off-the-shelf Pi support.
  Sources: https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md ,
  https://arize.com/docs/ax/observe/tracing-concepts/openinference-semantic-conventions

- **OpenLLMetry (Traceloop)** — OTel SDK + instrumentations that emit `gen_ai.*`
  (plus `traceloop.*`, `llm.*`) attributes. Auto-instruments LLM providers and
  some frameworks. No Pi instrumentor; same story as OpenInference — you'd hand
  off via a Pi extension or rely on its provider-level auto-instrumentation of
  the underlying LLM HTTP client (possible but indirect, and Pi's `pi-ai` may
  not match a provider Traceloop patches).
  (UNVERIFIED whether Traceloop's provider instrumentation intercepts
  `@earendil-works/pi-ai`'s HTTP calls automatically.)

- **OTel GenAI semantic conventions (official)** — the upstream spec the Pi
  extensions follow. Operation names: `create_agent`, `invoke_agent`,
  `execute_tool`, plus the chat/inference spans. Span naming guidance:
  `invoke_agent {gen_ai.agent.name}` (or just `invoke_agent`), and
  `execute_tool {gen_ai.tool.name}` for tool calls (used for MCP tool calls
  too). Key attributes: `gen_ai.operation.name`, `gen_ai.agent.name`,
  `gen_ai.agent.id`, `gen_ai.conversation.id`, `gen_ai.tool.name`,
  `gen_ai.tool.call.id`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`. This is the most "standard" and the most
  future-proof target.
  Sources: https://opentelemetry.io/docs/specs/semconv/gen-ai/ ,
  https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
  (NOTE: the gen-ai pages now redirect to the
  `open-telemetry/semantic-conventions` repo; the agent-spans operation
  names above come from the indexed spec text, lightly UNVERIFIED against the
  latest repo revision.)

## Span / attribute conventions and how well they map to agent runs

A multi-turn agent run = one logical conversation -> N user prompts ->
per-prompt agent invocation -> M turns (each an LLM call) -> per-turn 0..K tool
calls. All three conventions can express this; they differ in vocabulary.

| Layer in a Pi run | OTel GenAI semconv | OpenInference span kind | Pi extension span (varies) |
|---|---|---|---|
| Whole conversation | `gen_ai.conversation.id` (correlation, not a span) | `session.id` attr / CHAIN root | `pi.session` / `session` (or skipped) |
| Per-prompt agent invocation | `invoke_agent` op | `AGENT` | `pi.interaction` / `agent.prompt` / `pi.agent_turn` |
| Per-turn LLM call | chat/inference span, `gen_ai.request.model` | `LLM` | `gen_ai.chat <model>` / `pi.turn` / `pi.llm_request` |
| Tool call | `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id` | `TOOL` | `tool.<name>` |
| Glue/orchestration | (no dedicated kind) | `CHAIN` | n/a |
| Retrieval / rerank / embeddings | embeddings spans | `RETRIEVER` / `RERANKER` / `EMBEDDING` | n/a |

Assessment:
- **GenAI semconv** maps cleanly to LLM calls and tool calls and has explicit
  agent + tool operation names. Its weak spot is the multi-turn *tree*: it
  leans on `gen_ai.conversation.id` for correlation rather than mandating a
  session/turn span hierarchy, which is why the Pi extensions invent their own
  parent spans (`pi.session`, `pi.interaction`, `pi.turn`). Good attribute
  vocabulary; you still design the tree.
- **OpenInference span kinds** (AGENT/CHAIN/LLM/TOOL/RETRIEVER) map *very*
  cleanly to a nested agent run and are what Agenta's UI already keys off (see
  next section). The cost: no Pi auto-instrumentor, so you set
  `openinference.span.kind` yourself.
- A pragmatic hybrid works: emit GenAI `gen_ai.*` attributes (what the Pi
  extensions already produce) **and** set `openinference.span.kind` per span so
  Agenta types the node correctly. Agenta's adapters read both.

## Export-from-sandbox path

Inside a Daytona (or other) sandbox the Pi extension runs the OTel SDK and
exports OTLP. To reach Agenta's collector across the sandbox boundary:

1. **Endpoint.** Agenta accepts OTLP/HTTP **protobuf** at `POST /otlp/v1/traces`
   (mounted in `api/entrypoints/routers.py` with prefix `/otlp/v1`). Binary
   protobuf only (`Content-Type: application/x-protobuf`); JSON OTLP is **not**
   accepted. Batch size limit default 10 MB (`AGENTA_OTLP_MAX_BATCH_BYTES`,
   env `OTLPConfig.max_batch_bytes`); over-limit -> 413. (The router docstring
   says "default 4 MB"; the actual env default in `env.py` is 10 MB — doc/code
   drift worth noting.)
   Files: `api/oss/src/apis/fastapi/otlp/router.py`,
   `api/oss/src/utils/env.py` (`OTLPConfig`, line ~326),
   `api/entrypoints/routers.py` (~line 770).
   - So set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://<agenta-host>/otlp/v1/traces`
     and use the **OTLP/HTTP protobuf** exporter. The gRPC-default extension
     (nikiforovall) would need reconfiguring to HTTP/protobuf, or a collector
     sidecar to translate.
2. **Auth + tenant scope.** Agenta's auth middleware expects
   `Authorization: ApiKey <key>` (prefix `ApiKey `) and resolves
   organization/workspace/project/user from it; `project_id` can also come
   from a `?project_id=<uuid>` query param. So the exporter needs
   `OTEL_EXPORTER_OTLP_HEADERS=Authorization=ApiKey <key>` and the project id
   either in the key's scope or the URL query string. In EE the ingest path
   also checks `EDIT_SPANS` permission and `TRACES_INGESTED` quota.
   Files: `api/oss/src/middlewares/auth.py` (`_APIKEY_TOKEN_PREFIX = "ApiKey "`,
   query `project_id` handling), `api/oss/src/apis/fastapi/otlp/router.py`
   (EE permission + entitlement checks).
3. **Secret delivery.** The Agenta API key is a secret; per the agent-workflows
   README, secrets are injected into the sandbox by the startup hook. The key
   and the OTLP endpoint should be injected the same way (env vars consumed by
   the OTel SDK), so the harness running locally vs server-side only differs in
   endpoint/key values — preserving the local/server parity requirement.
4. **Trace-context propagation across the boundary.** Two cases:
   - If the agent run is *initiated by* an Agenta backend request, propagate
     W3C `traceparant`/`traceparent` into the sandbox (env or RPC metadata) so
     the in-sandbox root span is a child of the backend span and the run shows
     as one trace. (UNVERIFIED: whether Agenta currently sets/forwards
     `traceparent` to invocations — needs a check of the invocation service.)
   - If the run is standalone, the extension creates its own root and relies on
     `gen_ai.conversation.id` / `session.id` for correlation; Agenta's
     OpenInference + Logfire adapters map `session.id` /
     `gen_ai.conversation.id` -> `ag.session.id`, which lines up with the
     agent-workflows `session_id` concept.
5. **Network egress.** The sandbox must be allowed outbound HTTPS to the Agenta
   host. With Daytona this is a sandbox network-policy concern (UNVERIFIED for
   our port). A collector/agent sidecar in the sandbox is an alternative that
   also lets us batch, retry, and strip content centrally.

## How it maps to Agenta's existing OTel ingestion

Agenta already has the whole receive-and-normalize pipeline; a Pi agent is just
another OTLP producer.

- **Ingest.** `OTLPRouter.otlp_ingest` parses the protobuf
  (`parse_otlp_stream`), converts each OTel span to an internal DTO
  (`parse_from_otel_span_dto`), runs an EE quota soft-check, then queues spans
  on a Redis stream for async persistence (same path as native ingest).
  File: `api/oss/src/apis/fastapi/otlp/router.py`.
- **Normalization via adapter registry.** `AdapterRegistry` runs, in order:
  `OpenLLMmetryAdapter`, `OpenInferenceAdapter`, `LogfireAdapter`,
  `VercelAIAdapter`, `DefaultAgentaAdapter`. Each maps its vendor attributes to
  Agenta's canonical `ag.*` namespace.
  File: `api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py`.
- **GenAI semconv is already mapped.** `api/.../otlp/opentelemetry/semconv.py`
  and the OpenLLMetry adapter map `gen_ai.system`, `gen_ai.request.model`,
  `gen_ai.usage.prompt_tokens|completion_tokens|total_tokens`,
  `gen_ai.prompt.*`, `gen_ai.completion.*`, etc. -> `ag.meta.*` /
  `ag.data.*` / `ag.metrics.unit.tokens.*`. **This is precisely what the Pi
  OTel extensions emit**, so Pi `gen_ai.*` spans largely normalize today.
  - Caveat: the existing map uses the older `gen_ai.usage.prompt_tokens` /
    `completion_tokens` names. The Pi extensions emit the newer
    `gen_ai.usage.input_tokens` / `output_tokens`. Those newer keys are **not**
    in `semconv.py` yet, so token metrics from Pi would be dropped until we add
    the two aliases. (Verified by reading `semconv.py` — only `prompt_tokens` /
    `completion_tokens` / `total_tokens` are present.)
- **Span typing / agent structure.** `OpenInferenceAdapter` maps
  `openinference.span.kind` -> `ag.type.node` with
  `OPENINFERENCE_TO_AGENTA_SPAN_KIND_MAP`: `CHAIN->chain`, `RETRIEVER->query`,
  `RERANKER->rerank`, `LLM->chat`, `EMBEDDING->embedding`, `AGENT->agent`,
  `TOOL->tool`, `GUARDRAIL->task`, `EVALUATOR->task`. It also normalizes tool
  definitions (`llm.tools.{i}.tool.json_schema`), tool calls, and
  input/output messages into the canonical OpenAI shape Agenta's UI expects.
  File: `api/oss/src/apis/fastapi/otlp/extractors/adapters/openinference_adapter.py`.
- **Session correlation.** `session.id` (OpenInference) and
  `gen_ai.conversation.id` (Logfire adapter) both map to `ag.session.id`,
  which aligns with the agent-workflows `session_id`.

**Net:** the lowest-effort integration is a Pi extension emitting GenAI-semconv
spans **and** `openinference.span.kind` over OTLP/HTTP protobuf to
`/otlp/v1/traces`. To get full fidelity we'd add a small amount of backend
mapping (token-name aliases; optionally a dedicated "Pi/agent" adapter if we
want first-class agent/turn nodes instead of generic chat/tool). No new ingest
infrastructure is needed.

## Open questions

1. **Which span tree do we standardize on?** The three Pi extensions disagree
   (`pi.session` vs `pi.interaction` vs `session`; whether the session is a
   span at all). We must pin one to get a stable Agenta UI. The
   "no long-running session root" argument (nikiforovall) matters if Pi
   sessions can run for hours.
2. **Build vs fork.** Fork `maxmalkin/pi-OTEL` (OTLP/HTTP, content gate) or
   `mprokopov/pi-otel-telemetry` (also metrics) vs write our own minimal
   extension? Need to read their actual source for license/quality and to see
   the exact `pi.on(...)` wiring (the READMEs describe spans, not code).
3. **Token attribute drift.** Add `gen_ai.usage.input_tokens` /
   `output_tokens` (and `gen_ai.usage.*` newer keys) to Agenta's `semconv.py`
   so Pi token metrics aren't silently dropped. Confirm against the live
   GenAI semconv revision.
4. **Trace-context propagation.** Does Agenta forward W3C `traceparent` into an
   invocation today? If we want the in-sandbox spans stitched under the
   originating backend span, we need to propagate context across the
   harness/sandbox boundary (env var or RPC metadata). Needs a code check of
   the invocation/workflow run path.
5. **Content capture policy.** Pi extensions gate prompt/completion/tool I/O
   behind `PI_OTEL_CAPTURE_CONTENT`. Decide default (privacy vs. eval
   usefulness) and whether to enforce it server-side too.
6. **Transport mismatch.** Agenta is OTLP/HTTP **protobuf only**. The
   gRPC-default extension and any JSON-OTLP setup need reconfiguration or a
   collector sidecar in the sandbox.
7. **"pi instruments" terminology.** Confirm with whoever wrote the
   agent-workflows README whether it refers to the generic `pi.on` extension
   API or a specific Earendil/Agenta-internal "instruments" bundle. The public
   Pi docs only expose `pi.on` + tool registration; no "instruments" object.
8. **Doc/code drift.** OTLP router docstring says 4 MB max batch; `env.py`
   default is 10 MB. Worth fixing when this work lands.

## Sources

- Pi product site: https://pi.dev/
- Pi repo README: https://github.com/earendil-works/pi/blob/main/README.md
- Pi extensions doc (event system / `pi.on`): https://pi.dev/docs/latest/extensions
- Pi docs index: https://pi.dev/docs/latest
- pi-OTEL extension (maxmalkin): https://github.com/maxmalkin/pi-OTEL
- pi-otel-telemetry (mprokopov): https://github.com/mprokopov/pi-otel-telemetry
- pi-otel blog (nikiforovall): https://nikiforovall.blog/ai/productivity/2026/05/16/pi-otel.html
- Pi as customer-hosted agent runtime discussion: https://github.com/earendil-works/pi/discussions/3337
- OTel GenAI semconv (index): https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OTel GenAI agent spans: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
- OpenInference semantic conventions spec: https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
- OpenInference conventions (Arize docs): https://arize.com/docs/ax/observe/tracing-concepts/openinference-semantic-conventions
- Agenta OTLP ingest router: api/oss/src/apis/fastapi/otlp/router.py
- Agenta adapter registry: api/oss/src/apis/fastapi/otlp/extractors/adapter_registry.py
- Agenta GenAI/OpenLLMetry semconv map: api/oss/src/apis/fastapi/otlp/opentelemetry/semconv.py
- Agenta OpenInference adapter: api/oss/src/apis/fastapi/otlp/extractors/adapters/openinference_adapter.py
- Agenta auth middleware: api/oss/src/middlewares/auth.py
- Agenta OTLP config: api/oss/src/utils/env.py (OTLPConfig)
- Router mounting: api/entrypoints/routers.py
