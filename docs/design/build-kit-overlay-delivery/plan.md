# Plan

Dependency order: BE-1 (catalog entry, core-layer builder + embeddability guard) → FE-1
(slug retrieve + entity-type gate, rider kept as fallback) → TEST → QA. **BE-2 (retire the
per-app rider) is deferred to a follow-up release** — see the compatibility-window note in
Phase BE-2 below. FE-1 depends only on the shape of what `__ag__build_kit` returns, so the
catalog entry and the FE atom scaffold can proceed in parallel once that shape is fixed.

Every phase is verified against this tree. The delivery-door decision (Option F: the build
kit is a reserved static workflow) is in
[context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow). A
codex xhigh design review of this plan (2026-07-07) folded six changes into the phases
below — layering (BE-1), explicit entry metadata (BE-1), an embeddability policy
(BE-1/TEST), a rider compatibility window (FE-1/BE-2), an RBAC verification
(research.md §10), and positive test pinning (TEST). See
[status.md](./status.md#review-rounds) for the round record.

## Phase BE-1 — Add `__ag__build_kit` to the static catalog (API)

**Goal:** serve the build kit as one more entry in `StaticWorkflowCatalog`, reached by slug
through the retrieve path that already serves `__ag__build_an_agent` /
`__ag__request_connection`. No new route, no new response model.

**Layering (codex xhigh design review, 2026-07-07):** the content builder must live in
`core/workflows` alongside `static_catalog.py` — core code can never import from the API
layer (`apis/fastapi/**`, per `api/AGENTS.md`), and having `static_catalog.py` call into
`apis/fastapi/applications/overlay.py` would do exactly that. `overlay.py` becomes a thin
back-compat adapter instead. Details folded into the bullets below.

Concrete edit points, verified against this tree:

- **Catalog entry** — add `__ag__build_kit` to `_STATIC_WORKFLOWS`
  (`api/oss/src/core/workflows/static_catalog.py:129`), next to the existing three entries,
  with `{"latest": "v1", "versions": {"v1": _build_kit_revision()}}`. Add a slug constant
  (e.g. `BUILD_KIT_WORKFLOW_SLUG = "__ag__build_kit"`); it must start with
  `STATIC_SLUG_PREFIX` (`__ag__`) or `_validate_catalog` rejects it at construction
  (`static_catalog.py:201-205`).
- **Revision builder** — add `_build_kit_revision() -> WorkflowRevision` alongside
  `_skill_revision` / `_client_tool_revision` (`static_catalog.py:72-125`). It returns a
  `WorkflowRevision(name="Playground build kit", description=..., data=WorkflowRevisionData(
  uri=<agent builtin uri>, parameters={"agent": <kit config>}))`. `_validate_catalog`
  requires `data.uri` to be truthy (`static_catalog.py:213-222`), and `_build_revision`
  infers flags from it (`static_catalog.py:283-284` → `infer_flags_from_data`). With
  `uri = "agenta:builtin:agent:v0"` the kit revision infers `is_agent=True`,
  `is_managed=True`, `is_skill=False`, `has_url=True`, and `is_static=True` (slug-derived)
  — see `sdks/python/agenta/sdk/engines/running/utils.py:702-812`. The agent key must be in
  `_AGENTA_ROLE_TABLE` or flag inference raises (it is; agents are a known key).
- **Kit config = today's overlay output, builder relocated for layering** —
  `parameters.agent` must equal exactly what `build_agent_template_overlay()` emits today
  (originally `api/oss/src/apis/fastapi/applications/overlay.py:77-109`): `tools` = read/bash
  forced builtins + the 13 `DEFAULT_BUILD_KIT_OPS` platform configs + the
  `request_connection` `@ag.embed` (with `name` sibling); `skills` = the build-an-agent
  `@ag.embed` (with `name` sibling); `sandbox.permissions = {write_files: allow,
  execute_code: allow}`.

  **Layering fix (codex xhigh design review, 2026-07-07):** `core/workflows/static_catalog.py`
  cannot import from `apis/fastapi/applications/overlay.py` — core must never import the API
  layer (`api/AGENTS.md`). So the content builder (the `DEFAULT_BUILD_KIT_OPS` list,
  `build_agent_template_overlay()`'s tool/skill/sandbox assembly, and
  `_reserved_static_tool_embeds()`) **moves into `core/workflows`** — either a new
  `build_kit.py` module next to `static_catalog.py`, or folded directly into
  `static_catalog.py`. `overlay.py` (`apis/fastapi/applications/`) becomes a **thin
  back-compat adapter**: it calls the relocated core builder and returns the same shape any
  existing caller expects, so no external contract changes. The SDK-constant imports
  (`AGENTA_FORCED_TOOLS`, `BUILD_AN_AGENT_SLUG`, `REQUEST_CONNECTION_WORKFLOW_SLUG`) move
  their import site from `overlay.py` to the new core module accordingly.

  This **refines** context.md's "nothing relocates" (Mahmoud, Option F): the platform-ops
  list and kit content are not rewritten, re-scoped, or moved to a different domain — they
  move file location only, to sit at the core layer next to the catalog that serves them,
  which matches Mahmoud's own framing ("wherever the static catalog is, we would add this").
  See [context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow).

  **Guards this builder needs (see [research.md](./research.md) §10 and verify item 2 — the
  places the design as stated needs care), the self-reference guard now revised to an
  explicit allowlist instead of inference (codex review):**
  - **Explicit entry metadata, not inference:** `_reserved_static_tool_embeds()`
    (relocating from `overlay.py:54-74`) currently builds tool embeds by iterating
    `catalog.list_slugs()` and including every **non-skill** static workflow — an inference
    ("non-skill means tool") that would embed `__ag__build_kit` **into itself** once the kit
    itself is a non-skill catalog entry. Replace the inference with a **positive allowlist /
    explicit per-entry kind metadata**: only `__ag__request_connection` is a tool embed. The
    self-embed guard becomes **structural** (the builder only ever references the known
    tool/skill slugs by name), not a special case bolted on afterward.
  - **Import-time bootstrap:** `_build_kit_revision()` calling the relocated builder at
    module load would construct a fresh `StaticWorkflowCatalog()` that reads
    `_STATIC_WORKFLOWS` **while that dict is still being built** (the build-kit value is
    mid-evaluation) → partial-dict / NameError. Build the kit revision **lazily** (compute
    `parameters.agent` on first `retrieve_revision`, or via a module-level factory that runs
    after `_STATIC_WORKFLOWS` is assigned), or pass the builder an explicit sub-catalog that
    omits the build-kit entry. Either removes the cycle.

  **Embeddability policy (codex review, new plan item):** `__ag__build_kit` must be
  **retrievable but not embeddable/committable**. Being a real catalog workflow addressable
  by slug must not let an API caller reference it via `@ag.embed` from another config and
  have that reference persist — that would drag playground-only tools into a published
  agent. The embed resolver (`api/oss/src/core/embeds/` — wherever workflow refs resolve)
  and/or the commit path must **reject `__ag__build_kit` refs**. Add a unit test asserting a
  commit containing an embed of `__ag__build_kit` is rejected (Phase TEST).
- **No route changes.** The FE reaches the entry through the existing
  `POST /workflows/revisions/retrieve` (`retrieve_workflow_revision`, router.py:341-349),
  which resolves a reserved `__ag__*` slug through the catalog before any DB lookup
  (`WorkflowsService.fetch_workflow_revision` → `_resolve_static_revision`,
  `service.py:1460-1466`) and returns the synthetic revision directly, with
  `data.parameters.agent` intact (no normalization, no DB). The catalog is already wired
  into `workflows_service` at `api/entrypoints/routers.py:617-619`.

**Discard the parked Option-A route.** Remove the `GET /simple/applications/build-kit`
route registration (`router.py:1801-1809`), handler (`router.py:1896-1932`), and
`SimpleApplicationBuildKitResponse` (`models.py:665-680`) from the parked lane — do not
carry them forward. This is a straight drop of the discarded BE-1 diff.

**Verify (live):** `POST /workflows/revisions/retrieve` with body
`{"workflow_ref": {"slug": "__ag__build_kit"}}` and `?project_id=...` returns a revision
whose `data.parameters.agent.tools` has 16 entries (2 builtins + 13 ops + 1
request-connection embed) and `skills` has 1 embed, for a fresh account.

## Phase FE-1 — Slug retrieve + entity-type gate (frontend)

**Goal:** apply the kit to any agent-typed entity via the slug-first fetch, with the old
app-fetch chain kept as a **compatibility fallback** until BE-2 ships (see the rider
compatibility window below). The parked FE-1 work (`status.md`) **transfers**; only the
primary fetch swaps to the slug retrieve.

**Rider compatibility window (codex xhigh design review, 2026-07-07):** BE-2 (retiring
`additional_context.playground_build_kit`) is **deferred to a follow-up release** — this PR
keeps the rider live server-side. The FE must go **slug-first**: try
`agentBuildKitOverlayAtom` (the `__ag__build_kit` slug retrieve) first, and only fall back to
the existing per-app `additional_context.playground_build_kit` chain if the slug retrieve is
unavailable. This covers the deploy-skew window — an old API server (no `__ag__build_kit`
entry yet) paired with the new FE, or a cached old FE bundle paired with the new API. Do
**not** delete `simpleApplicationQueryAtomFamily` / `fetchSimpleApplication` in this phase;
that removal moves to BE-2.

**Adapt from the parked lane:**

- **Fetch** — replace the parked `fetchAgentBuildKitOverlay(projectId)` (which pointed at
  the discarded Option-A route) with a call to the existing
  `retrieveWorkflowRevision({projectId, workflowRef: {slug: "__ag__build_kit"}})`
  (`web/packages/agenta-entities/src/workflow/api/api.ts:296`). It already goes through the
  Fern client for `POST /workflows/revisions/retrieve`. **Do not** pass `resolve`: the FE
  wants the **unresolved** `parameters.agent` (embeds + their `name` siblings) — that is
  exactly what `useBuildKit` renders as embed-reference rows and what the run-time merger
  passes through for the runner to resolve later. Read the overlay from
  `revision.data.parameters.agent`.
- **Project-scoped atom** — keep `agentBuildKitOverlayAtom` (project-scoped `atomWithQuery`,
  `queryKey: ["agentBuildKitOverlay", projectId]`, `staleTime: Infinity`, `enabled: session
  && projectId`) in `web/packages/agenta-entities/src/workflow/state/store.ts`. Its `queryFn`
  now does the slug retrieve above and returns `revision.data.parameters.agent`.
- **Entity-type gate** — rewrite `workflowAgentTemplateOverlayAtomFamily(revisionId)`
  (currently the 3-hop app chain, `store.ts:1185-1203`) to gate purely on the **target
  entity** type: `get(workflowQueryAtomFamily(revisionId)).data?.flags?.is_agent ??
  get(workflowBaseEntityAtomFamily(revisionId))?.flags?.is_agent ?? false`; if not an agent,
  return `null`; otherwise return `get(agentBuildKitOverlayAtom).data`. Keep the export
  name/signature so `useBuildKit` (`useBuildKit.tsx:127`) and `agentRequest.ts` /
  `buildKitOverlay.ts` are untouched. **Keep this distinct in the doc/code:** the
  `flags.is_agent` gate reads the entity being edited, **not** the kit workflow's own flags.
- **Keep the app-fetch chain as fallback (deferred removal, codex review)** — do not delete
  `simpleApplicationQueryAtomFamily` / `fetchSimpleApplication` in FE-1 (grep confirmed the
  overlay atom was their only reader — `status.md`). They become the skew-window fallback
  path described above; their removal is now scoped to BE-2, once the rider is retired
  server-side.
- **Never-persisted invariant** — unchanged. The overlay stays client-side-merged
  (`buildKitOverlay.ts`) and never enters `prepareCommitParameters` output.

**Verify:** the kit renders for an ephemeral agent draft, after in-place onboarding commit,
and on a classic app playground, with a single network fetch per project.

## Phase BE-2 — Retire the per-application rider (API) — DEFERRED to a follow-up release

**Deferred (codex xhigh design review, 2026-07-07).** This PR does **not** remove the
`additional_context.playground_build_kit` rider on `fetch_simple_application`. Removing it
now would break the FE's slug-first-with-fallback compatibility window (Phase FE-1) for the
exact skew case it exists to cover — a cached old FE bundle (still reading the per-app
rider) paired with a new API server. Keep the rider live through this release; run this
phase in a **follow-up release** once the slug-first path has shipped long enough that skew
is no longer a concern. The steps below are otherwise unchanged and ready to execute then.

Do this only after FE-1 ships against `__ag__build_kit` (and after the compatibility window
above has closed).

- Remove overlay synthesis from `fetch_simple_application` (the
  `additional_context.playground_build_kit` attach, `router.py:1960-1975`);
  `additional_context` returns to `None` there. **Re-grep before editing** — line numbers
  shift once the discarded Option-A route/model are dropped in BE-1.
- The reader sweep already proved the FE overlay atom was the only consumer of
  `additional_context.playground_build_kit` (`context.md`), so this is a straight removal,
  not a phased deprecation.
- Optionally trim the now-unused overlay response models
  (`PlaygroundBuildKitContext`, `SimpleApplicationAdditionalContext`,
  `models.py:627-642`) once no handler populates them. `AgentTemplateOverlay`
  (`models.py:602-624`) can stay as documentation of the `parameters.agent` subset, or be
  dropped if nothing references it.

## Phase TEST — automated coverage

**Codex xhigh design review (2026-07-07) revised this phase: positive pinning instead of
enumeration, plus two new required tests (self-embed guard, embeddability guard).**

- **API unit** (`api/oss/tests/pytest/unit/`):
  - Content-equivalence: `StaticWorkflowCatalog().retrieve_revision(
    slug="__ag__build_kit").data.parameters["agent"] == <core build-kit builder output>`
    (post-layering-fix, the builder lives in `core/workflows`; `overlay.py`'s
    `build_agent_template_overlay()` is the thin adapter and should itself assert equal to
    the same core builder). Also: the kit revision carries `flags.is_static=True`,
    `flags.is_agent=True`, and a stable synthetic id; and `_resolve_static_revision` returns
    it for a `{slug: "__ag__build_kit"}` ref without a DB hit.
  - **Positive pin on tool embeds (codex review — replaces enumeration):** assert the tool
    embeds set is **exactly** `{"__ag__request_connection"}` — not "every non-skill static
    workflow." Enumerating `catalog.list_slugs()` and asserting "all non-skill slugs are
    tool embeds" would **pass even with the self-embed bug** (finding 2) once
    `__ag__build_kit` exists, because the kit itself is a non-skill slug that enumeration
    would then bless as a tool embed of itself. Update the existing enumeration-style
    assertion in `applications/test_build_kit_overlay.py` to this positive/explicit form.
  - **New: "does not embed itself" test** — assert `__ag__build_kit` does **not** appear
    anywhere in its own `tools`/`skills` embed list. Guards finding 2's fix directly, not
    just via the positive pin above.
  - **New: embeddability/commit-rejection test (finding 3)** — assert that committing a
    workflow revision whose `parameters` contains an `@ag.embed` reference to
    `__ag__build_kit` is **rejected** (by the embed resolver and/or the commit path,
    whichever enforces the policy — see Phase BE-1's embeddability policy). This is the
    regression test for "no API caller can persist a reference that drags playground tools
    into a published agent."
- **API integration**:
  - Hit `POST /workflows/revisions/retrieve` with the slug under an admin-minted account;
    assert the 16-tool / 1-skill shape and that no DB row exists for the slug.
  - **New: slug-retrieve content-equivalence test (codex review)** — assert the *retrieve
    response* for `{slug: "__ag__build_kit"}` equals the core builder's direct output
    end-to-end (not just the in-process catalog object), pinning the wire contract, not just
    the internal builder.
- **Delete** the discarded Option-A `fetch_simple_application_build_kit` tests.
- **FE unit** (package `tests/unit/`): the rewritten overlay atom returns the kit for an
  agent-typed entity and `null` for a non-agent entity, and does not depend on `workflow_id`.
  **New:** a slug-first-with-fallback test (finding 4) — when the slug retrieve is
  unavailable, the atom falls back to the per-app `additional_context.playground_build_kit`
  chain.

## Phase QA — live scripts, one per creation path

Run against `:8280` (EE dev, hot-reloads this tree). Mint an ephemeral account, exercise,
then archive every created entity (`POST /workflows/{id}/archive`).

1. **Ephemeral pre-commit:** open onboarding, confirm the build kit is visible on the draft
   agent's Advanced section.
2. **Onboarding post-commit:** send a seed to commit in place; confirm the kit stays visible
   on the committed agent without a reload (the reported bug — must go green).
3. **Classic template app:** create an agent app the classic way; confirm no regression.
4. **SDK-created app:** create an agent via SDK; open its playground; confirm the kit.
5. **Non-agent entity:** open a prompt/evaluator; confirm no build kit (no false positive).

## Docs / sync

- Run `keep-docs-in-sync`: the new `__ag__build_kit` catalog entry and the retired
  `additional_context.playground_build_kit` rider on `fetch_simple_application` are
  interface changes. Update the agent-workflows interface inventory (the `__ag__*` static
  workflow list) and any doc that described the build-kit-on-fetch delivery.

## Gate reminder

After all phases are green, the **flags-default-on re-flip (PR #5121 lane)** is unblocked.
Note that in the merge/handoff so the default flip proceeds.
