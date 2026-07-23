# QA plan

## Contract fixtures

| Case | Required assertions |
|---|---|
| Pi cache hit | inclusive input equals uncached + read + creation; details and calculated cost survive |
| Pi no cache | missing or zero cache details remain distinguishable according to source |
| Claude cache hit | all PromptResponse buckets survive; explicit total validates |
| Claude ACP update | `used/size` become context only; amount/currency become cost only |
| Repeated ACP snapshots | latest cumulative snapshot replaces; values are not summed |
| Cost-only result | reported zero/nonzero cost survives without token total |
| Cancel/error after usage | partial usage survives with partial/final status |
| Multi-turn continuation | run/turn scope prevents previous cumulative totals from being charged again |
| Unknown model | reported cost survives; estimation remains absent or explicitly unavailable |
| Invalid values | negative/non-finite values are rejected from canonical usage and diagnosed safely |
| Reported total mismatch | normalized total is canonical; raw total and mismatch status survive |
| Multi-model run | breakdown retains provider/model; each estimate is priced before aggregation |
| Mixed provenance | aggregate is marked mixed and retains component provenance |

## Wire and service tests

- TypeScript `AgentRunResult` and event goldens use the rich shape.
- Python wire schema and catalog export match TypeScript.
- Streaming and terminal results select the same final usage.
- Vercel metadata receives inclusive input/output/total only; context snapshots never appear as
  billed usage.
- Workflow tracing accepts cost-only and reported-zero usage.
- Temporary compatibility parsing, if approved, is covered in both skew directions.

## Trace-tree tests

For each supported path, assert the full stored tree rather than individual raw attributes:

- local Pi with multiple model calls;
- Daytona Pi with usage writeback;
- Claude over ACP with tools;
- streaming and one-shot requests;
- continuation/resume;
- cancellation/error after provider usage.

Each test proves:

1. incremental billable usage appears exactly once;
2. parent cumulative totals equal the sum of incremental owners;
3. cache and reasoning are subcategories and do not inflate inclusive totals;
4. context used/window are gauges, not token totals;
5. reported or calculated cost retains amount, currency, and provenance;
6. no API fallback overwrites an explicit cost after the approved API phase.
7. cost components sum once and inclusive prompt cost is not added to its subcomponents.

## API semantic-convention tests

- Standard GenAI input/output/cache/reasoning fields map to canonical Agenta metrics.
- Legacy prompt/completion aliases remain compatible without duplicate counting.
- Direct `ag.metrics.unit.costs.*` values survive ingestion.
- LiteLLM estimation runs only when cost is absent.
- Cache-aware estimation applies the correct model rates and labels the result estimated.
- Numeric-vector rollup retains every approved bucket.
- Separate or late OTLP batches do not duplicate parent and child usage.
- Unknown currencies and models fail safely without inventing USD values.
- Stored paths remain queryable through the spans and analytics APIs.

## Live reconciliation

For one cache-heavy Pi run and one cache-heavy Claude run, capture:

1. raw harness/provider usage;
2. runner final result;
3. Python service parsed result;
4. raw OTLP leaf and parent attributes;
5. stored incremental and cumulative Agenta metrics;
6. observability UI total.

Compare every bucket and cost source in one worksheet. The UI total must equal the chosen reported
or calculated source, and the trace total must not multiply when parent spans are present.

## Documentation verification

- Semantic-convention examples state inclusive and subcategory arithmetic.
- Cost docs distinguish reported, harness-calculated, and Agenta-estimated values.
- API docs identify producer-supplied incremental metrics versus server-derived cumulative metrics.
- Agent-workflows living interface docs match the implemented wire shape.
