# Agenta Agent: Trace-Triggered Optimization Answers

> Definitive answers to the 5 questions in 17-trace-triggered-optimization.md.
> Verified against API routers, service layer, SDK tracing processors, and DTOs.

---

## Q1: Trace Annotation API — Yes, it exists

**Separate router:** `api/oss/src/apis/fastapi/annotations/router.py`

| Endpoint | Method | Purpose |
|---|---|---|
| `/annotations/` | POST | Create annotation |
| `/annotations/{trace_id}` | GET | Fetch annotation by trace |
| `/annotations/{trace_id}/{span_id}` | GET | Fetch by trace + span |
| `/annotations/{trace_id}` | PATCH | Edit annotation |
| `/annotations/{trace_id}/{span_id}` | PATCH | Edit by trace + span |
| `/annotations/{trace_id}` | DELETE | Delete annotation |
| `/annotations/{trace_id}/{span_id}` | DELETE | Delete by trace + span |
| `/annotations/query` | POST | Query annotations |

Annotations are a **separate entity** from OTel spans — they store user feedback (scores, labels, comments) linked to traces/spans by `trace_id` and optional `span_id`.

**SDK addition needed:** An `Annotations` manager class. Straightforward CRUD, same pattern as everything else.

```
POST /annotations/           → create({ trace_id, span_id?, score, label, comment })
GET  /annotations/{trace_id} → get(traceId)
POST /annotations/query      → query({ trace_ids?, application_ref? })
```

---

## Q2: Trace Query by application_ref — Via attribute filtering

**There is no first-class `application_id` filter field.** The `Filtering` model uses `Condition` objects with fields from a `Fields` enum:

```
TRACE_ID, TRACE_TYPE, SPAN_ID, SPAN_TYPE, PARENT_ID, SPAN_NAME,
SPAN_KIND, START_TIME, END_TIME, STATUS_CODE, STATUS_MESSAGE,
ATTRIBUTES, EVENTS, LINKS, REFERENCES, HASHES, CREATED_AT, ...
```

To filter by application, you filter on the `ATTRIBUTES` field with a nested path:

```typescript
ag.tracing.querySpans({
  filtering: {
    conditions: [{
      field: "ATTRIBUTES",
      key: "ag.refs.application.id",
      value: applicationId,
      operator: "eq",
    }],
  },
});
```

This works because spans store application references as `ag.refs.application.id` attributes (see Q4).

**The `REFERENCES` field in the enum also exists** — but it's a raw string field name, not a parsed structured reference. The `ATTRIBUTES` path is how the frontend does it.

**SDK implication:** The `Filtering` type in our SDK is currently `Record<string, unknown>`. It should stay that way for flexibility — the condition structure is complex (`field`, `key`, `value`, `operator`, `options`). We could add a convenience method:

```typescript
// Convenience for common filter patterns
ag.tracing.queryByApplication(applicationId, options?)
```

---

## Q3: Playground Invocations — Server-side via `llm_apps_service`

**There IS an invoke mechanism**, used by both the playground and the evaluation runner.

**Service:** `api/oss/src/services/llm_apps_service.py`

**Single invoke:** `invoke_app(uri, datapoint, parameters, ...)` — POSTs to `{uri}/invoke`

**Batch invoke:** `batch_invoke(uri, testset_data, parameters, rate_limit_config, ...)` — runs multiple invocations with rate limiting

**How it works:**
1. Fetch the application revision to get `data.url` (the deployment endpoint)
2. Fetch `data.parameters` (the prompt config)
3. Extract OpenAPI schemas to parse inputs
4. POST to `{url}/invoke` with `{ data: { parameters, inputs }, references: { application, revision } }`
5. The service captures the trace automatically

**For the SDK:** We don't need a new "playground" endpoint. The evaluation runner already does this via `batch_invoke`. For single invocations outside of evaluation runs, we could add:

```typescript
ag.applications.invoke({
  applicationRef: { slug: "rh-onboarding" },
  revisionRef: { id: revisionId },
  inputs: { user_message: "hi" },
}) → { output, traceId }
```

This would call the same `llm_apps_service.invoke_app()` under the hood. But **note**: this requires the application to be deployed (have a running service at `data.url`). For builtin apps (`agenta:builtin:*`), Agenta's own service handles it. For custom apps, the user's service must be running.

---

## Q4: Trace References in Spans — `ag.refs.*` attributes

**Stored as span attributes** with the `ag.refs.{entity}.{field}` naming pattern.

**Source:** `sdk/agenta/sdk/engines/tracing/processors.py` lines 74-76, 137-146

```python
# From TracingContext.references:
for key, ref in context.references.items():
    if isinstance(ref, dict):
        for field, value in ref.items():
            span.set_attribute(f"ag.refs.{key}.{field}", str(value))
```

**Attribute names:**
- `ag.refs.application.id`
- `ag.refs.application.slug`
- `ag.refs.application_variant.id`
- `ag.refs.application_revision.id`
- `ag.refs.evaluator.id`
- `ag.refs.testset.id`

**The references come from `TracingContext`** which is set when the SDK invokes the application. During evaluation runs, the runner sets these references. During playground invocations, the `build_invoke_request()` function includes them in the request payload.

**For the my-agent project:** If your agent is instrumented via Agenta's Python SDK or OTel, these refs should be set automatically during invocations. If you're calling the agent directly (not through Agenta's invoke), you'll need to ensure your OTel instrumentation includes `ag.refs.application.id` and `ag.refs.application_revision.id` in span attributes.

**Check your current instrumentation at `lib/telemetry.ts`** — does it set `ag.refs.*` attributes? If not, the trace-triggered flow won't be able to identify which app produced a given trace.

---

## Q5: Prompt Diff — No endpoint, client-side comparison

**No diff/compare endpoint exists.** The revision system supports delta-based commits (for environments and testsets), but there's no "give me the diff between revision A and revision B" API.

**To implement revision comparison:**
1. Fetch revision A: `POST /preview/applications/revisions/retrieve` with `application_revision_ref: { id: revA }`
2. Fetch revision B: same endpoint with `{ id: revB }`
3. Compare `data.parameters` client-side

For structured prompt diffs, you'd compare the `parameters.prompt.messages[].content` strings. This is a client-side utility, not an SDK addition:

```typescript
function diffPromptRevisions(revA: ApplicationRevision, revB: ApplicationRevision) {
  const messagesA = revA.data?.parameters?.prompt?.messages ?? [];
  const messagesB = revB.data?.parameters?.prompt?.messages ?? [];
  // Use a diff library or simple string comparison
}
```

**SDK implication:** No new endpoints needed. The existing `ag.revisions.retrieve()` method already supports fetching any revision by ref. Add a convenience method if desired:

```typescript
ag.revisions.compare(revisionIdA, revisionIdB) → { added, removed, changed }
```

But this is purely client-side logic.

---

## Summary: What's Missing vs What Exists

| Capability | Status | SDK Addition |
|---|---|---|
| Trace annotations | **Exists** — `/annotations/*` endpoints | New `Annotations` class (CRUD) |
| Trace query by app | **Exists** — filter on `ag.refs.application.id` attribute | Convenience method on `Tracing` |
| Playground invoke | **Exists** — `llm_apps_service.invoke_app()` | New `invoke()` method on `Applications` (or keep in evaluation flow) |
| Trace references | **Exists** — `ag.refs.*` span attributes | Verify `lib/telemetry.ts` sets them |
| Prompt diff | **Does NOT exist** — no server endpoint | Client-side utility (compare two revisions) |

**Bottom line:** Most of the infrastructure for trace-triggered optimization already exists. The SDK needs:
1. `Annotations` manager (new class, ~100 lines)
2. A convenience `queryByApplication()` on `Tracing`
3. Verification that the my-agent OTel instrumentation includes `ag.refs.*` attributes

No significant new infrastructure required.
