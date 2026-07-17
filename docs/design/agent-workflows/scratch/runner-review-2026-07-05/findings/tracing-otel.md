# Tracing review: `services/runner/src/tracing/otel.ts`

Scope: `src/tracing/otel.ts` (1,315 lines), its two call sites (`src/engines/sandbox_agent.ts`,
`src/extensions/agenta.ts`), and its tests (`tests/unit/otel-skills-error.test.ts`,
`tests/unit/stream-events.test.ts`, `tests/unit/startup-banner.test.ts`). Cross-checked against
Agenta's OTel ingest conventions in `api/oss/src/apis/fastapi/otlp/extractors/adapters/*.py` and
`api/oss/src/apis/fastapi/otlp/opentelemetry/semconv.py`. Read-only review; no source changed.

## The event -> span pipeline, as verified

Two independent tracer factories live in the same file and build the SAME conceptual span tree
(`invoke_agent` AGENT -> `turn N` CHAIN -> `chat <model>` LLM / `execute_tool <name>` TOOL), from
two different event sources:

- **`createAgentaOtel`** (lines 408-639) — a Pi extension factory. Pi runs in-process (local
  runs only) and calls back via `pi.on(event, handler)` for real lifecycle events
  (`before_agent_start`, `agent_start`, `context`, `turn_start`, `before_provider_request`,
  `message_end`, `tool_execution_start/end`, `turn_end`, `agent_end`). One `turn`/`chat` span
  pair is opened per actual Pi-internal turn, so a multi-round tool-calling loop shows N chat
  spans with per-call usage.
- **`createSandboxAgentOtel`** (lines 872-1315) — used by `engines/sandbox_agent.ts` for every
  harness driven through `sandbox-agent`/ACP (Claude always; Pi too when on Daytona or when
  `emitSpans` forces span-less mode false). Fed by `handleUpdate(update)` on each ACP
  `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
  `tool_call_update`, `usage_update`). Opens exactly **one** `turn 0`/`chat` pair for the whole
  run in `start()`, and one `execute_tool` span per ACP tool-call id.

Both factories share: `ensureProvider()` (one process-wide `NodeTracerProvider` +
`TraceBatchProcessor`), the `traceTargets`/`exporterCache` maps, `flushTrace(traceId)`, and the
`parentContext(traceparent)` W3C-context bridge. `TraceBatchProcessor` buffers a trace's spans by
`traceId` and exports in one OTLP batch either when the local root span ends or when the caller
calls `flushTrace` explicitly (the cross-boundary case, since `invoke_agent`'s parent is remote
and never ends in this process). `runSandboxAgent` (`engines/sandbox_agent.ts:685-939`) always
calls `run.finish()` then `await run.flush()` before returning, on both the success and
`catch` paths, so under normal operation a run's spans do export before the process/response
returns.

Verified against the Python ingest side: `ag.meta.*` and `ag.exception.*` are genuinely
recognized top-level buckets (`canonical_attributes.py`), so the code comments about avoiding
`ag.agent.*`/`ag.error.*` relocation to `ag.unsupported.*` are correct, not superstition. The
dual "current + legacy" `gen_ai.usage.*` emission (lines 376-386) is a deliberate, justified
hedge against exactly the kind of adapter-mapping drift this review found elsewhere (see #1).

## Strengths — keep this

- The defensive design principle "tracing must never break the run" is explicit in comments and
  mostly honored: `record()`'s sink call is try/caught, `recordError` is fully try/caught, and
  the call site wraps `flush()` in `.catch(() => {})`.
- `orderParentFirst` (189-216) is a correct, well-reasoned preorder-DFS with a documented
  same-millisecond tie-break rationale and a defensive "never drop an unreached span" fallback.
- The W3C traceparent parsing/bridging (`parentContext`, 219-235) is spec-correct (`00-<trace>-<span>-<flags>`,
  sampled-bit honored, remote context).
- The streaming startup-banner suppression (`splitLeadingBanner`, 761-796) correctly handles a
  banner straddling chunk boundaries without over-buffering a genuine answer — a genuinely
  tricky streaming problem, backed by its own dedicated test file.
- `stream-events.test.ts` scenarios 4-6 specifically pin the real, tricky Pi wire behavior
  (empty-args announcement refreshed by a later `tool_call_update`) rather than an idealized
  version of the protocol — good instinct to test the actual observed quirk.
- Per-run span state (`agentSpan`, `toolSpans`, etc.) is correctly closure-scoped so concurrent
  runs' own span references never collide — the isolation design is right for most state; see
  #5 for the part of the state that is NOT scoped this way.
- The dual current/legacy `gen_ai.usage.*` emission for prompt/completion tokens shows the author
  already anticipated adapter-mapping drift for the base token counts — just not applied
  consistently to every metric (#1, #11).

## Findings

### 1. [HIGH] Cache-token attribute keys don't match either Python ingest mapping — silently dropped
`src/tracing/otel.ts:387-393`

```ts
if (u.cacheRead)
  span.setAttribute("gen_ai.usage.cache_read_input_tokens", u.cacheRead);
if (u.cacheWrite)
  span.setAttribute("gen_ai.usage.cache_creation_input_tokens", u.cacheWrite);
```

Agenta's own ingest recognizes only the **dotted** form:
`api/oss/src/apis/fastapi/otlp/extractors/adapters/logfire_adapter.py:190,192-193`:
`("gen_ai.usage.cache_read.input_tokens", "ag.metrics.unit.tokens.cache_read")` and
`("gen_ai.usage.cache_creation.input_tokens", "ag.metrics.unit.tokens.cache_creation")`. The
legacy fallback table (`semconv.py:18-19`) has no cache-token entries at all. Checked every other
adapter (`openinference_adapter.py`, `openllmetry_adapter.py`, `default_agenta_adapter.py`,
`vercelai_adapter.py`) — none map the underscore form either.

What/why: a Claude run using Anthropic prompt caching (heavy read/write reuse, a real and
increasingly important cost signal) will show **zero** cache tokens in Agenta despite Pi's
extension capturing them correctly in `msg.usage.cacheRead`/`cacheWrite` — silent metric loss,
no error anywhere, because the emitted key simply matches nothing on ingest.

Recommendation: change the emitted keys to the dotted form (`cache_read.input_tokens`,
`cache_creation.input_tokens`), or — matching the existing dual-emit pattern for
prompt/completion tokens at 379-386 — emit both forms defensively. Add a test that pins the
literal key string against a copy of the Python mapping (or at minimum a comment citing the file
and line so the two sides get updated together next time either changes).

Horizon: short.

### 2. [HIGH] A duplicate `tool_call` notification for the same id orphans the previous span
`src/tracing/otel.ts:1109-1141`

Every `kind === "tool_call"` event unconditionally does `tracer.startSpan(...)` then
`toolSpans.set(id, {...})`, with no check for an existing entry. If a second `tool_call` arrives
for an id already open (a retried/duplicated ACP notification, or a future harness that resends
the announcement), the first span reference is overwritten in the map and never `.end()`'d —
it's silently dropped (not exported; the trace is missing that `execute_tool` span) rather than
merely duplicated.

Recommendation: in the `tool_call` branch, if `toolSpans.has(id)`, treat it like
`tool_call_update`'s refresh path (update the input, don't create a second span) instead of
blindly overwriting.

Horizon: short.

### 3. [HIGH] `tool_call_update` for an id that never had a `tool_call` silently vanishes the whole call
`src/tracing/otel.ts:1143-1158`, `maybeCloseTool` at `1176-1199`

If the initial `tool_call` notification is lost, reordered, or simply never arrives (an ACP
transport hiccup, or events crossing on the same tick), `toolSpans.get(id)` is `undefined` in
both the args-refresh branch and `maybeCloseTool`. Both silently no-op: no span is ever created,
no `tool_call` event is recorded, and the later `tool_call_update` (even one carrying
`status: "completed"`) produces no `tool_result` either. The tool call disappears from the trace
**and** from `events()`/the live stream entirely — with no log line — even though the harness
genuinely ran a tool. This is the concrete "event-ordering assumption" failure mode the review
was scoped to find.

Recommendation: when `tool_call_update` arrives for an unknown id, synthesize a minimal
`tool_call` record (best-effort `name: "tool"`, `input: update.rawInput`) before applying the
rest of the update, and log once via stderr so a swallowed sequence is at least observable in
practice, rather than only in theory.

Horizon: short.

### 4. [MEDIUM] Force-closed orphan tool spans never get a matching `tool_result` event
`src/tracing/otel.ts:1285-1286` (`finish()`) vs. the rest of the events log

A tool call that starts but never completes before the stream ends (crash mid-run, or the
prompt racing the HITL pause signal — see `engines/sandbox_agent.ts:862-871`) gets its **span**
force-`.end()`'d in `finish()`, but no compensating `tool_result` is ever `record()`'d. A
consumer that pairs `tool_call` -> `tool_result` (the FE, or the HITL correlation logic in
`engines/sandbox_agent/client-tools.ts`) is left with a call that never resolves.

Recommendation: in `finish()`, for every entry still in `toolSpans`, also emit
`{ type: "tool_result", id, output: "", isError: true }` so every `tool_call` is guaranteed a
terminal counterpart.

Horizon: short/medium.

### 5. [HIGH] Process-wide export state is keyed only by `traceId`; two concurrent runs sharing a traceparent corrupt each other's export
`src/tracing/otel.ts:68-160` (module-level `traceTargets`, `exporterCache`,
`TraceBatchProcessor.buffers`), `start()`/`agent_start` (`499-504`, `1056-1057`)

The file's own docstring says "the service may drive several runs in one process" (the HTTP
sidecar, `server.ts`). Per-run span *references* are correctly closure-scoped, but the export
plumbing is not: `TraceBatchProcessor.buffers` is a single `Map<traceId, ReadableSpan[]>`, and
`traceTargets` is a single `Map<traceId, ExportTarget>`. A W3C child span inherits its parent's
trace id, so **two concurrent `/run` calls that carry the same `traceparent`** (plausible: a
parallel sub-agent fan-out under one workflow span, or a caller-side retry of the same request)
produce spans with the identical `traceId`. Consequences:

- `traceTargets.set(traceId, ...)` from the second run silently overwrites the first run's
  export target (endpoint/credential) — could belong to a different project.
- Both runs' spans interleave into the **same** `buffers` entry.
- The auto-flush heuristic (`if (!span.parentSpanId) this.flush(traceId)`) fires on whichever
  run's `agentSpan` happens to end first, which `flush()`+**deletes** the whole buffer — sweeping
  up the other run's already-ended spans early and leaving its still-open spans unbuffered when
  it later tries to flush an now-empty/wrong-target entry.

Recommendation: scope the buffer/target keys by `(traceId, per-run correlation id)` rather than
`traceId` alone, or move to one real per-run exporter/processor pair instead of a shared global
buffer. At minimum, log loudly if `traceTargets` already holds an entry for a `traceId` when a
new run starts — that's the tripwire for this scenario actually occurring.

Horizon: medium (structural; not yet observed in practice, but plausible given the file's own
stated multi-run-per-process design, and worth a guard before it ships wider).

### 6. [HIGH] OTLP export failures are silently swallowed — never logged, never surfaced
`src/tracing/otel.ts:136-145` (`TraceBatchProcessor.flush`)

```ts
return new Promise((resolve) =>
  getExporter(target).export(orderParentFirst(spans), () => resolve()),
);
```

The exporter's callback receives an `ExportResult` (`{ code, error }`) and it is discarded
entirely — success and failure resolve identically. If the OTLP endpoint is unreachable, the
Authorization header is stale/wrong (401), or the 10s `timeoutMillis` is hit, the run still
returns `ok: true` and the trace simply never appears in Agenta, with zero log line anywhere in
the process. Given tracing ships to production next week, this is exactly the "does it degrade
silently, and is the silence logged" failure mode the review was scoped to catch — today: yes,
and no.

Recommendation: check `result.code !== ExportResultCode.SUCCESS` in the callback and write one
stderr line with the `traceId` and `result.error`; consider threading a `tracingDegraded` flag
onto the run result so the Python side can alert distinctly from a real agent failure.

Horizon: short.

### 7. [MEDIUM] `exporterCache`/`traceTargets` have no eviction — unbounded growth over process lifetime
`src/tracing/otel.ts:71`, `140-141`

`exporterCache` is a `Map` keyed by `endpoint+authorization`, never pruned, each entry holding a
live `OTLPTraceExporter` (a keep-alive HTTP client). If the Authorization value is per-request
rather than a stable per-project key (`request.telemetry.exporters.otlp.headers.authorization`
is read fresh off every request in `engines/sandbox_agent.ts:694`), a long-lived sidecar process
(`server.ts`) accumulates one exporter per distinct token forever. `traceTargets` is deleted on
flush so it is self-bounded *unless* a run never reaches flush (see #3, #5, #8), in which case
those entries also leak permanently.

Recommendation: cap `exporterCache` with a bounded LRU (closing evicted exporters via
`.shutdown()`), and confirm with the Python/service side whether the OTLP Authorization header
is in fact stable per project — if so, document that assumption at the cache; if not, the cache
needs eviction regardless of the rest of this review.

Horizon: medium.

### 8. [MEDIUM] `finish()` is not defensively wrapped, unlike `recordError` and the call site's own pattern
`src/tracing/otel.ts:1250-1300` (finish) vs. `1213-1248` (recordError, internally try/caught) and
`engines/sandbox_agent.ts:945-947`

```ts
otel?.recordError(error, request.provider);
otel?.finish();                    // not wrapped
await otel?.flush().catch(() => {}); // wrapped
```

The stated design principle ("tracing must never break the run") is enforced for `recordError`
(its own internal try/catch) and for `flush()` at the call site, but not for `finish()` itself.
If `emitMessages`/`stampUsage`/`span.end()` throws for any reason (a malformed event field, an
unexpected `null`), the exception propagates out of the `catch` block in `runSandboxAgent`,
turning what should be a graceful `{ ok: false, error }` result into an unhandled promise
rejection — the opposite of what the surrounding code is trying to guarantee.

Recommendation: wrap the body of `finish()` in try/catch (mirroring `recordError`'s own pattern),
or at minimum wrap the call site the same way `flush()` already is.

Horizon: short.

### 9. [MEDIUM] The streaming (live-sink) path likely double-emits the final `usage` event
`src/tracing/otel.ts:921-933` (`setUsage`), `engines/sandbox_agent.ts:879-886` (`run.setUsage(usage)`
always called before `run.finish()`, regardless of whether a live `emit` sink is wired)

```ts
function setUsage(finalUsage: AgentUsage | undefined): void {
  if (!finalUsage) return;
  usage = finalUsage;
  const event: AgentEvent = { type: "usage", ...finalUsage };
  if (!sink) {
    const index = events.findLastIndex((e) => e.type === "usage");
    if (index !== -1) { events[index] = event; return; }
  }
  record(event);
}
```

The one-shot (no-sink) branch de-duplicates by overwriting the last "usage" entry in `events[]`.
The streaming branch skips that guard entirely (`if (!sink)` only covers the no-sink case) and
always calls `record(event)` — so a live consumer that already received one or more
`usage_update`-driven "usage" events during the run gets **another** one right before `done`,
duplicating the final total. The only existing test asserting "final usage replaces stream-only
usage" (`stream-events.test.ts` scenario 3) exercises the **no-sink** path
(`createSandboxAgentOtel({ ..., emitSpans: false })` with no `emit`); there is no equivalent
assertion for the sink-present path, so this asymmetry is untested as well as (apparently) live.

Recommendation: apply the same "replace, don't append" semantics regardless of whether a sink is
wired (the dedup is over `events[]`, not the sink itself — skip re-emitting to the sink only if
the value is unchanged, or always replace-then-flush-the-replacement). Add a streaming-path test
mirroring scenario 3.

Horizon: short (cheap fix; needs a test either way).

### 10. [MEDIUM] Pi-native and ACP tracers emit structurally different span-tree granularity for the same kind of run
`src/tracing/otel.ts:1060-1078` (`createSandboxAgentOtel.start`, one `turn 0`/`chat` pair, ever)
vs. `513-548` (`createAgentaOtel`, a new `turn`/`chat` pair per real Pi `turn_start`/
`before_provider_request`)

`createAgentaOtel` opens a new turn/chat span pair per actual internal LLM round (so a multi-step
tool-calling loop shows N `chat` spans with per-call usage). `createSandboxAgentOtel` opens
**exactly one** `turn 0`/`chat` span for the entire run in `start()` and never reopens it,
regardless of how many tool-call round trips the ACP stream reports — there is no ACP signal
consumed to detect a new provider round, so all model interaction (however many actual LLM calls
underlie it) collapses into one span whose usage is the run's grand total, not a per-call
breakdown. For Claude/other non-Pi harnesses doing multi-step tool loops, this is a materially
less informative trace than the same kind of run on Pi.

Recommendation: either explicitly document this as an accepted ACP protocol limitation (today
`session/update` gives no clean "new provider round" boundary), or investigate whether one can
be synthesized (e.g., a new `chat` span each time `agent_message_chunk` resumes after a
`tool_call_update: completed`, mirroring the streaming banner logic's own text/tool
interleaving detection at `958-1021`).

Horizon: long (either needs upstream ACP signal or a deliberate product decision to accept the
gap).

### 11. [MEDIUM] Agent-span/chat-span construction and usage-stamping are duplicated between the two factories, and have already drifted
`src/tracing/otel.ts:476-505` vs `1036-1058` (agent span setup); `528-548` vs `1065-1078` (chat
span setup); `applyAssistant` (`363-402`) vs `stampUsage` (`911-919`)

Both factories independently set `openinference.span.kind`, `gen_ai.operation.name`,
`gen_ai.agent.name`, `ag.meta.skills.*`, `session.id`/`gen_ai.conversation.id`, and call
`setInputs(...)` for the agent span — near-identical ~30-line blocks. The chat-span setup is
duplicated the same way. The usage-stamping logic is *also* duplicated and has already drifted:
`applyAssistant` sets `gen_ai.response.finish_reasons`, `gen_ai.response.model`,
`gen_ai.response.id`, and cache tokens; `stampUsage` sets none of these. Some of that gap is
legitimate (ACP's `usage_update` genuinely carries less data than Pi's in-process message, see
finding #16) — but because the logic is duplicated rather than shared, the gap is an accidental
byproduct of copy-paste rather than a decision visible at either call site.

Recommendation: extract shared helpers used by both factories — `startAgentSpan(tracer, parent,
{harness, sessionId, skills, prompt, capture})`, `startChatSpan(tracer, parent, {provider,
modelId, messages, capture})`, and a single `stampGenAiUsage(span, usage, { cache?, finishReason?
})` — so future attribute additions/renames (including the fix for #1) happen exactly once.

Horizon: medium (pairs naturally with the decomposition in #15).

### 12. [LOW] Event payloads are `any`-typed throughout the state machine
`src/tracing/otel.ts` — every `pi.on(...)` handler (`468, 472, 509, 513, 528, 550, 559, 579, 590,
605`), `handleUpdate(update: any)` (`1081`), `messageText(msg: any)`, `applyAssistant(span, msg:
any, ...)`, `toolResultText(result: any)`

The file's entire correctness burden is "does this event shape map to the right span operation,"
yet none of it is statically checked — a property rename upstream (the Pi SDK or the ACP client)
silently becomes a runtime no-op (`event?.toolCallId` just reads `undefined`) instead of a
compile error. `@earendil-works/pi-coding-agent` ships real `pi.on` event types, and ACP's
`SessionUpdate` is a known discriminated union; most of these `any`s look avoidable.

Recommendation: introduce a minimal local `AcpSessionUpdate` union covering the 4-5 kinds this
file actually switches on, and type `handleUpdate`/`maybeCloseTool` against it; type the Pi
`pi.on` callbacks against the SDK's own event types rather than `any`.

Horizon: medium.

### 13. [LOW] Attribute-key strings are duplicated as literals across the TS/Python boundary with no shared source of truth
`src/tracing/otel.ts` (~40 literal keys: `gen_ai.usage.input_tokens`, `ag.meta.skills.loaded`,
`openinference.span.kind`, etc.) vs. Python's `logfire_adapter.py` / `semconv.py` /
`openinference_adapter.py`, which independently hardcode the same strings in mapping tables —
verified in this review to already disagree once (#1).

Recommendation: at minimum, centralize the TS-side literals into a local `tracing/attrs.ts`
constants module (cheap, in-repo, no cross-language tooling needed) so a future rename is a
TypeScript compile error on this side. Longer-term, flag to whoever owns the ingest adapters that
a generated/shared attribute-key manifest — checked by a contract test the way `protocol.ts` /
`wire.py` are pinned by golden fixtures (per this repo's own `services/runner/CLAUDE.md`) — would
have caught #1 before it shipped.

Horizon: medium/long.

### 14. [LOW] Pi startup-banner text-scrubbing is a distinct concern living inside the OTel file
`src/tracing/otel.ts:696-796` (`isBannerLine`, `stripStartupBanner`, `splitLeadingBanner`)

~100 lines of pi-acp startup-banner regex-scrubbing (a harness-output-cleanup concern with
nothing to do with span/attribute mapping) live in the middle of the tracing state machine,
exported purely so `tests/unit/startup-banner.test.ts` can test it as its own thing — which it
already effectively is. This is direct evidence for the split proposed in #15: the seam is
already proven by the existing separate test file.

Recommendation: move to its own module (e.g. `tracing/pi-startup-banner.ts`), imported by the ACP
tracer. Mechanical, low-risk.

Horizon: short.

### 15. Decomposition proposal for the 1,315-line file

Cut along the seams the tests already imply, not along arbitrary line counts:

- **`tracing/exporter.ts`** (~230 lines) — `TraceBatchProcessor`, `ensureProvider`/`provider`/
  `processor`, `exporterCache`, `traceTargets`, `getExporter`, `defaultTarget`, `flushTrace`,
  `orderParentFirst`, `parentContext`, `targetKey`. Pure lifecycle/resource-management code.
  **Currently has zero direct test coverage** — every existing test fakes `createOtel`
  (`sandbox-agent-orchestration.test.ts`) or spies the OTel tracer, never a real exporter/
  processor. Splitting it out makes that gap visible and easy to close (a fake `SpanExporter` +
  a couple of `TraceBatchProcessor` unit tests would directly cover #5, #6, #7).
- **`tracing/attributes.ts`** (~150 lines) — `setOutput`, `setInputs`, `emitMessages`,
  `applyAssistant`, `stampUsage` (merged per #11), `messageText`, `toolResultText`,
  `lastAssistantText`, `oiRole`, `splitModel`. Pure functions, trivially unit-testable
  independent of the OTel API.
- **`tracing/pi-startup-banner.ts`** (~90 lines) — `isBannerLine`/`stripStartupBanner`/
  `splitLeadingBanner`; already has its own test file, just needs its own module.
- **`tracing/pi-extension-tracer.ts`** (~230 lines) — `createAgentaOtel` + `RunConfig`.
- **`tracing/acp-tracer.ts`** (~350 lines) — `createSandboxAgentOtel` + `acpBlockText`/
  `hasToolArgs`/`acpToolContentText`.
- `tracing/otel.ts` becomes a thin barrel (or is deleted and the two call sites
  `extensions/agenta.ts` / `engines/sandbox_agent.ts` import directly from the new paths).

Judged against the existing tests: `stream-events.test.ts` only needs `acp-tracer.ts` +
`attributes.ts`; `otel-skills-error.test.ts` needs `acp-tracer.ts` + `pi-extension-tracer.ts` +
`attributes.ts`; `startup-banner.test.ts` only needs the banner module. No existing test
currently exercises `exporter.ts` — closing that gap should happen as part of the split, not
after it.

Horizon: medium (do alongside the correctness fixes above, before the file grows further).

### 16. [LOW] ACP chat spans never get `gen_ai.response.finish_reasons`/`response.model`/`response.id`
`stampUsage` (`911-919`) vs `applyAssistant` (`364-372`)

ACP's `usage_update` genuinely carries no finish-reason/response-id, so `stampUsage` can't set
them from the stream directly — but the run's own `stopReason` **is** known by the time
`finish()` runs (`engines/sandbox_agent.ts` resolves it from the raced prompt result) and is
never threaded into `finish()` to stamp on `llmSpan`; it only reaches the HTTP result, not the
trace.

Recommendation: thread `stopReason` into `finish(stopReason?)` and set
`gen_ai.response.finish_reasons` on `llmSpan` before ending it, mirroring what the Pi path already
does per-turn.

Horizon: medium.

### 17. [LOW] Failed tool-call spans get bare ERROR status, no exception/message, unlike run-level errors
`maybeCloseTool` (`1186-1191`) vs `recordError` (`1213-1248`)

A failed tool call sets `SpanStatusCode.ERROR` and whatever raw output text happened to come
back as `output.value` — no `recordException`, no explicit error-message attribute — much
thinner diagnostics than the run-level error handling built for F-030 (message + provider +
`recordException` + status).

Recommendation: on `status === "failed"`, also call
`entry.span.recordException({ name: "ToolCallError", message: out || "tool call failed" })` for
parity and debuggability.

Horizon: low/medium.

## Top 10

1. **[HIGH, short]** Cache-token attribute keys (`cache_read_input_tokens`/
   `cache_creation_input_tokens`) don't match either Python ingest mapping table — prompt-cache
   token/cost data is silently dropped end to end. (#1)
2. **[HIGH, short]** `tool_call_update` for an id whose `tool_call` was lost/reordered silently
   erases the whole tool call from the trace and the event log — no span, no events, no log.
   (#3)
3. **[HIGH, short]** OTLP export failures are never checked or logged — a dead endpoint or bad
   credential means a trace just never shows up, with zero visibility anywhere. (#6)
4. **[HIGH, medium]** `TraceBatchProcessor`/`traceTargets`/`exporterCache` are process-wide state
   keyed only by `traceId`; two concurrent runs sharing a traceparent (plausible per the file's
   own "several runs in one process" design) can corrupt each other's export. (#5)
5. **[HIGH, short]** A duplicate `tool_call` notification for the same id silently orphans the
   previous span (never `.end()`'d, never exported). (#2)
6. **[MEDIUM, short]** `finish()` isn't defensively wrapped like `recordError`/`flush()` are — an
   exception inside it can turn a graceful `{ok:false}` result into an unhandled rejection. (#8)
7. **[MEDIUM, short]** The streaming path likely double-emits the final `usage` event; only the
   no-sink path is tested/de-duplicated. (#9)
8. **[MEDIUM, medium]** Split the 1,315-line file along the seams the tests already prove exist
   (exporter / attributes / banner / pi-extension-tracer / acp-tracer), and use the split to close
   the current zero-coverage gap on the exporter/lifecycle code. (#15)
9. **[MEDIUM, medium]** Agent-span/chat-span construction and usage-stamping are duplicated
   between the two factories and have already drifted (finish_reasons/response.model/cache
   tokens present on one side only, not by decision). (#11)
10. **[MEDIUM, long]** Pi and every other harness get structurally different span-tree
    granularity for the same kind of run (Pi: one chat span per real round; ACP: always exactly
    one, however many rounds actually happened) — either document as an accepted ACP limitation
    or investigate a fix. (#10)
