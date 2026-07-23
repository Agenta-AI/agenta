# Context

## Problem

Agent traces show token totals and monetary cost for Pi and Claude runs, but those numbers do not
have one stable meaning today.

The runner reduces every harness to:

```json
{"input": 10, "output": 5, "total": 15, "cost": 0.001}
```

That shape cannot say whether input includes cached tokens, whether cost came from the provider or
a local model catalog, which currency applies, or whether an ACP number describes billed usage or
current context occupancy. Pi and Claude both expose more information than this contract retains.

Tracing adds a second problem. The runner places usage on leaf LLM spans and repeats run totals on
agent and workflow spans to bridge separately exported OTLP batches. Agenta ingestion treats
values as incremental and rolls children into parents, so repeated totals can be counted more than
once. The API also recalculates supported-model costs with LiteLLM even when a producer supplied a
cost.

## Boundary constraints

- The harness-to-runner and runner-to-Python-service interfaces are pre-production. We can change
  them while defining the correct model.
- The service-to-API tracing boundary is more stable. A semantic-convention or ingestion change
  needs CTO approval.
- Existing trace storage is JSON-path based and can retain additional numeric attributes. The
  hard part is agreeing on meaning, normalization, rollup, and compatibility.
- A tracing failure must not fail an agent run. Missing telemetry must remain distinguishable from
  reported zero.

## Goals

1. Preserve the usage and cost facts Pi, Claude, and future harnesses actually report.
2. Separate billed token usage, monetary cost, and context-window utilization by semantic role.
3. Define inclusive input/output totals and cache/reasoning subcategories consistently with the
   supported OpenTelemetry GenAI conventions.
4. Preserve cost currency, provenance, and reported-versus-estimated status.
5. Define field-level reconciliation when final responses, stream updates, and Pi writeback each
   provide part of the result.
6. Attribute incremental usage exactly once in a trace and derive parent cumulative totals without
   double counting.
7. Propose an Agenta cost semantic convention, cache-aware fallback behavior, UI implications, and
   documentation updates for CTO review.
8. Cover partial, cancelled, resumed, multi-turn, and cost-only runs instead of only successful
   single-turn requests.

## Non-goals

- Reconstruct provider invoices when the provider or harness reports no usage.
- Pretend ACP exposes per-model-call detail that it does not expose.
- Add a new pricing service in the runner.
- Change the service-to-API contract before approval.
- Redesign the observability UI in the first implementation phase.

## Success criteria

- Cache-heavy Pi and Claude fixtures retain inclusive input, cache-read, cache-creation, output,
  total, and cost provenance through the runner-to-service result.
- ACP `used` and `size` appear only as context-utilization fields.
- Streamed provisional context never overrides final billed usage.
- Every monetary value carries a currency and source, including zero.
- A trace attributes billable usage to one level only and produces the expected cumulative total.
- The API proposal states when reported cost wins, when estimation is allowed, and how every token
  and cost bucket rolls up.
- Public semantic-convention and cost-tracking documentation is updated in the implementation that
  changes the stable tracing boundary.

