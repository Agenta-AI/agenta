# Research

Date: 2026-07-01
Source: [`../../../scratch/console/builder-kit/findings/annotation.md`](../../../scratch/console/builder-kit/findings/annotation.md)

Read-only trace of the annotations path and the runner assembly path. This is where the hard
part lives. The plumbing is easy. The evaluator is not.

## What an annotation is

An annotation is a special trace (a `SimpleTrace`) that links to the trace it annotates. Its
create contract is `AnnotationCreate` (`api/oss/src/core/annotations/types.py:48`, a
`SimpleTraceCreate`). It needs three things:

- `data`, the annotation payload, by convention `{"outputs": {...}}` (the scores, labels,
  notes being recorded).
- `references.evaluator`, a required `Reference` to an evaluator
  (`AnnotationReferences.evaluator` at `types.py:41`).
- `links`, where the annotated trace/span is named, under the conventional key `invocation`:
  `{"invocation": {"trace_id": "...", "span_id": "..."}}`.

The API is `POST /api/annotations/`, handler `create_annotation`
(`api/oss/src/apis/fastapi/annotations/router.py:102`), request wrapper
`{"annotation": AnnotationCreate}`.

The self-target plumbing is ready. `RunContextTrace`
(`sdks/python/agenta/sdk/agents/dtos.py:440`) models `trace_id` + `span_id`. The service
populates it per run from the active OTel span
(`services/oss/src/agent/tracing.py:161`, `_run_context_trace()`). So `$ctx.trace.*` already
resolves to the run's own trace/span end to end. Only the catalog entry was missing.

## The load-bearing finding: the evaluator decides the schema

The evaluator reference is not decoration. On create, the annotations service uses it to pick
the **schema the annotation payload is validated against**
(`api/oss/src/core/annotations/service.py:83-160`):

1. It resolves the evaluator from `references.evaluator` (`retrieve_evaluator_revision`). A
   slug that does not resolve returns `None` cleanly.
2. If no evaluator exists for that reference, it **infers an outputs schema from the
   annotation's own `data` with `genson`** and creates a "simple evaluator" for that slug
   (`service.py:105-143`, URI `agenta:custom:feedback:v0`). This is the auto-create path.
3. It then **validates** the annotation `data` against the evaluator's stored
   `schemas.outputs` (`service.py:155`, `validate_data_against_schema`, a strict jsonschema
   check that raises 422 on mismatch).

So an evaluator is a **named, versioned schema** for the annotation payload, stored as a
workflow artifact (`is_evaluator=True`). Two consequences follow, and both bite a naive op:

- **The schema is inferred once and then locks the shape.** `genson` builds the schema from
  the *first* write and marks every key it sees as `required`. A second write to the same slug
  that omits a previously-seen key fails with a 422. Freeform reflection that varies its keys
  breaks on the second call.
- **A new slug per call creates a new evaluator per call.** The catalog fills with throwaway
  evaluator artifacts, none sharing a schema, so nothing aggregates.

## Is there a project default evaluator? Yes.

Every project seeds three default evaluators at creation time
(`api/oss/src/core/accounts/service.py:749-757` calls `create_default_evaluators` when
`seed_defaults` is true; `seed_defaults` defaults to `True` at
`api/oss/src/core/accounts/dtos.py:56`). The three are defined in
`api/oss/src/core/evaluators/defaults.py:62-81`:

- `exact-match` (auto)
- `contains-json` (auto)
- **`quality-rating`**, a human/feedback evaluator, built from the `quality-rating` preset on
  the `agenta:custom:feedback:v0` catalog entry.

So a default *feedback* evaluator does exist, per project, with a fixed, predictable slug. It
is seeded, not auto-created, and the seed is idempotent (`create_default_evaluators` swallows
`EntityCreationConflict`). Defaults are seeded at the **project** level only.

One gap worth naming: seeding runs **only at project creation**, and there is **no backfill
migration** that ever added `quality-rating` to projects that predate it. A grep of the
migrations (`api/oss/databases/postgres/migrations/`) for `quality-rating` /
`create_default_evaluators` / `agenta:custom:feedback` finds nothing; the evaluator migrations
that exist only convert legacy evaluator rows to the new form. So mirroring `quality-rating`
gets a new reserved evaluator into new projects but **not** existing ones. A reserved evaluator
that must also reach old projects needs its own backfill, and there is a clean template to copy:
the default-environments backfill
(`.../migrations/core/versions/c2d3e4f5a6b7_create_default_environments_for_projects_without_environments.py`
and `.../data_migrations/default_environments.py`) paginates over projects *missing* the
entity, resolves each owner from `OrganizationDB.owner_id`, and does an idempotent
get-or-create.

## Can the default hold a reflection payload? No.

The `quality-rating` preset carries this exact outputs schema
(`sdks/python/agenta/sdk/engines/running/utils.py:147-155`, preset block `:138-158`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "approved": { "type": "boolean" } },
  "required": ["approved"],
  "additionalProperties": false
}
```

That is a thumbs up / thumbs down. It requires exactly one boolean `approved` and, because
`additionalProperties` is false, **rejects everything else**. A reflection payload of
`{"reflection": "...", "score": "good"}` fails validation against it. The default evaluator is
real but the wrong shape for a self-reflection with more than one boolean.

There is also a data-shape wrinkle: this preset schema describes `data` as `{approved}`
directly, while the annotation convention wraps content in `data.outputs`. That mismatch is
orthogonal to the op but is flagged in `status.md`.

## What the annotation UI can render (constrains the schema)

The annotation form draws a control per field in the evaluator's outputs schema, but only for a
fixed set of scalar types. `transformMetadata` keeps only `USEABLE_METRIC_TYPES`
(`web/oss/src/components/SharedDrawers/AnnotateDrawer/assets/constants.ts:2-10` =
`number`/`integer`/`float`/`boolean`/`string`/`array`/`class`), and the field renderer
(`.../AnnotateDrawer/assets/transforms.ts:32-149`,
`.../EvalRunDetails/.../ScenarioAnnotationPanel/AnnotationInputs.tsx:341-453`) maps: `string` to
a text field, `boolean` to a True/False radio (what `quality-rating` uses), `number` to a
numeric input, and an `enum` to a select. An **open** `object` (no fixed `properties`) is
**dropped** before rendering; a *closed* object with fixed properties flattens to `field.sub`
leaf controls. So a structured schema of `string` + binary + open `object` renders the first two
as controls and stores the `object` without drawing it. This is why the reserved evaluator uses
`reflection` (string) and `score` (binary) as rendered fields and `meta` (open object) as a
stored-only overflow bucket.

## The runner does not validate model args (the gotcha)

The runner assembles the request body in
`services/agent/src/tools/direct.ts::assembleBody`: it deep-sets the model's args at the
`args_into` path, deep-merges any static `call.body`, then for each context binding it deletes
that exact path and deep-sets the resolved value.

Crucially, **the runner does not validate the model's args against the op's `input_schema`
before assembly.** Confirmed: `relay.ts:211` calls `assembleBody(spec.call, req.args,
runContext)` with the raw args. So `additionalProperties: false` on the advertised schema is
**advisory**. A model that returns extra keys keeps them in the body unless a binding
overwrites that exact path.

## The self-target smuggle routes

A leaf-only self-target (binding just `links.invocation.trace_id` and `.span_id`) leaves two
holes, because the runner overwrites only those two exact paths:

- **Sibling link keys.** `links` is `Union[Dict[str, Link], List[Link]]`
  (`api/oss/src/core/tracing/dtos.py:307`). A model that returns
  `links: {"invocation": {...}, "evil": {"trace_id": "<someone else's>"}}` keeps the `evil`
  sibling. The leaf bindings only overwrite `invocation.trace_id`/`.span_id`. The annotation
  then links to a second, attacker-chosen trace and surfaces on **another** trace.
- **Model-controlled references.** If the op lets the model touch `references`, a model can add
  `references.evaluator.id` pointing at any evaluator in the project. Even a static `call.body`
  that pins the slug deep-merges, so a sibling `id` survives and retargets the evaluator (and
  its schema).

Both routes route the annotation somewhere the agent should not reach. The fix (in
[plan.md](plan.md)) is to server-own and *replace* the whole `links` and `references`
subtrees, not merge them.

## What PR #4999 ships today (the implementation-first cut)

The draft on `feat/annotate-trace-op` took the naive path. It lets the model name a fresh
`references.evaluator.slug` on every call (so a new slug auto-creates an evaluator, and its
schema is genson-locked on the first write), binds only the two invocation leaf paths (so the
sibling-`links` smuggle is open), and leaves `references` model-controlled. It relies on the
advisory `additionalProperties: false` that the runner never enforces. Those are the three
misses this design corrects.

## Key references

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py:470`, `PLATFORM_OPS`; the op lives here.
- `api/oss/src/core/annotations/service.py:83-160`, evaluator resolve, auto-create,
  payload validation.
- `api/oss/src/core/annotations/types.py:40-49`, `AnnotationReferences.evaluator` required;
  `AnnotationCreate`.
- `api/oss/src/apis/fastapi/annotations/router.py:102`, `POST /api/annotations/`.
- `api/oss/src/core/evaluators/defaults.py:62-81`, the three seeded default evaluators.
- `api/oss/src/core/accounts/service.py:749-757` and `dtos.py:56`, `create_default_evaluators`,
  `seed_defaults=True`.
- `sdks/python/agenta/sdk/engines/running/utils.py:147-155` (preset block `:138-158`), the
  `quality-rating` outputs schema (`{approved: boolean}`); a new preset goes next to it.
- `api/oss/src/core/evaluators/defaults.py:182-235`, `create_default_evaluators` (idempotent,
  swallows `EntityCreationConflict` at `:222-227`); called at project creation from
  `accounts/service.py:754`, `services/commoners.py:214`, `routers/projects_router.py:234`,
  `services/admin_manager.py:204`, `services/db_manager.py:2778`.
- `api/oss/databases/postgres/migrations/core/data_migrations/default_environments.py` (version
  `.../versions/c2d3e4f5a6b7_create_default_environments_for_projects_without_environments.py`),
  the backfill template: paginate projects missing the entity, resolve `OrganizationDB.owner_id`,
  idempotent get-or-create. No `quality-rating` backfill exists to copy.
- `web/oss/src/components/SharedDrawers/AnnotateDrawer/assets/constants.ts:2-10`
  (`USEABLE_METRIC_TYPES`) and `.../assets/transforms.ts:32-149` /
  `.../ScenarioAnnotationPanel/AnnotationInputs.tsx:341-453`, the annotation-form renderer:
  string/boolean/number/enum render, open objects are filtered out.
- `services/agent/src/tools/direct.ts::assembleBody` and `relay.ts:211`, body assembly; model
  args not schema-validated pre-assembly.
- `api/oss/src/core/tracing/dtos.py:307`, `SimpleTraceLinks = Union[Dict[str, Link], List[Link]]`.
- `sdks/python/agenta/sdk/agents/dtos.py:440` (`RunContextTrace`) and
  `services/oss/src/agent/tracing.py:161` (`_run_context_trace`), the `$ctx.trace.*` source.
