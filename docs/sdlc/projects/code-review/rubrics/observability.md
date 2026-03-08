# rubrics/observability.md – Observability Review

**Domain:** Logging, metrics, tracing, and operability as properties of the code under review.
**Universal criterion:** Observability (10) — full depth.  See `criteria.md` for the baseline questions that apply in every review.
**Applies to:** Any change that introduces a new service, a background worker, a message consumer, a critical code path, or any path with a latency or availability SLO.

> **Scope note:** This rubric assesses whether the *code under review* emits sufficient signals for production diagnosis.  It does not audit the monitoring infrastructure or dashboards.

---

## Goals

- Verify that failures produce enough signal to reconstruct what happened without attaching a debugger.
- Confirm that latency and error rates are measurable for every path with an SLO.
- Ensure that distributed traces can be followed across service and process boundaries.
- Identify operational gaps that will make the system hard to deploy, roll back, or operate.

---

## Checklist

### Logging

| # | Criterion | Severity if violated |
|---|---|---|
| O‑1 | Errors are logged at `error` level with sufficient context: operation name, relevant IDs (request, user, trace), and the error message | high |
| O‑2 | Logs are structured (JSON or key-value pairs); no free-form multi-line strings that break downstream parsing | medium |
| O‑3 | Log levels are applied correctly: `debug` for development detail, `info` for significant state transitions, `warn` for recoverable anomalies, `error` for actionable failures | medium |
| O‑4 | Errors are not silently swallowed; a `catch` / `except` block that does nothing or only logs at `debug` is a red flag | high |
| O‑5 | Sensitive data (PII, credentials, tokens, secrets) is absent from all log output | high |
| O‑6 | A correlation or request ID is included in every log line so that a single request can be traced across all log entries | medium |
| O‑7 | Log volume at `info` and above is proportionate; hot paths do not emit unbounded log output | medium |

### Metrics

| # | Criterion | Severity if violated |
|---|---|---|
| O‑8 | Latency is measured and emitted as a histogram or summary for every path with a latency SLO | high |
| O‑9 | Error counts are emitted as a counter, separated by error type or status code | medium |
| O‑10 | Throughput (requests, events, records processed) is tracked for any consumer, worker, or batch job | medium |
| O‑11 | Queue depths, pool utilisation, and buffer sizes are exposed as gauges where the service manages shared resources | medium |
| O‑12 | Metric labels do not have unbounded cardinality (e.g., user IDs or URL paths must not be labels) | high |

### Tracing

| # | Criterion | Severity if violated |
|---|---|---|
| O‑13 | Distributed trace spans are created for cross-service and cross-process calls; each span includes operation name, outcome, and key attributes | medium |
| O‑14 | Span context is propagated through async boundaries: message queues, background workers, callbacks, and scheduled jobs | high |
| O‑15 | Spans are closed in all code paths, including error paths; no resource leak from unclosed spans | medium |
| O‑16 | Internal high-cost operations (expensive queries, external API calls, cache misses) are wrapped in child spans to aid localisation | medium |

### Operability

| # | Criterion | Severity if violated |
|---|---|---|
| O‑17 | A liveness or readiness endpoint exists and reflects the true state of the service's dependencies (database, cache, message broker) | medium |
| O‑18 | The change can be deployed and rolled back independently; no hard coupling to a simultaneous migration or co-deploy | high |
| O‑19 | Configuration is externalised and changeable without a code deploy; defaults are safe for production | medium |
| O‑20 | Feature flags or progressive rollout is used for high-risk behavioural changes, enabling rollback without a deployment | medium |
| O‑21 | New failure modes introduced by the change are documented in a runbook or on-call notes | low |

---

## Scoring guidance

**High** findings: O‑4 (silent errors), O‑5 (PII in logs), O‑8 (missing latency on SLO paths), O‑12 (unbounded metric cardinality), O‑14 (lost trace context across async boundaries), O‑18 (cannot roll back independently).  These are high because they either hide failures, create compliance risk, break monitoring infrastructure, or complicate incident response.

**Medium** findings: structure, level discipline, ID propagation, span completeness.  These degrade diagnosability over time but do not block operation on day one.

When assessing O‑8, confirm whether the code path has an SLO before escalating to high — paths without SLOs default to medium.
