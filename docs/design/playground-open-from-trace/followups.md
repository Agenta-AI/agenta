# Follow-ups: revision-retrieve reference resolution

Companion to [`retrieve-endpoint-audit.md`](./retrieve-endpoint-audit.md). The audit doc describes the
original bug, the data model, and PR #4418's guardrails. PR #4422 extended those
guardrails to every git-backed entity by factoring the version-only check into
`core/git/types.py::validate_revision_refs_sufficient`.

This document captures what is **still wrong or incomplete** about reference
resolution at the retrieve surface, evaluated against the five rules below. The
breadth concern (do the changes apply uniformly across all git-backed entities)
is fully resolved by PR #4422 and is intentionally not discussed here.

The retrieve endpoints accept **two parallel resolution paths** that the rules
must cover together:

- **Entity-ref path:** `{artifact_ref, variant_ref, revision_ref}` triple
  identifying a revision directly.
- **Environment-ref path:** `{environment_ref, environment_variant_ref,
  environment_revision_ref, key}` resolving to an environment revision, which
  in turn contains a deployment map keyed by `key` whose value is an entity-ref
  triple.

Both paths feed into the same downstream lookup. Their interaction (when both
are sent, when neither is sent, when `key` is missing or implicit) is part of
the rule surface.

**Testing baseline (applies to every C item below):** every rule, every
fallback, and every discrepancy needs **both positive and negative tests**.
A change that adds a 400 case must also pin the corresponding 200 case
(and vice versa). PR #4422 set this precedent with
`test_revision_retrieve_ambiguous_400.py` covering 400s alongside positive
controls; the same discipline applies to every follow-on. C8 is the central
place this is tracked, but it is a baseline expectation across the whole
plan, not a C8-specific concern.

---

## Section 1 — The five rules

Every request to a `/{entity}/revisions/retrieve` endpoint falls into exactly
one of five cases. The cases apply to **both** the entity-ref path and the
environment-ref path, and to combinations of the two.

Notation: a `Reference` carries optional `id`, `slug`, and `version`. We say a
reference is **identifying** if it has an `id` or `slug` (both project-unique)
and **non-identifying** otherwise (empty, or `version`-only).

A request is **path-mixed** if it carries identifying refs from both the
entity-ref path and the environment-ref path. Today, applications and workflows
silently let the environment-ref path win and overwrite entity refs from the
environment's deployment map. Evaluators reject path-mixed requests with 400.
Neither is documented as the rule; both are observable behavior.

### 2.a — Unique, minimal, sufficient, consistent

Exactly one identifying piece per level, nothing extra. The resolver picks one
revision deterministically.

**Entity-ref examples:**

- `{revision_ref: {id: <uuid>}}`
- `{revision_ref: {slug: "my-revision"}}`
- `{variant_ref: {slug: "my-variant"}, revision_ref: {version: "1"}}`
- `{artifact_ref: {slug: "my-workflow"}}` *(implies default variant + latest)*

**Environment-ref examples:**

- `{environment_ref: {slug: "production"}, key: "my-app.revision"}`
  *(latest env revision, lookup the `my-app.revision` slot)*
- `{environment_revision_ref: {id: <env-rev-uuid>}, key: "my-app.revision"}`
  *(pinned env revision, same slot lookup)*

**Path-mixed (today applications/workflows only):** none qualify as 2.a; any
mix means at least one path is redundant — see 2.b/2.c.

**Expected behavior:** 200, returned revision matches the references.

### 2.b — Unique, redundant, sufficient, consistent

More identifying information than needed, but every piece is consistent with
what precedence picks.

**Entity-ref examples:**

- `{artifact_ref: {slug: "my-app"}, variant_ref: {slug: "v1"}, revision_ref: {id: <uuid>}}`
  where the resolved revision's variant slug is `"v1"` and its artifact slug is
  `"my-app"`.

**Environment-ref examples:**

- `{environment_ref: {slug: "production"}, environment_variant_ref: {slug: "v1"}, environment_revision_ref: {version: "3"}, key: "my-app.revision"}`
  where all three refs and the version consistently identify the same env
  revision.

**Path-mixed examples:** path-mixing is only redundant when each path
*independently* identifies a target. Cases:

- `{application_revision_ref: {id: <uuid>}, environment_ref: {slug: "production"}, key: "my-app.revision"}`
  — entity-path resolves a revision via `application_revision_ref.id`; env-path
  independently resolves the same revision via the env deployment map. Both
  paths fully determine the answer; they agree.
- `{application_ref: {slug: "my-app"}, environment_ref: {slug: "production"}, key: "my-app.revision"}`
  — env deployment map under the explicit `"my-app.revision"` slot returns
  refs whose application slug is `"my-app"`. The caller's `application_ref` is
  redundant because the explicit `key` makes the entity ref non-load-bearing.
  Consistent.

Counter-example, NOT path-mixed redundant: `{application_ref: {slug: "my-app"},
environment_ref: {slug: "production"}}` without `key`. The `application_ref` is
load-bearing here — it's what the default-key rule uses to derive the key. See
2.d.

**Expected behavior:** 200. Redundancy is silently fine when it's consistent.

### 2.c — Unique, redundant, sufficient, inconsistent

Precedence still picks a single target, but a lower-precedence ref contradicts
the chosen one.

**Entity-ref examples:**

- `{artifact_ref: {slug: "my-app"}, revision_ref: {id: <uuid>}}` where the
  revision identified by `id` does NOT belong to `"my-app"`.
- `{variant_ref: {slug: "v1"}, revision_ref: {id: <uuid>}}` where the
  revision's variant is not `"v1"`.

**Environment-ref examples:**

- `{environment_ref: {slug: "production"}, environment_revision_ref: {id: <uuid>}}`
  where the env revision identified by `id` does NOT belong to the
  `"production"` env.

**Path-mixed examples:** as with 2.b, only genuinely redundant inputs qualify.

- `{application_revision_ref: {id: <uuid>}, environment_ref: {slug: "production"}, key: "my-app.revision"}`
  where the env deployment map under that key resolves to a different revision
  than the one `application_revision_ref.id` points at. Both paths fully
  determine an answer; the answers disagree.
- `{application_ref: {slug: "different-app"}, environment_ref: {slug: "production"}, key: "my-app.revision"}`
  — the explicit `key` makes the env path self-sufficient. The env deployment
  under `"my-app.revision"` returns refs whose application slug is `"my-app"`,
  not `"different-app"`. The redundant `application_ref` contradicts.

**Expected behavior:** 400 (or 422) naming the conflicting field. Today, all
inconsistencies in this case are silently absorbed — see D1 and D10.

### 2.d — Unique, minimal, insufficient, consistent

Information given does not by itself identify a single revision, but
deterministic fallback rules close the gap.

The three fallback rules (see also the precedence-and-defaults reference
section below):

- **Latest revision:** when a variant is identified but no revision is.
- **Default variant:** when only the artifact is identified.
- **Default key (`<artifact.slug>.revision`):** when the env-backed path is
  used and `key` is missing but the entity's `artifact_ref` is identified.
  Applications already does this; workflows and evaluators do not.

**Entity-ref examples:**

- `{variant_ref: {slug: "v1"}}` → latest revision of `v1`.
- `{artifact_ref: {slug: "my-app"}}` → latest revision of `my-app`'s default
  variant.
- `{artifact_ref: {slug: "my-app"}, revision_ref: {version: "1"}}` → version 1
  of `my-app`'s default variant. **This is a 2.d case under the rule.** Today
  the helper rejects it with 400 because the default-variant fallback isn't
  deterministic (D2). The 400 is the current bug, not the rule — see D3.

**Environment-ref examples:**

- `{environment_ref: {slug: "production"}, key: "my-app.revision"}` → latest
  revision of `production` env, then look up `"my-app.revision"` slot.
- `{environment_ref: {slug: "production"}, application_ref: {slug: "my-app"}}`
  → applications-only today: derives `key = "my-app.revision"` and resolves
  via the env's latest revision.

**Path-mixed examples:**

- `{environment_ref: {slug: "production"}, application_ref: {slug: "my-app"}}`
  with no explicit `key` — applications derives the key from the application
  slug (default-key rule); workflows and evaluators reject the same request
  with 400 "requires key".

**Expected behavior:** 200 when the fallback chain resolves a single revision;
404 only if no fallback target exists (artifact has no variants, env has no
deployment under that key, etc.). All fallback rules must be deterministic
and consistent across entities.

### 2.e — Non-unique or insufficient

Precedence and fallback together still cannot identify a single revision.

**Entity-ref examples:**

- `{}` — nothing to look up.
- `{revision_ref: {version: "1"}}` — version is per-variant; no variant
  context.

**Environment-ref examples:**

- `{environment_ref: {slug: "production"}}` with no `key` and no derivable
  artifact ref. The env revision is identified, but which deployment slot
  inside it the caller wants is unspecified.
- `{environment_revision_ref: {version: "3"}}` alone — env revision `version`
  is per-env-variant; same trap as the entity-side version-only case.
- `{key: "my-app.revision"}` with no environment_ref — there's no environment
  to look up the key in.

**Path-mixed examples:** none specifically — path-mixed requests fall into
2.b, 2.c, or 2.d depending on consistency.

**Expected behavior:** 400 with a clear message naming what is missing or
ambiguous. The error must distinguish "you gave me nothing" from "you gave me
something that cannot be resolved."

---

## Section 1.5 — Precedence and defaults reference

The single source of truth for how the resolver picks a revision. Every rule
in Section 1 is an application of these.

### Precedence within a single `Reference`

Within `Reference(id, slug, version)`:

1. `id` — used if set. Globally unique. Ends the lookup.
2. `slug` — used only if `id` is unset. Project-unique. Ends the lookup.
3. `version` — used only if both `id` and `slug` are unset. **Per-variant for
   revisions, per-artifact for variants.** Only valid when scoped by an
   identifying parent ref.

A `Reference` with only `version` populated is "non-identifying" because it
carries no project-scoped identifier.

### Precedence across entity refs

Given `(artifact_ref, variant_ref, revision_ref)`:

1. **`revision_ref`** with `id` or `slug` ends the lookup. Other refs are
   either consistent (2.b, return 200) or inconsistent (2.c, return 400 —
   future behavior; today: 2.b absorbs 2.c silently).
2. **`variant_ref`** with `id` or `slug` scopes the lookup. Combined with
   `revision_ref.version` if set, otherwise falls back to latest revision.
3. **`artifact_ref`** with `id` or `slug` scopes the lookup. Falls back to
   default variant, then to latest revision (or `revision_ref.version` if
   supplied).

### Precedence across environment refs

Given `(environment_ref, environment_variant_ref, environment_revision_ref,
key)`:

1. **`environment_revision_ref`** with `id` or `slug` picks the env revision
   directly. Other env refs are consistent (2.b) or inconsistent (2.c).
2. **`environment_variant_ref`** with `id` or `slug` scopes the env lookup.
   Combined with `environment_revision_ref.version` if set, otherwise falls
   back to latest env revision.
3. **`environment_ref`** with `id` or `slug` scopes the env lookup. Falls
   back to default env variant, then to latest env revision.

After resolving an env revision, the `key` selects a slot in its deployment
map; the slot value is an entity-ref triple processed by the entity-ref
precedence rules above.

### Precedence between paths (entity-ref vs environment-ref)

**The rule:** environment-ref handling is uniform across all git-backed
entities. When both paths carry identifying information:

1. The env path resolves an env revision and selects a deployment slot via
   `key` (explicit or derived — see default-key rule).
2. The slot contains an entity-ref triple. That triple is the env path's
   answer.
3. Any entity refs the caller also supplied are *redundant* with the env
   path's answer (only when path-mixing is genuinely redundant — see 2.b
   discussion). They must be consistent; otherwise 400 (2.c).
4. The default-key rule (`key = "<artifact.slug>.revision"` when `key` is
   missing and `artifact_ref` is identified) applies uniformly. It is the
   only mechanism by which an entity ref participates in env-path resolution
   without being redundant.

**Current state — non-compliance is the open bug:**

- **Applications (today):** environment-ref path wins. Entity refs are
  silently overwritten by the env deployment map. Default-key rule is
  implemented. Path-mixed inconsistencies are silently absorbed (D10).
- **Workflows (today):** environment-ref path wins, same silent overwrite.
  Default-key rule NOT implemented; missing `key` returns 400 (D11).
- **Evaluators (today):** path-mixed requests return 400 unconditionally
  (D12). Default-key rule NOT implemented; missing `key` returns 400 (D11).

Each entity diverges from the rule in a different way. D10, D11, D12 track
the three divergences. The fix is C5 (centralized env-resolution helper)
applied to all three routers — see Section 3.

### Defaults

Three default rules close 2.d's insufficiency gaps. Each has a target rule
that the codebase is expected to satisfy. Non-compliance is an open bug.

- **Latest revision** — when the variant is identified but no revision is.

  Target rule: deterministic pick over revisions of the variant. Tie-break
  must be stable.

  Current state: `ORDER BY created_at DESC LIMIT 1` on the revision table,
  scoped to the variant. Tie-break under equal `created_at` is
  non-deterministic. Open bug: D7.

- **Default variant** — when only the artifact is identified.

  Target rule: each artifact has exactly one variant marked with an
  explicit `is_default: bool` column. The default-variant pick is `SELECT *
  FROM variants WHERE artifact_id = ? AND is_default IS TRUE LIMIT 1`. The
  column is set on artifact creation and is mutable via a dedicated
  set-default endpoint. A partial unique index `(artifact_id) WHERE
  is_default IS TRUE` enforces at most one default per artifact.

  Current state (interim, accepted until the flag lands): `fetch_variant`
  in `dbs/postgres/git/dao.py` does `LIMIT 1` with no `ORDER BY`. Worse,
  the `artifact_ref.slug` branch is missing entirely — only
  `artifact_ref.id` filters by artifact; an `artifact_ref` carrying only a
  `slug` reduces the query to `WHERE project_id = ? LIMIT 1`, returning an
  arbitrary variant from any artifact in the project. The slug-only case
  was already broken before this design surfaced it. Open bugs: D2 (no
  default rule), D2.1 (slug-only `artifact_ref` ignored).

- **Default key** — when the env-backed path is used without an explicit
  `key` but with an identified `artifact_ref`.

  Target rule: derive `key = f"{<artifact>.slug}.revision"` from the
  identified artifact ref. Applies uniformly across all git-backed
  entities that support env-backed retrieve (applications, evaluators,
  workflows). After resolution, the env-resolved entity refs must be
  consistency-checked against the caller-supplied `artifact_ref` that
  produced the derivation — if the env deployment under the derived key
  resolves to a different artifact, return 400 (2.c on the way out).

  Current state: applications derives the key but does not consistency-
  check (D15). Workflows and evaluators do not derive at all and return
  400 on missing key (D11). Open bugs: D11, D15.

### Identifying-ref test

```python
def is_identifying(ref: Optional[Reference]) -> bool:
    return bool(ref and (ref.id or ref.slug))
```

`bool(ref)` alone is not enough — `Reference(id=None, slug=None,
version=None)` is truthy but unidentifying. This is the implementation of
`is_identifying` in `core/git/types.py` and is the formal definition the
rules above depend on.

---

## Section 2 — Current discrepancies

What today's code does versus what the rules require.

### D1. `2.c` is not enforced on the entity-ref path

When `revision_ref.id` (or `.slug`) is supplied alongside an `artifact_ref` or
`variant_ref` that does NOT correspond to the resolved revision, the server
silently uses the revision and ignores the other refs. Audit doc calls this
**Bug D**. No 400 is raised, no warning is logged. Affects all six entity
retrieve endpoints.

### D2. `2.d` default-variant fallback is non-deterministic

`fetch_*_variant(artifact_ref)` in `dbs/postgres/git/dao.py:476` does
`LIMIT 1` with **no `ORDER BY`**. For multi-variant artifacts, the chosen
variant is whatever Postgres surfaces first. Audit doc calls this **Bug C**.
There is no "default variant" concept in the data model today. Target rule
under the Defaults reference is an explicit `is_default: bool` column on the
variant table.

### D2.1. `fetch_variant(artifact_ref={slug})` ignores the slug

`GitDAO.fetch_variant` (`dbs/postgres/git/dao.py:500-507`) only filters by
`artifact_ref.id`. When the caller passes `artifact_ref.slug` without `id`,
no `WHERE artifact.slug = ?` clause is added. Combined with D2's missing
`ORDER BY`, the query reduces to `SELECT * FROM variants WHERE project_id =
? LIMIT 1` — returning an arbitrary variant from any artifact in the
project. This is independent of D2 (D2 is "no rule for multi-variant
artifacts"; D2.1 is "slug-only artifact_ref is structurally ignored") and
must be fixed even if D2's default-variant flag lands.

### D3. `2.d` `{artifact_ref + version}` is rejected, not resolved

PR #4422's helper rejects `{artifact_ref + revision_ref:{version}}` because
accepting it would require the default-variant fallback that D2 leaves
broken. The reject is correct *given* D2 but means 2.d is under-implemented:
a case that the data model can answer is currently a 400.

### D4. Variant-by-version analog of 2.e is not caught

The helper rejects `{revision_ref:{version}}` because revision `version` is
per-variant. But `variant.version` is per-artifact, so `{variant_ref:{version}}`
without an `artifact_ref` is the same trap. Today the helper accepts it
because the variant `version` field is not inspected. Affects any retrieve
that passes through `fetch_*_variant({version})`.

### D5. Env-backed `key` rules are not centralized

Per-router behavior:

- **Applications:** auto-derives `key = f"{application.slug}.revision"` from
  an identified `application_ref`.
- **Workflows:** rejects missing `key` with 400 unconditionally.
- **Evaluators:** rejects missing `key` with 400 unconditionally.

No shared utility encodes the rule; no test pins it; the three routers each
have their own copy.

### D6. Docs site lies about behavior

PR #4418/#4422 fixed the per-field descriptions on the 6 request models. But
[`02-fetch-prompt-programatically.mdx`](../../docs/prompt-engineering/integrating-prompts/02-fetch-prompt-programatically.mdx)
still shows only the full-triple-ref shape and never mentions the env-backed
path's `key` rule or the default-key behavior. Audit doc calls this **Bug F**.

No single user-facing document states the five rules or the
precedence-and-defaults reference. The audit doc is internal; field
descriptions are per-endpoint.

### D7. No deterministic tie-break for "latest revision"

When 2.d falls back to "latest revision of this variant," the DAO uses
`ORDER BY created_at DESC LIMIT 1`. If two revisions on the same variant
share a `created_at` timestamp, the picked revision is arbitrary.

### D8. No precedence test coverage

PR #4422 covers 2.e (rejection of insufficient refs) with unit + acceptance
tests. It does not cover 2.b, 2.c, 2.d, or any of the env-path or path-mixed
variants. Until tests exist for those cases, regressions in any of D1–D7 and
D10–D13 are unobservable.

### D9. The five rules are not codified anywhere in the codebase

`validate_revision_refs_sufficient` enforces a fragment of 2.e. There is no
constant, comment block, or single doc string that lists the five rules,
the precedence orders, or the default rules so future maintainers can match
new validation to the right rule. This document is the first attempt at
codifying them.

### D10. `2.c` is not enforced on the env-ref path or across paths

Two related gaps:

- **Within the env-ref path:** `{environment_ref + environment_revision_ref}`
  where the revision belongs to a different env is silently absorbed —
  mirror of D1 at the env level.
- **Across paths:** applications and workflows silently let the env-ref path
  win when path-mixed. If the entity refs the caller sent contradict the
  env's deployment-map contents, no error is raised. Evaluators rejects
  path-mixing entirely (different overreach — D12).

### D11. Default-key rule is inconsistent across entities

Applications derives `key` from `application_ref.slug`. Workflows and
evaluators do not. Same input shape, different behavior per entity — a 2.d
fallback that is partially implemented. Either all three should derive (and
testsets/queries/environments don't have env-backed retrieve so they're
out of scope), or none should.

### D12. Evaluators over-restricts path-mixing

`/evaluators/revisions/retrieve` returns 400 on any request that carries both
entity refs and env refs. That's a policy decision (refuse redundancy) that
applications and workflows do not share. None of the three is documented as
the rule; the evaluators rejection is observable behavior, not a designed
constraint.

### D13. `{environment_revision_ref: {version: "X"}}` is the env-side D4

Env revisions have a `version` column too, per env variant. Sending only
`environment_revision_ref: {version: "3"}` falls into the same trap as the
entity-side: no env-variant context, so the version is unscoped. Today the
service-level validation does not catch this on the env-ref path.

### D14. `key`-only without env is silently accepted (or silently empty)

`{key: "my-app.revision"}` with no `environment_ref` and no entity refs hits
the application's `application_lookup_requested or environment_lookup_requested`
gate, where `environment_lookup_requested = environment_refs_requested or
key is not None`. So `key` alone passes the gate but then `environment_refs_requested`
is false → returns 400 "requires environment refs." That's correct.
But the error message doesn't surface the actual mistake (sent `key` without
env refs) — it just says "requires environment refs." Minor; lumped here for
completeness.

### D15. Derived `key` is not consistency-checked on the way out

Applications today derives `key = f"{application.slug}.revision"` when the
caller supplies an identified `application_ref` but no explicit `key`. The
derived key is used to look up a slot in the env deployment map. The slot's
entity-ref triple is then returned as-is.

There is no check that the slot's resolved revision actually belongs to the
`application_ref` that produced the derivation. So if the env's deployment
under `"my-app.revision"` resolves to refs for a different application
(stale deployment, manual env edit, etc.), the caller gets back a revision
that contradicts the artifact ref they sent. This is the on-the-way-out
analog of 2.c for the default-key path. Caught by C3's consistency check
once it lands.

---

## Section 3 — What needs to change

Each item maps to one or more discrepancies above. Order is suggested
implementation order; dependencies are noted.

### C1a. Make default-variant pick deterministic via ORDER BY — fixes D2 (interim)

Smallest possible fix. In `GitDAO.fetch_variant(artifact_ref)` at
`dbs/postgres/git/dao.py:476`, when the caller supplies `artifact_ref` but no
`variant_ref`, add `ORDER BY created_at ASC, id ASC` before the `LIMIT 1`.
First-created variant wins. Matches the existing latest-revision ordering
pattern, deterministic under ties.

No schema change. ~2 lines. Unblocks C2.

### C1b. Add `is_default` flag in `variant.flags` (JSONB) — replaces C1a target

The real fix. `is_default` is **not a new column** — variant tables already
carry a nullable `flags` JSONB column via the shared `FlagsDBA` mixin
(`dbs/postgres/shared/dbas.py:198`). The default-variant marker is a key
inside that JSON, not a top-level column.

Migration is correspondingly lighter than a schema migration:

1. **Backfill:** for each artifact, update its earliest-created variant's
   `flags` to merge in `{"is_default": true}`. Idempotent: re-running
   leaves a project with an existing default untouched. One Alembic data
   migration per entity table (workflows, applications, evaluators,
   testsets, queries, environments).
2. **Index for fast lookup** — project-scoped to match existing variant
   indexes (slug uniqueness is `(project_id, slug)`):
   - **Partial expression index** on `(project_id, artifact_id) WHERE
     (flags->>'is_default')::boolean IS TRUE`. Doubles as both the
     uniqueness constraint (at most one default per artifact per project)
     and the lookup index for the default-variant query. Single index
     seek.
3. **Service mutation:** `set_default_variant(artifact_id, variant_id)`
   flips the flag under a transaction — unsets the previous default,
   sets the new one. The partial-unique index makes the transaction safe
   under concurrent calls (one will lose the index conflict and retry).
4. **DAO read:** `GitDAO.fetch_variant(artifact_ref={id|slug})` adds
   `WHERE (flags->>'is_default')::boolean IS TRUE` when no `variant_ref`
   is supplied. Replaces C1a's `ORDER BY`.
5. **Schema DTO:** add `is_default: Optional[bool]` to the variant flags
   DTO (each entity's `*Flags` model) so the API can read/set it.

Lands last (see suggested order), since it's the highest-blast-radius
change and every other improvement is fine with C1a in the interim.

### C1.1. Fix slug-only `artifact_ref` in `fetch_variant` — fixes D2.1

Independent of C1's data-model change. In `dbs/postgres/git/dao.py:500-507`,
extend the `artifact_ref` branch to also filter by `artifact_ref.slug` via a
join on the artifact table when `artifact_ref.id` is unset. Mirror what
`fetch_revision` already does for variant slugs. No migration, ~5 lines.

Lands before C1's flag is wired into the same DAO method so the slug-only
case is correct under both the interim and the post-C1 behavior.

### C1.1b. Denormalize parent slugs onto variant and revision rows — perf

Today `artifact_slug` (on variants) and `artifact_slug` / `variant_slug` (on
revisions) are not stored — they're populated by the DAO via either join
loads (`selectinload(VariantDBE.artifact)` at
`dbs/postgres/git/dao.py:493`) or separate `IN` queries
(`fetch_variants`, `fetch_revisions` at lines 331-337, 726-764, 1291-1302),
then assigned to the DTO at lines 526, 831, 1117-1120. Every read path that
returns slugs pays this cost.

C3's consistency check (D1, D10, D15) needs these slugs on the resolved
revision to compare against caller-supplied refs. Same with any caller
that wants to render slugs in the UI without a second round trip. Without
denormalization, C3 either re-joins or accepts more latency on every
retrieve.

The fix:

1. Add nullable columns to the variant table: `artifact_slug`. Add to the
   revision table: `artifact_slug`, `variant_slug`. All on the shared
   git-pattern mixin so all six entities pick them up at once.
2. Backfill from the parent tables in the same Alembic migration.
3. Maintain the denormalized values on writes:
   - On variant create: copy `artifact.slug` into `variant.artifact_slug`.
   - On revision create: copy `variant.artifact_slug` and `variant.slug`.
   - On artifact slug rename: cascade to the artifact's variants and
     revisions. If artifact slugs are not renamable today, this is moot
     and the doc-string should note that constraint.
   - On variant slug rename: cascade to the variant's revisions. Same
     caveat.
4. DAO read paths drop the join load and the secondary `IN` queries —
   slugs come directly from the row.
5. Index choices: only add indexes if a query plan needs them. The
   primary use is reading slugs already returned by id-based lookups, so
   no new index is needed by default. Add `(project_id, artifact_slug)`
   on the revision table only if a query filters by it.

Trade-off: write paths grow a column copy (essentially free); rename
paths grow a cascading update (expensive if slugs are renamed often;
likely rare today). Net: cheaper reads everywhere in exchange for two
new columns and a write-path responsibility.

Lands after C1b. Both are migrations; bundling makes the variant-table
schema change a single ALTER. The two are independent but share blast
radius.

### C2. Accept `{artifact_ref + version}` and resolve via default variant — fixes D3

After C1, lift the helper's rejection of this shape. Two equivalent placements:

- **C2a.** In each entity service, before the helper call: if `revision_ref`
  has only `version`, `variant_ref` is unidentified, and `artifact_ref` is
  identified, resolve `artifact_ref → default_variant` and set `variant_ref`.
  Then call the helper. The helper itself does not change.
- **C2b.** Pass a resolver callback into the helper and have it do the
  resolution. Cleaner-looking but couples the validator to artifact lookups.

C2a matches the existing pattern. The helper's docstring already anticipates
C2a — no signature change needed.

### C3. Reject inconsistent redundant refs — fixes D1 + D10 + D15

After resolution but before returning, compare the resolved revision's
artifact/variant identity against what the caller sent:

- **Entity-ref path:** if `revision_ref.id|slug` resolved a revision, check
  `artifact_ref` and `variant_ref` match the resolved revision's
  `artifact_id`/`variant_id`/slugs.
- **Env-ref path:** if `environment_revision_ref.id|slug` resolved an env
  revision, check `environment_ref` and `environment_variant_ref` match the
  resolved revision's env identity.
- **Across paths (explicit `key`):** if both paths produced identifying refs,
  check the env-deployment-map resolution matches the entity refs the
  caller supplied.
- **Across paths (derived `key`):** when `key` was derived from
  `artifact_ref.slug` (default-key rule), the env's slot resolution must
  still belong to that same artifact. Otherwise the derived key looked up
  a slot the caller didn't actually mean — D15.

On mismatch, raise a new `RetrieveRefsInconsistent(GitError)` and surface as
400 naming the conflicting field. The exception and validator live in
`core/git/types.py` next to `RetrieveRefsInsufficient`.

### C4. Catch variant-by-version analog — fixes D4 + D13

Extend the helper (or add a sibling `validate_variant_refs_sufficient`) to
reject `{variant_ref:{version}}` without an `artifact_ref` (`id` or `slug`).
Same shape, same reasoning. Call it from `fetch_*_variant` paths. Mirror the
same check for the env-side: reject `{environment_revision_ref:{version}}`
without `{environment_variant_ref}` or `{environment_ref}`.

If C1's default-variant rule lets `{artifact_ref + variant.version}` resolve
deterministically, accept it via the C2 pattern.

### C5. Unify git-ref retrieval rules across paths and entities — fixes D5 + D11 + D12

C5 covers two layers of unification:

**Service-layer pipeline (six entities).** All six services'
`fetch_*_revision` carry the same pipeline today:
`validate_variant_refs_sufficient → validate_revision_refs_sufficient →
snapshot caller refs → needs_default_variant_resolution → fetch_artifact →
fetch_variant → fetch_revision → validate_retrieve_refs_consistent → wrap
DTO`. That pipeline should be extracted into a shared template so adding a
seventh git-backed entity (or evolving any of the six steps) happens in one
place.

**Router-layer env-backed retrieve policy (three routers).** The
`*_revision_retrieve` endpoints for applications, workflows, and evaluators
should share:

- `key` is required for env-backed lookups, derived from `artifact_ref.slug`
  as `f"{slug}.revision"` when missing (D11 default-key rule).
- Path-mixing is allowed; rely on C3's consistency check to reject
  contradictions after resolution (D10 path-mixing rule).
- Neither path identifying → 400.

This PR aligns the three routers inline so they exhibit the same behavior;
the actual helper extraction (both layers) is deferred to C5b.

### C5b. Extract the unified retrieval blocks into shared helpers — deferred

Once C5 has aligned both layers inline, factor the duplicated blocks into
shared helpers:

- Service-layer pipeline → e.g., `core/git/retrieve.py` or a mixin on the
  existing git service base.
- Router-layer env-resolution → e.g.,
  `apis/fastapi/shared/utils.py:plan_env_backed_retrieve`.

Bundle with C10's exception-translation decorator extraction — both touch
the same boilerplate (router try/except + retrieve_*_revision call) and
share the same six per-entity duplicates. Deferred so the alignment ships
first as small, low-risk changes; the extractions are mechanical refactors
afterwards.

### C6. Stable tie-break for latest-revision ordering — fixes D7

Change the DAO's latest-revision query from `ORDER BY created_at DESC LIMIT 1`
to `ORDER BY created_at DESC, id DESC LIMIT 1`. One line in `git/dao.py`.

### C7. Update user-facing docs — fixes D6

- Update [02-fetch-prompt-programatically.mdx](../../docs/prompt-engineering/integrating-prompts/02-fetch-prompt-programatically.mdx)
  to show all valid request shapes for the entity-ref path AND the
  environment-ref path (with and without explicit `key`).
- Cross-link the OpenAPI field descriptions to a single "How references
  resolve" section that states the five rules, the precedence orders, and
  the default rules.
- Mention the 400 cases explicitly (per-endpoint, not just in a global page).

### C8. Test coverage for every rule — fixes D8

Parametrize tests by entity and by path. Cases:

- **2.a (entity path):** one assert per identifying shape (`revision.id`,
  `revision.slug`, `(variant, version)`, `artifact` alone post-C1).
- **2.a (env path):** `{env_ref, key}` and `{env_revision_ref, key}`.
- **2.b (entity + env consistent):** redundant-consistent triples + redundant
  path-mixed → 200.
- **2.c (entity, env, and path-mixed inconsistent):** all three flavors of
  inconsistency → 400.
- **2.d (entity):** `{variant_ref}`, `{artifact_ref}`, `{artifact_ref + version}`
  (post-C2) → resolved correctly.
- **2.d (env):** `{env_ref, key}` resolves to latest env revision +
  deployment map lookup; default-key rule (post-C5) on every applicable entity
  → 200.
- **2.e:** existing PR #4422 coverage + variant-by-version + env-revision-
  version-only + `key` without env.

PR #4422's `test_revision_retrieve_ambiguous_400.py` is the seed for the 2.e
cases; the rest of the file grows to cover the others.

### C9. Codify the rules and defaults in code — fixes D9

A module docstring on `core/git/types.py` (or a dedicated `core/git/README.md`)
that states the five rules, the precedence orders, the default rules, and
the identifying-ref test. Links to this document for the discrepancies and
change plan.

### C10. Unify git-domain exception → HTTP translation — refactor

Today every router that calls a git-pattern service catches the domain
exception inline and translates to `HTTPException(400, detail=e.message)`.
Inventory at this commit:

- **12 inline `except` blocks** across 6 routers (workflows, applications,
  evaluators, testsets, queries, environments).
- **2 domain exceptions** today: `VariantForkError`, `RetrieveRefsInsufficient`.
- **+1 from C3:** `RetrieveRefsInconsistent`.
- **+1 possibly from C4:** a variant-ref-version helper exception.

Each new git-domain exception multiplies the boilerplate by the number of
call sites. The codebase already has a cleaner pattern in `folders/`:

- Typed `*Exception(HTTPException)` classes in
  `apis/fastapi/folders/models.py`.
- A domain decorator `@handle_folder_exceptions()` in
  `apis/fastapi/folders/router.py:41` that maps core exceptions to typed
  HTTP exceptions in one place.

Apply the same shape to the git domain:

1. Define typed exceptions in `apis/fastapi/shared/git_exceptions.py` (or
   similar): `VariantForkErrorException`, `RetrieveRefsInsufficientException`,
   `RetrieveRefsInconsistentException`. All inherit from
   `BadRequestException` (from `utils/exceptions.py:226`) which already
   carries the 400 status.
2. Define `@handle_git_exceptions()` decorator in the same module that
   wraps a route function and maps each core exception to its typed
   counterpart. Mirror `handle_folder_exceptions` at
   `apis/fastapi/folders/router.py:41`.
3. Apply the decorator to every retrieve/deploy/fork route across all six
   routers. Remove the 12 inline `except` blocks. Net delta: -50 lines or
   so across the routers, +30 lines in the shared module.
4. Document in the module docstring that any new git-domain exception
   added to `core/git/types.py` must also be registered in the decorator
   and given a typed counterpart. Add a comment at the top of
   `core/git/types.py` pointing at the registration site.

Trade-offs against the current inline pattern:

- **Pro:** new domain exceptions need updates in one place (the decorator
  and typed-exception module), not N call sites.
- **Pro:** typed exceptions can carry structured detail (`field`, `path`)
  on top of the message, matching how `FolderNameInvalidException` is
  shaped today. Useful for C3 where the error message names a specific
  field — clients can parse it programmatically.
- **Con:** indirection — reading a router no longer shows which
  exceptions become which HTTP responses; you have to look at the
  decorator. Mitigated by keeping the decorator small and naming each
  mapping clearly.
- **Con:** decorator placement matters with the existing
  `@intercept_exceptions()` and `@suppress_exceptions()` stack. Need to
  insert `@handle_git_exceptions()` between the route body and any
  `suppress_exceptions(exclude=[HTTPException])` so the typed exception
  is in the exclude list and gets re-raised. Same pattern as today's
  inline `HTTPException` raise — no behavior change.

Lands as a refactor, not a behavior change. No new tests beyond
re-running the existing 400-assertions, which will continue to pass
since the status code and message text are preserved.

---

## Suggested landing order

Every C item appears below. Ordering reflects dependencies and blast radius.
C1b is last because it's the only change that touches data and indexes
across all six entity tables.

1. **C6** — stable tie-break for `latest_revision` (`ORDER BY created_at
   DESC, id DESC`). One line, no behavior change for any working request.
2. **C1.1** — fix `fetch_variant(artifact_ref={slug})` to actually filter
   by slug via a join. Independent of C1's default-variant work; correct
   under both the C1a interim and the C1b target.
3. **C1a** — deterministic default-variant pick via `ORDER BY created_at
   ASC, id ASC LIMIT 1`. Interim of C1b. Unblocks C2 immediately without
   the migration of C1b.
4. **C8 (first pass)** — pin existing behavior for 2.a, 2.b, 2.d before
   any further change. Catches accidental regressions in the next steps.
5. **C2** — lift the helper's `{artifact_ref + version}` rejection now
   that C1a makes the default-variant pick deterministic.
6. **C3** — new `RetrieveRefsInconsistent` exception, post-resolution
   consistency checks for entity-ref path, env-ref path, across-paths
   (explicit `key`), and across-paths (derived `key` / D15).
7. **C4** — variant-by-version analog of the helper, plus the env-side
   `{environment_revision_ref:{version}}` mirror.
8. **C5** — centralize env-backed retrieve rules (`key` requirement,
   default-key derivation, path-mixing policy) in a shared utility.
   Unblocks D11 and D12 fixes in one move; applications/workflows/
   evaluators all call the same helper afterward.
9. **C8 (second pass)** — extend coverage to 2.c, env-path cases, and
   path-mixed cases now that the C3/C4/C5 behavior is stable.
10. **C10** — unify git-domain exception → HTTP translation. Replace the
    12 inline `except` blocks with a `@handle_git_exceptions()` decorator
    and typed `*Exception(BadRequestException)` classes. Lands after C3
    and C4 so the new exceptions get migrated in one sweep. Pure
    refactor; no behavior change.
11. **C7** — user-facing docs sweep. Can run in parallel with C5/C8/C10.
12. **C9** — codify the five rules, precedence orders, and defaults in
    `core/git/types.py` (or a dedicated `core/git/README.md`). Can run
    in parallel with C7.
13. **C1b** — `is_default` flag in `variant.flags` JSONB, backfill,
    partial-unique index, set-default mutation, DAO read. Penultimate
    because it touches every entity's variant data; safe to land after
    the behavior-changing items because C1a holds the line in the
    meantime. After C1b ships, C1a's `ORDER BY` becomes dead code and
    can be removed in the same PR (or a follow-up).
14. **C1.1b** — denormalize parent slugs onto variant and revision rows
    (`artifact_slug` on variants; `artifact_slug` + `variant_slug` on
    revisions). Backfill, write-path maintenance, DAO simplification.
    Last because it's the largest migration in scope (two tables, six
    entities) and depends on the rename-cascade decision being settled.
    Bundling with C1b is optional but reduces the number of variant-
    table ALTERs.

C6, C1.1, C1a, C2, C3, C4, C7, C9 are each small, scoped PRs (one to a
few files). C5 touches three routers but adds no schema. C7/C8 are
docs/tests sweeps. C1b and C1.1b are the data-migration PRs and bring
up the rear.
