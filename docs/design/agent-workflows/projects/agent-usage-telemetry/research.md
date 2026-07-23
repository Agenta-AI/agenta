# Research

## Executive finding

The first correctness failure is the runner contract, not the API price table. Pi and Claude
already expose cache-aware usage, but the runner collapses it into four ambiguous scalars. ACP
context occupancy is then stored as token usage. The Python service and Vercel projection preserve
only that reduced shape.

The API has independent problems that matter once the upstream data is correct. It accepts direct
`ag.metrics.unit.costs.*` attributes, then overwrites them with a LiteLLM calculation. Its tree
rollups retain only prompt, completion, and total. Identical metrics on a parent and child are both
treated as incremental.

## Current path

```text
Pi message usage -------------------+
                                     +--> runner AgentUsage --> /run result --> Python AgentResult
Claude PromptResponse.usage --------+             |                    |
ACP usage_update.used/cost ----------+             |                    +--> workflow span
                                                   +--> runner OTLP spans

runner and service OTLP spans --> API adapters --> Agenta attributes --> cost calculation
                                                               |--> tree rollup --> query/UI
```

## Harness and runner findings

### The neutral contract loses information

`services/runner/src/protocol.ts` defines both the streamed `usage` event and final `AgentUsage`
as input, output, total, and cost. It cannot represent cache reads, cache creation, reasoning,
currency, provenance, context occupancy, or whether a value is provisional or final.

### Pi has richer facts

Pi assistant messages expose:

- uncached input tokens;
- output tokens;
- cache-read tokens;
- cache-write tokens;
- a total token count;
- a cost breakdown and total calculated from Pi's model catalog.

`services/runner/src/tracing/otel.ts` preserves cache fields on each Pi LLM span, but its run
accumulator keeps only input, output, total, and cost. The Pi extension writes that lossy object to
`.agenta-usage.json`, and the outer runner prefers the file wholesale over other sources.

Pi therefore helps with token and cost tracking, but its cost must carry honest provenance. Unless
the provider itself returned the monetary amount, call it harness-calculated rather than billed.

### Claude over ACP exposes two different concepts

The installed Claude ACP adapter returns final `PromptResponse.usage` with input, output,
cached-read, cached-write, and total tokens. It separately streams `usage_update` with:

- `used`: current context occupancy;
- `size`: context-window capacity;
- `cost.amount` and `cost.currency`: the Claude SDK's run cost when available.

The runner currently assigns `used` to `usage.total`, drops `size` and currency, then reads only
input and output from the final prompt response. It discards both cache buckets and the explicit
total. This makes provisional context data compete with final billed usage.

### Source reconciliation is all-or-nothing

The current precedence is Pi writeback, otherwise final prompt tokens plus stream cost. A partial
writeback suppresses complementary fields from another source. Reconciliation needs field-level
precedence and provenance.

### ACP tracing has lower call-level fidelity

Local Pi instrumentation produces one LLM span per assistant/model call. The ACP tracer creates
one synthetic LLM span for the full prompt run because ACP does not expose equivalent per-call
lifecycle and usage detail. The design should preserve correct run totals without presenting them
as per-call measurements.

## Runner-to-service findings

- `WireAgentUsage` in `sdks/python/agenta/sdk/agents/wire_models.py` closes the schema to the same
  four fields. Golden wire fixtures and generated catalog tests pin it.
- Runtime `AgentResult.usage` becomes an untyped dictionary, so new fields can cross permissively
  but have no semantic or validation protection.
- `record_usage` in `sdks/python/agenta/sdk/agents/tracing.py` projects only input, output, total,
  and bare cost onto the workflow span. It drops cost-only usage because it gates on a truthy
  token total.
- The Vercel stream adapter allowlists the same four fields. A streamed ACP context snapshot can
  win over a corrected terminal result because both use the same `usage` event type.
- Failed runs can incur tokens and cost but return no final usage on the shared error path.

Changing this boundary requires updates to the TypeScript protocol, Python wire model and DTO,
catalog schema, result and event goldens, Vercel projection decision, and transport tests.

## Service-to-API and semantic-convention findings

### Span attributes are the transport

Yes, cache reads currently cross the service-to-API boundary as OTLP span attributes. The runner
uses `gen_ai.usage.cache_read.input_tokens` and
`gen_ai.usage.cache_creation.input_tokens`. The Logfire/GenAI adapter maps them to Agenta token
metrics.

This is only transport mapping. It does not define the complete Agenta metric semantics, cost
breakdown, attribution, or rollup behavior.

### Existing Agenta attributes can carry cost today

The default Agenta adapter accepts `ag.*` attributes. The span builder rewrites
`ag.metrics.unit.costs.*` to `ag.metrics.costs.incremental.*`. A producer can therefore send a
reported total through the existing OTLP transport without inventing a standard GenAI cost key.

However, the API unconditionally runs `calculate_costs` for supported span types and replaces the
entire incremental cost dictionary with a LiteLLM prompt/completion estimate. This contradicts
the public cost guide, which says calculation is a fallback when cost is absent.

### Current Agenta rollups are closed

Cost and token rollups hardcode prompt, completion, and total. Cache and reasoning keys may survive
initial extraction but disappear from cumulative metrics. A correct extension needs schema-driven
or generic numeric-vector rollup with explicit invariants.

### OpenTelemetry meanings constrain normalization

The supported OpenTelemetry GenAI vocabulary treats:

- `gen_ai.usage.input_tokens` as inclusive input tokens;
- cache-read and cache-creation input tokens as input subcategories;
- `gen_ai.usage.output_tokens` as inclusive output tokens;
- reasoning output tokens as an output subcategory.

Adding cache tokens again to an already normalized `input_tokens` value would double count them.
Pi and Claude raw fields instead expose mutually exclusive uncached input and cache buckets, so
the runner must normalize them before emitting OTel attributes.

The current OTel registry does not define a monetary cost span attribute. `gen_ai.usage.cost`
should not be presented as standard. Agenta needs a documented extension for cost, currency, and
provenance.

### Parent rollups can double count

Pi places usage on leaf LLM spans and repeats run totals on the agent span. The ACP tracer stamps
the final total on its synthetic LLM span and its agent span. The Python service repeats totals on
the workflow span because its OTLP batch is separate. The API treats all these values as
incremental and adds parent values to child cumulative values.

Incremental usage must have one owner. Parent summaries need an explicitly cumulative/summary
representation or must be omitted when leaf spans are present.

## Storage and UI findings

- Trace storage and analytics largely support arbitrary nested numeric paths.
- Observability presets and cells expose only prompt/completion/total cost and token totals.
- The UI does not label reported versus estimated cost.
- Adding cache, reasoning, or cost provenance to stored attributes does not automatically make
  them discoverable or understandable in the trace UI.

## Documentation gaps

The public semantic-convention page lists only prompt/completion/total. It does not define cache,
reasoning, inclusive totals, currency, provenance, or attribution. The cost guide says explicit
cost is preserved, while the API currently overwrites it. The API tracing guide describes
`ag.metrics` as server-computed even though producers can supply incremental metrics.

Any stable-boundary implementation must update:

- `docs/docs/observability/trace-with-opentelemetry/03-semantic-conventions.mdx`;
- `docs/docs/observability/trace-with-python-sdk/06-track-costs.mdx`;
- `docs/docs/reference/api-guide/10-tracing.mdx`;
- the agent-workflows interface inventory for runner-to-harness, service-to-runner, and trace
  export.

## Related work

`docs/design/agent-workflows/projects/otel-run-recorder-refactor/` proposes separating the ACP run
recorder from OTel span emission. The usage normalization reducer belongs in the protocol-neutral
recorder side of that boundary. This project defines its data semantics and can land before or as
part of that refactor without depending on a file move.

