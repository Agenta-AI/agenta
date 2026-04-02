# Migration Issues: `d3e4f5a6b7c8` (Backfill URIs & Normalize Flags)

> Date: 2026-04-02
> Source: diff between `*_pre.csv` and `*_post.csv` in `docs/designs/runnables/`
> Migration file: `api/oss/databases/postgres/migrations/core/data_migrations/workflow_revisions.py`

---

## Scope note: artifact/variant flags vs revision flags

A codebase audit confirms that artifact and variant flags are **not used for
any business logic**. All flag-driven decisions (evaluator mode, chat mode,
schema inference) read from revision flags only.

Artifact/variant flags are used exclusively for:

1. **JSONB containment filtering** in DAO queries (`flags @> {…}`)
2. **Copy-on-fork** — propagated from source revision/variant during forks

This changes the severity of I1/I2 (see below). They are not "wrong data"
issues — they are a **live query breakage** for the `is_application` filter.

---

## I1 — Artifact flag migration missing → `query_applications()` broken

**Severity:** Critical (functional breakage)

`ApplicationQueryFlags` always injects `is_application: true`
(`api/oss/src/core/applications/dtos.py:96-99`).
`query_applications()` converts this to `ArtifactQuery(flags={is_application: true})`
(`api/oss/src/core/applications/service.py:230-250`), which becomes a JSONB
containment filter on `workflow_artifacts.flags`.

Legacy artifact flags `{"is_chat": …, "is_evaluator": …}` have no `is_application`
key. The JSONB `@>` check returns false → **`query_applications()` returns zero
results for all pre-migration artifacts.**

The evaluator query path is unaffected: `is_evaluator` exists in both legacy
and new flag shapes, so the containment check still matches.

**Evidence:** `workflow_artifacts_pre.csv` == `workflow_artifacts_post.csv` (identical).

**Fix:** Add flag migration for `workflow_artifacts` — same derivation logic as
revisions (`is_evaluator` preserved, `is_application` added as `NOT is_evaluator`
for non-evaluators).

---

## I2 — Variant flag migration missing → variant queries potentially broken

**Severity:** Medium

Same gap as I1 on `workflow_variants`. Variant-level flag filtering
(`ApplicationVariantQuery`, `EvaluatorVariantQuery`) uses JSONB containment
on `workflow_variants.flags`. A filter for `is_application: true` returns no
results for pre-migration variant rows.

In practice variant-level flag queries are less common than artifact-level,
but the same breakage applies wherever `query_application_variants()` or
`query_evaluator_variants()` are called.

**Evidence:** `workflow_variants_pre.csv` == `workflow_variants_post.csv` (identical).

---

## I3 — Missing flag migration on version 0 revisions (`data IS NULL`)

**Severity:** Medium

Every migration UPDATE has `WHERE data IS NOT NULL`. Version 0 revisions
(initial commits) that have `data = NULL` are skipped entirely. Their flags
keep the legacy shape:

```
revision v0 (data=NULL): {"is_chat": false, "is_feedback": true, "is_custom": false, "is_evaluator": true}
revision v1 (data!=NULL): {"is_snippet": false, "is_evaluator": true, "is_application": false}
```

This means the same variant has two different flag schemas across its revision
history.

**Evidence:** Pre/post CSV rows 2, 4, 6, 10, 12 — all v0 revisions unchanged.

---

## I4 — `service.format` output schemas lost for human/trace evaluators

**Severity:** High (data loss)

For evaluators that stored output schemas **only** inside `service.format`
(and NOT duplicated in `schemas.outputs`), stripping `service` permanently
deletes the output schema.

Affected rows from the local CSV:

| Evaluator | Pre `service.format.properties.outputs` | Post `schemas` | Lost? |
|---|---|---|---|
| Quality Rating v1 | `{approved: boolean}` | (absent) | **YES** |
| srgsdrg v1 | `{faewfawef: boolean}` | (absent) | **YES** |

Evaluators that duplicated the schema in both `schemas.outputs` AND
`service.format` are not affected (e.g., Exact Match, Contains JSON, critique).

**Root cause:** The migration strips `service` without first extracting
`service.format.properties.outputs` into `schemas.outputs`.

**Fix:** Before stripping `service`, check whether `schemas.outputs` is
already present. If not, extract it from `service.format.properties.outputs`
(if that path exists) and merge it into the `data` JSONB as `schemas.outputs`.

---

## I5 — `configuration` key stripped without merge into `parameters`

**Severity:** Low–Medium

The migration strips the `configuration` key from `data`. In most observed
rows, `configuration` is a duplicate of `parameters` (e.g., Exact Match has
`parameters.correct_answer_key` and `configuration.correct_answer_key` with the
same value). But the migration does NOT verify equivalence before dropping.

If any row has `configuration` content that differs from `parameters`,
that data is silently lost.

**Evidence:** Exact Match v1 pre had both `parameters` and `configuration`
with matching `correct_answer_key`. Critique v1 pre had both with matching
content. These are lossless. But the migration has no guard for divergence.

---

## I6 — `url` stripped on managed builtin URIs

**Severity:** Low (intentional, but worth documenting)

For managed builtin URIs (chat:v0, completion:v0, code:v0), the migration
strips the `url` key. The assumption is `infer_url_from_uri()` can reconstruct
it at read time.

**Evidence:** App "p" v0 pre: `"url": "http://localhost/services/completion"` →
post: `"uri": "agenta:builtin:completion:v0"` (no url).

This is intentionally lossy for builtins where the URL is deterministic from
the URI + environment config. However, if any managed builtin revision stored
a non-standard URL (e.g., a different host or path), that URL is lost.

Hook:v0 (row 4) correctly preserves `url` since hooks have user-specific URLs.

---

## Summary Table

| Issue | Table | Severity | Type | Status |
|-------|-------|----------|------|--------|
| I1 | `workflow_artifacts` | High | Missing flag migration | Open |
| I2 | `workflow_variants` | High | Missing flag migration | Open |
| I3 | `workflow_revisions` (v0) | Medium | Missing flag migration | Open |
| I4 | `workflow_revisions` | High | Data loss (output schemas) | Open |
| I5 | `workflow_revisions` | Low–Medium | Data loss (configuration) | Open |
| I6 | `workflow_revisions` | Low | Intentional url drop | Documented |

---

## Action Items

1. **Add flag migration for artifacts and variants** (I1, I2):
   Same canonical flag replacement as revisions. Migrate from
   `{is_chat, is_feedback, is_custom, is_evaluator}` to
   `{is_evaluator, is_application, is_snippet}` using the same role derivation
   logic used for revisions.

2. **Add flag migration for v0 revisions with `data IS NULL`** (I3):
   These rows have no `data` to derive URI from, but the flags column still
   needs normalization. Use the parent artifact/variant flags or the sibling
   v1+ revision's flags as the source of truth for the role flags.

3. **Extract output schemas from `service.format` before stripping** (I4):
   Before `- 'service'`, check whether `schemas.outputs` is already populated.
   If not, extract from `service -> 'format' -> 'properties' -> 'outputs'` and
   write to `schemas.outputs`.

4. **Add guard for `configuration` ≠ `parameters` divergence** (I5):
   Either merge `configuration` into `parameters` (with `parameters` winning on
   conflict), or log/skip rows where the two differ.
