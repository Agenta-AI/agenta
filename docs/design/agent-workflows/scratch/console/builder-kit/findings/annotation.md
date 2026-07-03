# Trace annotation as an agent-callable tool — findings

Date: 2026-07-01
Question: Is trace annotation implemented as an agent-callable tool/op, or not yet?

## TL;DR

**Not implemented as an agent-callable op.** The annotations REST API works and is
production-grade, but nothing in the agent tool surface exposes it. There is no
`annotate_trace` (or any annotation) entry in the platform-op catalog, and no
gateway/builtin/MCP tool for it. The gap is **known and documented** as a porting
recommendation in the `builder-agent-reliability` project — it is scoped but deliberately
deferred, not built.

Notably, the *run-context plumbing* an `annotate_trace` op would need already exists (the
run's own `trace_id`/`span_id` are captured and bindable). Only the catalog entry is
missing.

## 1. Confirmation: no agent-facing annotation tool

- **Platform-op catalog** — `sdks/python/agenta/sdk/agents/platform/op_catalog.py:470`
  (`PLATFORM_OPS`). The catalog has 19 ops: `find_capabilities`, `query_workflows`,
  `commit_revision`, `find_triggers`, `create_schedule`, `create_subscription`, the
  trigger list/pause/resume/remove ops, and `test_subscription`. **No `annotate` /
  `annotation` op.** The only "annotat" match in the file is `from __future__ import
  annotations` (line 27).
- **Builtins / gateway / MCP** — grepping `agenta_builtins.py`, `sdk/agents/tools/`, and
  `services/oss/src/agent/` finds no annotation tool. The only hits are the Python typing
  `Annotated` import and a doc-comment in `services/oss/src/agent/tracing.py:164` that
  literally names the missing use case ("the ids a self-targeting tool binds ...
  `$ctx.trace.trace_id` for 'annotate my trace'") — i.e. the binding token is reserved for
  this, but no op consumes it yet.
- **Run-context is ready.** `RunContextTrace` (`sdks/python/agenta/sdk/agents/dtos.py:440`)
  already models `trace_id` + `span_id` with the docstring "A tool that acts on the run's
  own trace (e.g. 'annotate my trace') binds `$ctx.trace.trace_id` ...". The service
  populates it per-run from the active OTel span
  (`services/oss/src/agent/tracing.py:161` `_run_context_trace()`). So the self-targeting
  binding an `annotate_trace` op needs is already wired end-to-end; only the catalog entry
  is absent.

## 2. Is it planned / deferred / never scoped? — Deferred, and documented

It is explicitly scoped as a gap in the `builder-agent-reliability` project:

- `projects/builder-agent-reliability/build-notes.md:35` — "**Case 3 (trace annotation)
  exposes a gap.** The annotations endpoint works, but there is no agent-callable
  `annotate_trace` op, so a self-reflecting agent can't annotate its own trace today.
  Documented as a porting recommendation; did not hack a fake tool." Line 51 records the
  standing constraint that `op_catalog.py` was left untouched during that work.
- `projects/builder-agent-reliability/use-cases.md:40` — use case 3, "Self-reflecting
  agent (trace annotation): after a conversation, reflects on it and annotates its own
  traces," names this as an intended capability the builder kit should be able to wire.
- `projects/builder-agent-reliability/status.md:173` — notes "trace annotation has no
  [agent-callable op]" among the known approximations.

No design doc proposes the op's concrete shape yet, and there is no PR. Status: **scoped,
deferred, awaiting a decision to port — not started.**

## 3. What an annotation minimally requires (and why it is not trivially a "simple" op)

An annotation is a special SimpleTrace. Contracts:

- API: `POST /api/annotations/` (mounted at prefix `/annotations`, so `/api/annotations/`),
  handler `create_annotation` in `api/oss/src/apis/fastapi/annotations/router.py:102`.
  Request wrapper is `AnnotationCreateRequest` = `{ "annotation": AnnotationCreate }`
  (`.../annotations/models.py:19`).
- `AnnotationCreate` (`api/oss/src/core/annotations/types.py:48`) is a `SimpleTraceCreate`
  (`api/oss/src/core/tracing/dtos.py:324`). Required fields:
  - **`data`** — the annotation payload, conventionally `{"outputs": {...}}` (the scores /
    notes the agent is recording).
  - **`references.evaluator`** — a `Reference` (a `slug` is enough). The annotation must
    reference an evaluator; the service auto-creates a "simple evaluator" from the data's
    inferred schema if the slug doesn't exist yet
    (`api/oss/src/core/annotations/service.py:83`, `ANNOTATION_URI =
    "agenta:custom:feedback:v0"`). Without an evaluator link, no evaluator is created and
    the annotation is effectively a no-op (acceptance test
    `test_create_trace_without_links_does_not_create_evaluator`).
  - **`links`** — `Union[Dict[str, Link], List[Link]]`. The target trace/span is carried
    here under the conventional key `invocation`:
    `{"invocation": {"trace_id": "...", "span_id": "..."}}` (acceptance test
    `test_annotations_basics.py:20`).

Why it's slightly more than a one-liner op: unlike `commit_revision` (one bound field),
an annotation needs **two** things from the model (an evaluator slug that names the
annotation category + a `data.outputs` object) **and** a nested self-target under
`links.invocation.{trace_id,span_id}`. The link shape is nested and non-obvious, and the
evaluator reference is a required concept the model has to be taught. But the values the
model must *not* control (the trace/span it targets) are exactly the ones the run context
already supplies — so it is a clean fit for the existing `context_bindings` mechanism.

## 4. Recommendation: a minimal `annotate_trace` platform-op

Add one `PlatformOp` to `PLATFORM_OPS` in `op_catalog.py`. Sketch:

```python
PlatformOp(
    op="annotate_trace",
    description=(
        "Record an annotation (evaluation feedback) on your own current run's trace. "
        "Supply a short `evaluator_slug` naming the kind of annotation (e.g. "
        "'self_reflection', 'quality') and the `outputs` you are recording (scores, "
        "labels, notes). The trace and span you annotate are your own current run, filled "
        "automatically — you cannot annotate a different trace."
    ),
    method="POST",
    path="/api/annotations/",
    input_schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "references": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "evaluator": {
                        "type": "object",
                        "properties": {"slug": {"type": "string"}},
                        "required": ["slug"],
                        "description": "Names the annotation category; auto-created if new.",
                    }
                },
                "required": ["evaluator"],
            },
            "data": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "outputs": {
                        "type": "object",
                        "additionalProperties": True,
                        "description": "The annotation content (scores, labels, notes).",
                    }
                },
                "required": ["outputs"],
            },
            # links.invocation.{trace_id,span_id} are context-bound and stripped from the
            # model-visible schema below.
        },
        "required": ["references", "data"],
    },
    args_into="annotation",  # request wrapper is {"annotation": AnnotationCreate}
    context_bindings={
        "annotation.links.invocation.trace_id": "$ctx.trace.trace_id",
        "annotation.links.invocation.span_id": "$ctx.trace.span_id",
    },
    default_permission="allow",     # additive self-metadata; low risk
    default_needs_approval=False,
)
```

**What the agent supplies:** an `evaluator_slug` (the annotation's category name) and a
`data.outputs` object (the feedback content). **What the runner binds from context:**
`links.invocation.trace_id` / `.span_id` from `$ctx.trace.*` — so the agent always
annotates its own current run and can never retarget another trace (same self-targeting
guarantee `commit_revision` uses via `$ctx.workflow.variant.id`).

Open choices to settle when porting:

- **Permission.** Annotating your own trace is additive and low-risk, so `allow` /
  no-approval is defensible (unlike `commit_revision`, which mutates config and defaults
  to `ask`). If any annotation is considered sensitive (it can auto-create an evaluator),
  gate it behind `ask`.
- **Endpoint choice.** `POST /api/annotations/` is the domain-specific route and validates
  the evaluator link; it is the right wrap. (The lower-level `/simple/traces/` route used
  in the acceptance tests is the same machinery but less self-describing.)
- **Evaluator auto-create.** The create path auto-provisions a simple evaluator from the
  data schema when the slug is new. That is convenient for a self-reflecting agent but
  means each new slug seeds an evaluator artifact in the project — worth a one-line note in
  the op description so the model reuses a stable slug rather than inventing one per run.

## Key file:line references

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:470` — `PLATFORM_OPS` (no
  annotation op).
- `api/oss/src/apis/fastapi/annotations/router.py:46` / `:102` — `POST /api/annotations/`
  `create_annotation`.
- `api/oss/src/core/annotations/types.py:48` — `AnnotationCreate` (= `SimpleTraceCreate`,
  with `AnnotationReferences.evaluator` required at `:40`).
- `api/oss/src/core/tracing/dtos.py:324` — `SimpleTraceCreate` (`data` + `references` +
  `links` required); `:307` `SimpleTraceLinks`.
- `api/oss/src/core/annotations/service.py:83` — evaluator resolve/auto-create on create.
- `sdks/python/agenta/sdk/agents/dtos.py:440` — `RunContextTrace` (`trace_id`/`span_id`
  binding source).
- `services/oss/src/agent/tracing.py:161` — `_run_context_trace()` populates it per run.
- `docs/design/agent-workflows/projects/builder-agent-reliability/build-notes.md:35` — the
  documented gap + porting recommendation.
