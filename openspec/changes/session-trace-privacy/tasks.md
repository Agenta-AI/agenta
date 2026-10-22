# Tasks

Prerequisites: M3 in production; M6 merged. Parentheses name the spec requirement.

## 1. Per-turn usage and tombstone writes (first release)

- [ ] 1.1 Make the runner always send `trace_id` on turn append. (Writers and precedence)
- [ ] 1.2 Usage columns, concurrent index, tombstone table in `core_oss`; migration gate. (Usage stored on each turn; Privacy tombstone)
- [ ] 1.3 Runner usage, `record_trace_usage`, turn fields, Fern client, `TurnMetrics`. (Writers and precedence; Displays read the turn; Unavailable is not zero)
- [ ] 1.4 Tombstone write in `delete_session`; cleanup in the EE retention flush. (Privacy tombstone)

## 2. Linkage

- [ ] 2.1 Stamp the session id on every span in the runner and the SDK agent tracing; ingest promotion. (Linkage)

## 3. Measurement

- [ ] 3.1 Run the measurement in design decision 5; choose the filter payload; record the numbers for owner review. (Span readability rule)

## 4. Read scope

- [ ] 4.1 `SpanReadScope`, `TraceAccessService`, `MaintenanceOperation`; required `scope` on every read. (Caller scope on every read; Maintenance only and fail closed)
- [ ] 4.2 Pass the caller's scope from the three routers, `query_spans`, saved queries, invocations, annotations, evaluations; maintenance scope only in ingest and usage write-back. (Caller scope on every read)
- [ ] 4.3 `access.restricted`; scope errors out of `@suppress_exceptions`; dashboard partial marker. (Restricted analytics are marked; Access errors are not empty results)
- [ ] 4.4 Flag on after full rollout; drop the M3 trace-reader disclosure with it. (Span readability rule)

## 5. QA matrix

OSS, and EE with RBAC on and off. Real-stack tests.

| Boundary | Test |
| --- | --- |
| Span rule | Bob with `VIEW_SPANS` gets no root or child span of Alice's private session on any read route; share and unshare. |
| Tombstone | Alice deletes a private session; Bob still gets none of its spans; a deleted project-visible session keeps the old rule. |
| Linkage | Children ingested before the root are filtered. |
| Service reads | Saved query with `include_traces`, invocation, annotation, evaluation and `query_spans` reads filtered by the caller. |
| Fail closed | Core database down: span query and analytics return an error, not empty. |
| Turn usage | Viewer without `VIEW_SPANS` sees cost; precedence; turn cost equals trace cost on a staging sample. |
| Latency | Largest projects stay within budget. |
