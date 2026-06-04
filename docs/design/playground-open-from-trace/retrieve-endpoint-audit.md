# Audit: `POST /workflows/revisions/retrieve` behavior

## Why this document exists

While implementing slug-based resolution for opening trace spans in the playground, we sent the endpoint a request shaped like our trace references:

```json
{"workflow_ref": {"slug": "n8n"}, "workflow_revision_ref": {"version": "1"}}
```

The endpoint returned a completely unrelated revision (an Exact Match evaluator), then the playground happily navigated to that wrong app. No error, no warning, just wrong data. This document explains exactly why and what we can do about it.

## TL;DR

The endpoint silently drops parts of your request and substitutes arbitrary data when the request shape does not match an undocumented "expected" pattern. The data model can support the lookup we want in a single SQL query, but the current service+DAO split does not expose that capability without resolving through a variant first. Several pieces of the request validation that should exist do not.

## The data model

Three tables, with these properties (`api/oss/src/dbs/postgres/workflows/dbes.py`):

- **`workflow_artifacts`** — the "app". Unique on `(project_id, slug)`.
- **`workflow_variants`** — a branch within an artifact. Unique on `(project_id, slug)`. FK to artifact.
- **`workflow_revisions`** — an immutable commit. Unique on `(project_id, slug)`. FK to variant and (denormalized) to artifact. Has a `version` string column that is **only unique per variant**.

Key consequence: a `revision.version` of `"1"` exists in many places across a project. Without a variant or artifact context, it does not identify anything.

The reference DTO used in requests carries an optional `id`, `slug`, and `version`, and the same shape is used for artifacts, variants, and revisions.

## What the docs tell users

`docs/docs/prompt-engineering/integrating-prompts/02-fetch-prompt-programatically.mdx`:

> "You can fetch the configurations from a variant reference (`app_slug`, `variant_slug`, `variant_version`)... If you don't provide a `variant_version` parameter but only a `variant_slug` or an `environment_slug`, the SDK will fetch the latest version of the variant from the specified **environment/variant**."

Examples in the same doc:

```js
application_ref:          { slug: 'my-app-slug' },
application_variant_ref:  { slug: 'my-variant-slug' },
application_revision_ref: { version: 2 },
```

The documented contract: **send all three refs**, slug for artifact and variant, version for revision. Users sending only two refs are off-contract.

That's relevant because our trace producers (third-party adapters) emit only `application.slug` and `application_revision.version`. They omit the variant slug. So the very request shape that broke for us is the one the docs do not show.

## The two-layer architecture

The request goes through two layers. Both have logic, and both have bugs.

### Service layer

`api/oss/src/core/workflows/service.py:1068` — `fetch_workflow_revision`. Has one branch:

```python
if workflow_ref and not workflow_variant_ref and not workflow_revision_ref:
    # Resolve artifact, then pick "a" variant, then call DAO with that variant_ref.
```

This branch is the only place the service translates an artifact reference into a variant reference. If it fires, the DAO gets a properly scoped `variant_ref`. If it doesn't, the service hands the DAO whatever the caller sent, untouched.

### DAO layer

`api/oss/src/dbs/postgres/git/dao.py:1039` — `fetch_revision`. Function signature accepts `variant_ref` and `revision_ref` only. **There is no `artifact_ref` parameter.** The DAO is structurally incapable of filtering by artifact directly.

Its logic, in plain words:

1. If `revision_ref` carries an `id` or `slug`: filter by that. Ignore `variant_ref` and `version` entirely.
2. Else if `variant_ref` is set: filter by variant. If `revision_ref.version` is also set, AND the filter. Otherwise pick the latest by `created_at`.
3. Else (revision_ref is missing or has only `version`, and variant_ref is None): **apply no filters at all**. Just `WHERE project_id = ... LIMIT 1`.

That third branch is the silent failure trap.

## Current behavior: full input matrix

Notation: `art` = artifact/workflow ref, `var` = variant ref, `rev` = revision ref. `(id)`, `(slug)`, `(version)` show which fields are populated.

| `art` | `var` | `rev` | What the service does | What the DAO does | Result | Bug? |
|---|---|---|---|---|---|---|
| — | — | — | returns None | not called | None | OK |
| `(id)` or `(slug)` | — | — | resolves art → picks **first** variant (no `ORDER BY`) → calls DAO with variant_ref | filters by variant, returns latest revision | a revision of that artifact | OK on most apps, **non-deterministic if artifact has >1 variant** |
| — | `(id)` or `(slug)` | — | calls DAO with variant_ref | filters by variant, returns latest revision | latest revision of variant | OK |
| — | — | `(id)` | calls DAO with revision_ref | filters by revision id | the revision | OK |
| — | — | `(slug)` | calls DAO with revision_ref | filters by revision slug (project-unique) | the revision | OK |
| — | — | `(version)` only | calls DAO with revision_ref only | **falls into branch 3: no filters**, returns arbitrary project-wide row | wrong | **BUG A** |
| `(slug)` | — | `(version)` | service skips resolution (branch condition fails), calls DAO with revision_ref only | **falls into branch 3**, returns arbitrary project-wide row | wrong | **BUG B** (this is what hit us) |
| `(slug)` | — | `(id)` or `(slug)` | service skips resolution, calls DAO with revision_ref | filters by revision id/slug, returns that revision **regardless of which artifact it belongs to** | possibly wrong if revision slug exists across artifacts (it doesn't; slugs are project-unique) | OK in practice, but the service silently ignores `art` |
| `(slug)` | `(slug)` | `(version)` | service skips resolution (variant_ref is set), calls DAO with both | filters by variant + version | correct | OK |
| `(slug)` | `(slug)` | `(id)` | service skips resolution, calls DAO with both | filters by revision id (ignores variant) | correct | OK |
| any combination of `id`s | | | works like above with id paths | | | OK |

## The bugs and silent behaviors, called out one by one

### Bug A: version-only request returns arbitrary data

Input: `{revision_ref: {version: "1"}}`.

The DAO needs a variant to scope the version filter. With no variant, the version is dropped *and the DAO does not bail out* — it returns whichever row sorts first under `LIMIT 1`. The user gets a "valid-looking" revision that has nothing to do with their request.

Severity: high. Silent wrong result.

### Bug B: artifact + version drops the artifact silently

Input: `{workflow_ref: {slug: "X"}, workflow_revision_ref: {version: "1"}}`.

The service's only resolution branch requires `workflow_revision_ref` to be missing. With our shape, the branch is skipped. The DAO is then called with no variant_ref, and falls into the same arbitrary-row trap as Bug A.

This is what bit us with the n8n trace.

Severity: high. Silent wrong result. Affects every trace producer that emits slug + version (the natural shape for OTel-style instrumentation).

### Bug C: artifact-only resolution is non-deterministic with multi-variant artifacts

Input: `{workflow_ref: {slug: "X"}}` and X has more than one variant.

The service calls `fetch_workflow_variant(workflow_ref)` which goes to the DAO's `fetch_variant`. That DAO method does `LIMIT 1` with **no `ORDER BY`**. The variant returned is whatever Postgres feels like returning.

In practice most apps have one variant so this is rarely visible. But for apps with several variants the picked variant is undefined.

Severity: medium. Silently returns a "valid" revision that may not be the one the user expected.

### Bug D: the service silently ignores artifact when it shouldn't

Input: `{workflow_ref: {slug: "A"}, workflow_revision_ref: {id: "some-uuid"}}`.

The service skips resolution (revision_ref is present). The DAO uses the revision id and ignores the artifact. So the response is a revision that may not even belong to artifact A. Today this never produces wrong data because revision ids are globally unique, but the request's artifact constraint is being dropped on the floor with zero indication.

Severity: low-medium. Not currently broken in practice, but a future change to revision id semantics (or a mistake in caller code) would silently mis-resolve.

### Bug E: no input validation

The endpoint accepts any combination of refs and does its best. There is no check that says "you sent a version but no variant — that's not enough information." So the server cannot tell the difference between "user knew what they were doing and the data exists" and "user sent garbage." Both produce HTTP 200.

Severity: design issue. Underlies all of the above.

### Bug F: docs say one thing, behavior is different

The DTO field docstring says: `workflow_revision_ref` "Return this exact revision (by `id`, or by `slug` + `version`)." That description implies `slug + version` is treated as a compound key. The code does not: `slug` alone is used (revisions are project-unique by slug), and `version` is used only in the variant-scoped branch. The docs are misleading.

Severity: low. Mostly cosmetic, but it hides the actual constraints.

## What is technically possible at the data layer

The schema and existing joins support the lookup we actually want.

**Possible in a single SQL query today** (with appropriate joins):

- `(artifact_slug, revision_version)` → one revision. Requires joining artifact → variant → revision and filtering on artifact slug + revision version. The schema supports this; the DAO does not expose it.
- `(artifact_id, revision_version)` → one revision. Same shape.
- `(variant_slug, revision_version)` → one revision. Already exposed via `fetch_revision`.

**Not possible without ambiguity**:

- `(revision_version)` alone, where multiple variants share that version → genuinely ambiguous. No correct answer. Should error.
- "Latest across all variants of an artifact" → semantically unclear (latest by created_at? per-variant?). Today the service makes an arbitrary variant pick.

**Possible but expensive**:

- Resolving `(artifact_slug, revision_version)` via three sequential queries (artifact → first variant → revision in that variant with that version). The service already does the first two of those when called with `art` only, and could be extended to do all three. Cost: 3 queries instead of 1, on a hot path.

## Why the hot path matters

The retrieve endpoint is on the playground "open from trace" path, which the user triggers by clicking a button. One click = at most one round trip is the right experience. The endpoint is also a candidate for higher-volume use later (observability "view in app" links, evaluation result drill-ins). We should not paint ourselves into a corner where every caller has to make 2-3 calls or do client-side joining.

This rules out solutions that move resolution complexity to the caller. It rules in solutions that keep the endpoint as a single round trip even if the backend does multiple SQL queries.

## Other callers of the affected code

`fetch_workflow_revision` (the service method) is called from:

- `core/workflows/service.py` (six internal call sites, including `resolve_workflow_revision`, deploy paths, the retrieve route handler at line 1205).
- `core/embeds/utils.py:279, 294, 306` — embed expansion.
- `core/applications/service.py:552` — application execution.
- `core/evaluations/tasks/legacy.py:439, 1708` — evaluation pipeline.

Any fix at the service layer affects all of these. So the fix needs to not just patch the "art + version" case but stay correct for everyone else.

## A related bug: the trace producer is also broken

Even when we want to send the canonical shape, we can't. The n8n trace's variant ref is empty:

```json
"references": [
    { "slug": "n8n",     "attributes": { "key": "application" } },
    {                     "attributes": { "key": "application_variant" } },
    { "version": "1",     "attributes": { "key": "application_revision" } }
]
```

The producer reserved the `application_variant` slot but didn't populate any field on it. So the frontend has no variant slug to send, even when the producer's intent was clearly to identify the variant.

This is out of scope for this PR but needs a follow-up ticket. Either the producer should populate the variant or it should not emit the empty slot.

---

## The plan

Two parallel PRs, one follow-up ticket.

### PR 1: Backend — guardrails only, no behavior change

Goal: make the endpoint stop returning wrong data. Do **not** change what it can answer today. If a request shape was silently broken before, it should now return a clear error instead of fake data. Anything that worked before continues to work identically.

**A2. DAO guardrail.**
In `api/oss/src/dbs/postgres/git/dao.py:fetch_revision`, if the function reaches the bottom of its filter chain without any artifact, variant, or revision-id/slug filter applied, return `None` instead of executing the unfiltered `LIMIT 1`. Today this silently picks an arbitrary project-wide row. The guard turns that into a clean miss. Defense in depth for the case where the service hands us an unscoped request.

**A3. Service request validation.**
At the entry to `fetch_workflow_revision`, reject ambiguous requests with explicit errors. Ambiguous means "we don't have enough information to identify a single revision unambiguously":

- All refs empty → error: "provide at least one of workflow_ref, workflow_variant_ref, or workflow_revision_ref."
- `workflow_revision_ref` populated with only `version` (no `id`, no `slug`), AND no `workflow_variant_ref` → error: "a revision version is a per-variant sequence number and requires a workflow_variant_ref. Provide variant_ref, or use revision_ref.id / revision_ref.slug which are project-unique."

Note: `workflow_ref` alone is **not** enough to disambiguate a version. The version sequence is scoped to the variant, not the artifact. If the artifact has multiple variants, the same version "1" can exist multiple times. The caller must either provide the variant explicitly or use a revision id/slug.

`workflow_revision_ref.id` alone is always sufficient. `workflow_revision_ref.slug` alone is always sufficient. Only "version only with no variant" is ambiguous.

**A4. Doc fix.**
Update the `workflow_revision_ref` field docstring in `api/oss/src/apis/fastapi/workflows/models.py:253`. The current text says "by `id`, or by `slug` + `version`", which is misleading on both counts:

- `slug` alone identifies a revision (revisions are project-unique by slug).
- `version` alone is a per-variant sequence and requires a variant context.

Replace with text that accurately states what each field can do alone and in combination.

**Explicitly out of scope for PR 1**, separate tickets:

- Service-level resolution fix (the would-be A1): leave the existing behavior alone. Callers that send `(workflow_ref, revision_ref.version)` will get a 400 from A3 instead of wrong data. Fixing the resolution so it answers correctly is a behavior change and warrants its own PR.
- Multi-variant ambiguity in `fetch_workflow_variant(artifact_ref)`.
- Silent drop of `workflow_ref` when `revision_ref.id` is present (mismatch validation).
- DAO refactor to accept `artifact_ref` directly.

### PR 1.5: Audit all callers before PR 1 lands

Goal: PR 1's validation (A3) turns previously-silent broken requests into loud 400s. Before merging, make sure no existing caller in the codebase is producing such a request today. If any is, fix it in PR 1 (or call it out and decide).

**Scope of the audit:**

- Frontend: every place that calls `POST /workflows/revisions/retrieve` directly, or uses the `retrieveWorkflowRevision` helper, or any wrapper of it.
- Backend internal callers of the service method `fetch_workflow_revision` (`core/embeds/utils.py`, `core/applications/service.py`, `core/evaluations/tasks/legacy.py`, internal calls in `core/workflows/service.py`).
- SDK packages that ship to users: `@agentaai/api-client`, the Python SDK, any TS SDK. If a client sends the ambiguous shape today, A3 will break user code.

**For each caller, check:**

1. Does it ever send `workflow_revision_ref` with only `version` (no `id`, no `slug`)?
2. If yes, does it also send `workflow_variant_ref`?
3. If not, the call will 400 after A3. Either fix the caller to include the variant, or accept the regression and document it.

**Frontend caller list as of today** (from `grep -rn "/workflows/revisions/retrieve\|workflowRevisionRef" web/`):

- `web/packages/agenta-playground/src/state/controllers/playgroundController.ts` — the one we added; will be normalized by B1.

(No others. The `/applications/revisions/retrieve`, `/testsets/revisions/retrieve`, `/queries/revisions/retrieve` endpoints in the codebase are different endpoints and out of scope.)

**Backend internal caller list** — to be confirmed during PR 1 by walking each call site.

### PR 2: Frontend — only send requests the backend can answer

Goal: never send a request the backend will reject. When we have ambiguous data, simplify the request to something the backend can answer (even if less precise) rather than sending the full ambiguous shape. We did **not** change the backend's functionality, so the frontend must adapt to what works today.

**B1. Build only well-formed requests.**
Mirror the backend's A3 rule on the client side. Before calling `retrieveWorkflowRevision`, normalize the request:

- If we have `application.id` (UUID): use it directly, skip the resolver entirely.
- Else if we have `application.slug`:
  - If we **also** have `application_variant.slug` AND `application_revision.version`: send all three.
  - Else: send only `workflow_ref: {slug}`. **Drop the version** if there is no variant slug to scope it. This loses the version precision but it's a request the backend can answer.
  - Either way, also send `workflow_revision_ref.id` or `workflow_revision_ref.slug` if present (those are sufficient on their own).
- Else: skip the call entirely (we have nothing to resolve), fall through to ephemeral.

The principle: never send `(workflow_ref + revision_ref.version)` without a variant. The backend cannot answer that shape correctly today, and after PR 1 lands it will be a 400. So the frontend must filter the version out client-side.

**B2. Verify the response matches the request.**
After the call returns, check that `revision.artifact_slug` (or `workflow_slug`) equals the slug we sent. If not, discard the response and fall through to ephemeral. Insurance against future backend regressions and stale data.

**B3. Fallback to ephemeral on miss.**
If the call returns `null`, fails B2's check, or throws, fall through to the current ephemeral path. The "Playground" button never produces a worse outcome than today.

Resolver decision tree:

```text
1. application.id is a UUID?
       → existing path, no resolver call.

2. application.slug is set?
       a. Build normalized request:
            workflow_ref          = {slug: application.slug}
            workflow_variant_ref  = {slug: application_variant.slug}   if present
            workflow_revision_ref = {id|slug: ...}                       if revision_ref has id or slug
                                  = {version: ...}                       if variant_ref is also being sent
                                  = (omit)                               otherwise (drop the version)
       b. Call retrieveWorkflowRevision with the normalized request.
       c. Response is non-null AND revision.artifact_slug matches?
            yes → use it (synthesize ids onto refs, fall through to existing revision branch).
            no  → fall through to ephemeral.

3. Fall through to ephemeral (today's behavior).
```

### Follow-up ticket: producer bug

Investigate why the n8n integration (or whatever produces these spans) emits an empty `application_variant` ref. Either populate the slug correctly or stop emitting the empty placeholder. Once fixed, the frontend's B1 normalization will get the canonical `(slug, variant_slug, version)` shape and the playground will open the exact revision the trace ran on, not just the latest revision of the app.

---

## Landing order

1. **Audit (PR 1.5)** as part of preparing PR 1. Walk every existing caller in the frontend, backend, and SDKs. Fix any that would break under A3.
2. **PR 1 (backend)** lands the guardrails. Safe to merge once the audit confirms no existing caller breaks.
3. **PR 2 (frontend)** can be developed in parallel and merged after PR 1, since B1's normalization makes the frontend safe under A3.
4. **Producer ticket** filed; not blocking.
