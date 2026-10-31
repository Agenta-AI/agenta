# Tasks

Status: sections 2, 3 and 4 are replaced by `small-team-roles` and are not built. The tombstone table and its write shipped in M3, and removing them is a separate cleanup.

Prerequisites: M3 in production; M6 merged. Parentheses name the spec requirement.

## 1. Per-turn usage (first release)

- [ ] 1.1 Make the runner always send `trace_id` on turn append. (Writers and precedence)
- [ ] 1.2 Usage columns and concurrent index in `core_oss`; migration gate. (Usage stored on each turn)
- [ ] 1.3 Runner usage, `record_trace_usage`, turn fields, Fern client, `TurnMetrics`. (Writers and precedence; Displays read the turn; Unavailable is not zero)

## 2. Linkage (replaced)

- [ ] 2.1 Stamp the session id on every span in the runner and the SDK agent tracing; ingest promotion. (Linkage)

## 3. Measurement (replaced)

- [ ] 3.1 Run the measurement in design decision 5; choose the filter payload; record the numbers for owner review. (Span readability rule)

## 4. Read scope (replaced)

- [ ] 4.1 `SpanReadScope`, `TraceAccessService`, `MaintenanceOperation`; required `scope` on every read. (Caller scope on every read; Maintenance only and fail closed)
- [ ] 4.2 Pass the caller's scope from the three routers, `query_spans`, saved queries, invocations, annotations, evaluations; maintenance scope only in ingest and usage write-back. (Caller scope on every read)
- [ ] 4.3 `access.restricted`; scope errors out of `@suppress_exceptions`; dashboard partial marker. (Restricted analytics are marked; Access errors are not empty results)
- [ ] 4.4 Flag on after full rollout; drop the M3 trace-reader disclosure with it. (Span readability rule)

## 5. QA matrix

OSS, and EE with RBAC on and off. Real-stack tests.

| Boundary | Test |
| --- | --- |
| Turn usage | Viewer without `VIEW_SPANS` sees cost; precedence; turn cost equals trace cost on a staging sample. |
