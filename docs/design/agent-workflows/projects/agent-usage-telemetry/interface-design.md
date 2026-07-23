# Interface design

## Design rules

The contract groups fields by semantic role:

- `usage`: consumed/generated units and monetary charges for this run;
- `context`: a point-in-time runtime gauge, not billing data;
- tracing metadata: how a fact maps onto a span and whether it is incremental or cumulative.

Missing and zero are different. Every number must be finite and non-negative. Producers preserve
reported totals instead of silently replacing them with arithmetic when a provider's semantics do
not match the canonical invariant.

## Proposed runner-to-service result

```jsonc
{
  "usage": {
    "tokens": {
      "input": 12000,          // inclusive: uncached + cacheRead + cacheCreation
      "output": 800,           // inclusive: includes reasoning when reported that way
      "total": 12800,
      "details": {
        "uncachedInput": 1000,
        "cacheReadInput": 10500,
        "cacheCreationInput": 500,
        "reasoningOutput": 300
      }
    },
    "costs": {
      "total": {
        "amount": 0.021,
        "currency": "USD"
      },
      "details": {
        "uncachedInput": 0.003,
        "output": 0.012,
        "cacheReadInput": 0.001,
        "cacheCreationInput": 0.005
      },
      "provenance": {
        "kind": "reported",            // reported | calculated | estimated
        "source": "provider",           // provider | harness | agenta
        "sourceName": "anthropic"
      }
    },
    "status": "final"
  },
  "context": {
    "usedTokens": 12800,
    "windowTokens": 200000,
    "source": "acp",
    "observedAt": "2026-07-12T12:00:00Z"
  }
}
```

The final naming should follow the existing wire's camelCase convention. `usage.tokens` and
`usage.costs` are run-level cumulative facts. They do not claim per-LLM-call fidelity.

### Token invariants

- `input` follows current OTel GenAI meaning and includes every input token.
- Cache-read and cache-creation counts are subcategories of `input`, not additive siblings after
  normalization.
- `output` includes every output token. Reasoning is a subcategory when the provider reports it.
- `total`, when canonical, equals `input + output`.
- `details.uncachedInput + cacheReadInput + cacheCreationInput` should equal `input` when all
  three mutually exclusive raw buckets are known. A missing detail stays missing.
- Never calculate a missing cache bucket by subtraction unless the source contract guarantees all
  other buckets are complete.

### Cost invariants

- Currency is required whenever any monetary amount exists. Version one supports USD but keeps
  currency explicit.
- `reported` means a provider or provider SDK supplied the amount.
- `calculated` means the harness calculated it from a model catalog and observed token buckets.
- `estimated` means Agenta calculated it after ingestion as a fallback.
- Zero is a valid reported amount. Absence means unknown.
- A total may exist without component costs. Do not invent a prompt/output split.
- `uncachedInput`, `cacheReadInput`, `cacheCreationInput`, and `output` are mutually exclusive
  cost components when all are known. Their sum equals `total`.
- Compatibility `prompt` cost is inclusive input-side cost. It equals uncached input plus cache
  read plus cache creation and must not be added to those details again.
- Cost provenance is metadata, not a numeric metric bucket.

### Context invariants

- `usedTokens` and `windowTokens` are gauges observed at one time.
- They never populate `usage.tokens.total`.
- A newer context snapshot replaces an older snapshot. Usage snapshots instead follow their
  declared run/turn scope and aggregation rules.

## Harness normalization

| Source | Canonical mapping | Authority |
|---|---|---|
| Pi message `input`, `cacheRead`, `cacheWrite` | sum to inclusive input; retain exclusive details | final per Pi model call |
| Pi `output`, optional reasoning detail | inclusive output plus detail | final per Pi model call |
| Pi `cost.*` | cost components/total, USD, calculated by harness unless provider reporting is proven | calculated |
| Claude `PromptResponse.usage` | normalize input + cached-read + cached-write, output, and explicit total | final run tokens |
| Claude ACP `usage_update.used/size` | context used/window only | latest gauge |
| Claude ACP `cost.amount/currency` | run cost snapshot | provider-reported via SDK |

Future adapters must document whether their input/output fields are inclusive before mapping them.

## Internal observation type

Normalization operates on observations before producing the aggregate result:

```jsonc
{
  "scope": "model_call",
  "temporality": "delta",
  "status": "provisional",
  "resource": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "responseModel": "claude-sonnet-4-6",
    "operation": "chat"
  },
  "tokens": { /* normalized token facts */ },
  "costs": { /* amount, currency, provenance */ },
  "context": { /* only for gauge observations */ },
  "observedAt": "2026-07-12T12:00:00Z"
}
```

Resource identity is required before Agenta estimates a component. Multi-model runs aggregate
reported monetary values only when currencies match. Estimation remains model-scoped and sums the
components after pricing each model separately. The final run result may expose one aggregate plus
optional `breakdown` entries keyed by provider, response model, operation, and currency. It must
not collapse heterogeneous observations before estimation.

Cost provenance is attached to each breakdown entry. The aggregate may carry one provenance only
when every component has the same kind and source. Otherwise its provenance is `mixed` and the
breakdown is required.

Token status and validation quality survive on the final result. If a provider total conflicts
with normalized inclusive input plus output, retain the reported total as `reportedTotal`, emit
the normalized arithmetic total as `total`, and mark `validation.status="mismatch"`. Do not send
the inconsistent provider number as the canonical rollup total.

## Reconciliation reducer

Replace whole-object precedence with a field-level reducer:

1. Validate every observation and retain its source, scope, temporality, and final/provisional
   status internally.
2. Use final Pi message/writeback or final Claude prompt response for token usage.
3. Use the latest final provider-reported cost. Fall back to harness-calculated cost. Do not
   estimate in the runner.
4. Keep the latest ACP context gauge separately.
5. Accumulate incremental Pi model-call observations once. Do not sum repeated cumulative ACP
   snapshots.
6. Preserve partial usage on cancellation and error when the harness reported it.
7. Emit exactly one final run-level usage record. Provisional context uses a distinct event type.

Recommended neutral events:

```jsonc
{"type": "context_usage", "usedTokens": 12000, "windowTokens": 200000}
{"type": "usage", "scope": "run", "status": "final", "usage": { /* shape above */ }}
```

The Vercel adapter may initially project inclusive input/output/total to its established usage
metadata. It must not project `context_usage` as billed usage.

## Exact result and event placement

`AgentRunResult.usage` holds the final run aggregate and optional resource breakdown. A sibling
`AgentRunResult.context` holds the last context gauge for diagnostics. The terminal result always
contains the final usage when known, including on partial/error completion.

Streaming uses `context_usage` for provisional gauges and at most one `usage` event with
`status=final` for the settled run aggregate. The terminal result repeats the final aggregate as
the authoritative transport result. Stream adapters de-duplicate the event/result pair rather
than choosing whichever arrived first.

## Trace attribution

### Incremental owner

Billable usage belongs exactly once:

- Pi with per-call instrumentation: each leaf LLM span owns its incremental usage.
- ACP without per-call usage: the synthetic run LLM span owns the run usage and is explicitly a
  run-level approximation.
- Agent and workflow parents expose derived cumulative values only. They do not repeat the same
  values as incremental metrics.

Separate OTLP batches currently prevent the API from deriving a parent total in one ingest pass.
The implementation must choose one reviewed bridge:

1. export a clearly marked cumulative summary on the remote parent;
2. teach ingestion to reconcile later-arriving children before cumulative query results;
3. stop duplicating and accept that an isolated parent batch has no total until trace-level query
   aggregation.

The current approach, repeating `gen_ai.usage.*` on every level, is not acceptable because those
attributes are interpreted as incremental.

## Service-to-API semantic-convention proposal

This section is a proposal pending CTO approval.

### Attribute classification

The implementation must pin one supported OTel GenAI semantic-convention version and maintain one
authoritative mapping table. Every emitted field is classified as `otel_standard`,
`compatibility_alias`, or `agenta_extension`.

Input and output usage are current OTel GenAI fields. Cache and reasoning dotted fields are
already supported by Agenta's Logfire adapter and appear in current OTel GenAI registries, but
their exact status must be verified against the pinned version before the design calls them
standard. Until then, treat them as supported compatibility fields:

```text
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
gen_ai.usage.cache_read.input_tokens
gen_ai.usage.cache_creation.input_tokens
gen_ai.usage.reasoning.output_tokens
```

Keep legacy prompt/completion and total attributes only as documented compatibility aliases at
ingestion. Pin the supported OTel GenAI vocabulary/version in one authoritative mapping table
instead of letting `semconv.py` and individual adapters drift.

### Agenta cost extension

OTel currently has no standard GenAI monetary cost attribute. Emit the established Agenta metric
namespace:

```text
ag.metrics.unit.costs.total
ag.metrics.unit.costs.input
ag.metrics.unit.costs.output
ag.metrics.unit.costs.cache_read_input
ag.metrics.unit.costs.cache_creation_input

ag.meta.cost.kind          = reported | calculated | estimated
ag.meta.cost.source        = provider | harness | agenta
ag.meta.cost.source_name   = anthropic | pi | litellm | ...
ag.meta.cost.currency      = USD
```

Compatibility can continue exposing prompt/completion cost, with these definitions:

- `prompt` is the total input-side cost, including uncached input, cache reads, and cache creation;
- `completion` is total output-side cost;
- detailed buckets are subcomponents and must not be added again to `prompt` or `total`.

The API must preserve producer-supplied cost. LiteLLM estimation runs only when no reported or
harness-calculated total exists. Estimated values carry `kind=estimated`, `source=agenta`, and the
pricing source/version when available.

### Agenta token extension and rollups

Ingestion should normalize standard OTel fields into canonical Agenta token metrics with inclusive
input/output plus optional cache/reasoning subcategories. Rollups must retain arbitrary approved
numeric buckets or use a schema table, rather than hardcoding three keys.

The semantic-convention documentation must state whether each subcategory is included in its
parent and define total arithmetic. This prevents cache and reasoning double counting.

## Compatibility and versioning

- Change the pre-production `/run` result and event schema directly, with updated goldens.
- Keep a temporary parser for the old flat four-field result only if deployed runner/service skew
  can occur during rollout.
- Do not silently reinterpret old `input` as inclusive. Version or normalize based on the wire
  shape.
- Keep service-to-API additions backward compatible. Existing prompt/completion/total queries
  continue to work while detailed paths become available.
- Update public docs in the same PR that changes API semantics.
