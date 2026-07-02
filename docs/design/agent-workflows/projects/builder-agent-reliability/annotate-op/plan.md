# Plan

Date: 2026-07-01

The design for the `annotate_trace` platform-op. The findings behind each choice are in
[research.md](research.md).

## The shape of the design

The agent supplies the reflection content and nothing else. The server owns both target
selectors: which trace, and which evaluator. The agent can never retarget either.

Three moving parts:

1. One reserved evaluator with a small structured schema (a `reflection` string, a binary
   `score`, and an open `meta` object), seeded per project and bound server-side. The model
   never names it.
2. Server-owned replacement of the `links` and `references` subtrees (clear the whole subtree,
   then refill from context), so the self-target is airtight even though the runner does not
   validate model args.
3. The op itself in `PLATFORM_OPS`, permission `allow`.

## 1. One reserved self-reflection evaluator

An annotation must reference an evaluator, and the evaluator decides whether the reflection is
even accepted (see research.md). The project default `quality-rating` cannot hold a reflection:
its schema is a rigid `{approved: boolean}` with `additionalProperties: false`. And letting the
model name a fresh slug per call creates evaluator sprawl and a `genson`-locked schema that
rejects the second write once the keys change.

So we reserve **one** well-known evaluator for agent self-reflection, slug
`agent-self-reflection`, and follow the pattern the platform already uses for `quality-rating`:
a fixed slug, a known schema, seeded and resolved the same way for every project.

**The schema is structured, not a free-for-all.** A fully open `{outputs: object}` would accept
anything but read as an opaque blob in the UI and give nothing to filter on. Instead the
reflection has three fields: a `reflection` string, a binary `score` so runs can be filtered by
success, and an open `meta` object for whatever structured extras a run wants to attach. This
is the reflection content, what the model puts under `data.outputs`:

```json
{
  "reflection": "user got the answer in one turn; tone was a little terse",
  "score": "good",
  "meta": { "turns": 1, "tools_used": ["search"] }
}
```

The reserved evaluator's stored `data.schemas.outputs` (the JSON Schema that content is
validated against, `sdks/python/agenta/sdk/models/workflows.py:62-165`, any valid JSON Schema
per `check_schema`):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "reflection": { "type": "string" },
    "score": { "type": "string", "enum": ["good", "bad"] },
    "meta": { "type": "object" }
  },
  "required": ["reflection", "score"],
  "additionalProperties": false
}
```

`meta` is the open extension point, so `additionalProperties: false` at the top level never
rejects a well-formed reflection: fixed content goes in the named fields, everything else goes
in `meta`. The keys are fixed, so there is no `genson`-lock and the second write always
validates.

**Verified against the annotation UI** (`transforms.ts:32-149`, `AnnotationInputs.tsx:341-453`,
render check done for this design):

- `reflection` (string) renders as a text field.
- `score` renders as a control. The two-value `enum` renders as a select; a plain `boolean`
  (`true`/`false`) is the more battle-tested control, since that is exactly how `quality-rating`
  renders today. Either is fine; the enum reads as "good/bad", boolean reads as "True/False".
- `meta` (an **open** object) is stored and enforced server-side but is **not** shown as an
  editable control in the annotation form. The form renderer only draws a fixed set of scalar
  types (`USEABLE_METRIC_TYPES`, `constants.ts:2-10`) and drops open objects. That is acceptable
  here: `meta` is an overflow bucket for machine extras, not a field a human grades. If we ever
  want `meta` visible and editable, give it fixed sub-properties (they flatten to `meta.<field>`
  controls) or store it as a JSON string.

**The agent never chooses or names the evaluator.** The op binds this reserved slug the same
way it binds the trace id: server-side, hidden from the model. No sprawl, no schema drift, and
every reflection lands under one recognizable evaluator in the annotation UI.

### How the reserved evaluator is materialized: seed it, exactly like `quality-rating`

The reserved evaluator is a normal seeded default with a fixed slug. There is no separate
"reserved" evaluator machinery; `quality-rating` already is one, and we mirror it end to end.

1. **Define the preset.** Add an `agent-self-reflection` preset next to the `quality-rating`
   preset on the `agenta:custom:feedback:v0` catalog entry
   (`sdks/python/agenta/sdk/engines/running/utils.py:138-158`), carrying the structured outputs
   schema from §1.
2. **Seed it on project creation.** Add one entry to `_DEFAULT_EVALUATORS`
   (`api/oss/src/core/evaluators/defaults.py:62-81`), the same shape as the `quality-rating`
   entry:

   ```python
   {
       "template_key": "feedback",
       "preset_key": "agent-self-reflection",
       "slug": "agent-self-reflection",
       "name": "Agent Self-Reflection",
   }
   ```

   `create_default_evaluators` runs at project creation
   (`api/oss/src/core/accounts/service.py:749-757`, gated on `seed_defaults`, default `True` at
   `dtos.py:56`) and is idempotent (it swallows `EntityCreationConflict`). New projects get the
   evaluator for free.
3. **Backfill existing projects with a migration.** Seeding only helps *new* projects. Note
   that `quality-rating` itself has **no** backfill migration; it was only ever seeded at
   creation, so projects that predate it never got it. We do better here and ship a one-time
   backfill that seeds `agent-self-reflection` into every existing project. There is no
   evaluator backfill to copy, so mirror the closest existing pattern: the default-environments
   backfill, which seeds a per-project entity idempotently
   (`api/oss/databases/postgres/migrations/core/versions/c2d3e4f5a6b7_create_default_environments_for_projects_without_environments.py`
   and its data migration
   `api/oss/databases/postgres/migrations/core/data_migrations/default_environments.py`). That
   migration paginates over projects *missing* the entity, resolves each project's owner from
   `OrganizationDB.owner_id`, and does an idempotent get-or-create. Our backfill does the same:
   find projects with no `agent-self-reflection` evaluator, resolve the owner, and call the same
   seeding path (guarded by `EntityCreationConflict`), so it is safe to re-run.

We do **not** auto-create the evaluator at annotation time. An annotation that targets a
missing evaluator will fail, which is the correct signal: the project is missing its seed, and
the fix is to run the backfill, not to silently mint a per-call evaluator (which is how the
current draft locks a `genson`-inferred schema on the first write; see research.md).

### Fallback for the agent when the evaluator is missing

Belt-and-suspenders, on the agent side rather than the server side: the build-agent skill
should carry a short troubleshooting resource. If an `annotate_trace` call errors because the
`agent-self-reflection` evaluator does not exist (an un-backfilled or `seed_defaults=False`
project), the skill tells the agent how to create it: `POST` the evaluator with slug
`agent-self-reflection` and the exact outputs schema from §1, then retry the annotation. This
keeps the server path simple (seed + migration only) while giving a self-hosting agent a
documented recovery step. The skill edit is separate work, tracked as a note here, not part of
this op's contract.

## 2. Why the agent can only ever annotate its own trace

The whole point of this op is self-reflection, so it must be impossible for an agent to
annotate anything but the run it is in. An annotation carries a `links` field that says which
trace and span it is attached to. If the model could set that field, it could attach its
"reflection" to some other run in the same project. That is the hole to close.

**How the target is supposed to be set.** The model never types a trace id. When the op runs,
the runner already knows the run's own trace and span from its context, and it fills them into
the request for the model. The request that reaches the annotations API looks like this:

```json
{
  "annotation": {
    "data": { "outputs": { "reflection": "...", "score": "good", "meta": {} } },
    "links": { "invocation": { "trace_id": "<this run's own>", "span_id": "<this run's own>" } },
    "references": { "evaluator": { "slug": "agent-self-reflection" } }
  }
}
```

Only `data.outputs` comes from the model. The runner fills `links` (which trace) and
`references` (which evaluator) from context. The model does not see either field.

**Why it is not airtight today.** The way the runner fills those fields is by writing two exact
paths, `links.invocation.trace_id` and `links.invocation.span_id`. It writes over just those
two leaves. Anything else the model put under `links` is left alone. So a model can smuggle a
second entry next to `invocation`:

```json
"links": { "invocation": {}, "evil": { "trace_id": "<another run's id>" } }
```

The runner overwrites `invocation`, but `evil` rides along untouched, and the annotation ends
up attached to that other run too. We proved this live: a crafted `links` sibling key lands the
reflection on a different trace in the same project. The runner does not check the model's
arguments against the op's schema before it builds the request (`relay.ts:211`), so the "no
extra fields" rule on the schema is only a suggestion, not a guard. The self-target is not
enforced.

**The fix: clear the whole subtree, then refill.** Give the runner one small primitive: before
it writes the trusted values, it deletes the entire `links` object the model sent, then writes
back only the two bound leaves from context. Nothing the model put under `links` survives,
because the whole subtree is wiped first. The result is always exactly:

```json
"links": { "invocation": { "trace_id": "<this run's own>", "span_id": "<this run's own>" } }
```

No sibling key, no list form, no extra fields can get through, because the refill starts from
an empty subtree every time.

The evaluator reference gets the same treatment. `references` is cleared and then set to the
one reserved evaluator slug (a constant), so a model cannot slip in a `references.evaluator.id`
that points at a different evaluator. See §1 for why the evaluator is a fixed, server-owned
choice.

With both subtrees cleared-then-refilled, the guarantee holds without trusting the model to
behave: the agent supplies only the reflection content, and the reflection always lands on its
own trace, under the one reserved evaluator.

## 3. The op shape

The op wraps `POST /api/annotations/` with `args_into="annotation"`. The model supplies only
the reflection content. Both target selectors are server-owned.

What the agent supplies (the entire model-visible schema):

- `data.outputs`, the reflection content, shaped by the reserved evaluator schema from §1: a
  `reflection` string, a binary `score`, and an open `meta` object for extras.

What the server binds, hidden from the model:

- `annotation.links`, the whole subtree, resolved from `$ctx.trace.*` to the run's own
  trace/span.
- `annotation.references`, the whole subtree, set to the reserved evaluator slug (a constant).

Resulting request body:

```json
{
  "annotation": {
    "data": { "outputs": { "reflection": "handled it in one turn", "score": "good", "meta": { "turns": 1 } } },
    "references": { "evaluator": { "slug": "agent-self-reflection" } },
    "links": { "invocation": { "trace_id": "<run's own>", "span_id": "<run's own>" } }
  }
}
```

The model never sees `references` or `links`.

## Permission

Default `allow` / no approval (`default_permission="allow"`,
`default_needs_approval=False`).

With a reserved, pre-existing evaluator there is no evaluator-creation side effect per call.
The op writes additive self-metadata onto the agent's own trace and nothing else. Requiring
approval on every self-reflection would defeat the autonomous use case. Authors can still
override per config (`permission` / `needs_approval` on `PlatformToolConfig`).

One residual risk: each call still writes an annotation trace, so a runaway loop could spam
annotations on its own trace. That is a rate/idempotency concern, not a permission one (see the
upsert-vs-append question in status.md).

## Phases

1. **Runner (TS).** Support subtree-level context bindings and constant-object bound values in
   `direct.ts`/`relay.ts` (the clear-the-whole-subtree-then-refill primitive from §2). Add arg
   stripping to the cataloged fields before assembly. Extend runner unit tests.
2. **Reserved evaluator (API).** Add the `agent-self-reflection` preset and `_DEFAULT_EVALUATORS`
   entry with the structured schema. Add the backfill migration for existing projects. No
   auto-create at annotation time.
3. **The op (SDK).** Add the `annotate_trace` `PlatformOp` to `PLATFORM_OPS` with the closed
   `data.outputs`-only schema, `args_into="annotation"`, the two subtree bindings, and the
   `allow` default. Overlay it in the build kit (no build-kit change needed beyond the catalog
   entry).
4. **Tests.** Unit for the op shape and the runner bindings; an acceptance test that two
   reflections with different `meta` contents both validate against the fixed schema; a
   self-target test that a smuggled sibling `links` key and a smuggled `references.evaluator.id`
   are both dropped.

## What PR #4999 must change

The current draft (see research.md) diverges on the three points above, in order of
importance:

1. **Evaluator handling.** Stop letting the model invent evaluators; bind the one reserved
   evaluator.
2. **Self-target.** Replace the two leaf bindings with whole-subtree, server-owned replacement
   of `links` and `references`.
3. **Arg enforcement.** Pair the closed schema with runner-side arg stripping, since
   `additionalProperties: false` is advisory.

What the draft got right and this design keeps: wrapping `POST /api/annotations/` with
`args_into="annotation"`, binding the run's own trace from `$ctx.trace.*`, the closed
model-visible schema as the contract, the build-kit overlay, and the `allow` default.
