# Research — root cause with live evidence

All findings below were re-verified against the source in this tree and, where marked
LIVE, against the running EE dev stack at `http://localhost:8280` on 2026-07-07. Test
entities were created under ephemeral admin-minted accounts and archived after use.

## 1. The overlay is catalog-static (no application coupling is inherent)

`build_agent_template_overlay()` —
`api/oss/src/apis/fastapi/applications/overlay.py:77` — takes **no arguments**. It builds
the same 16-tool overlay every call from the platform catalog. There is a unit test
pinning the tool list and the platform-ops/skill/permissions content:
`api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py`.

The overlay is a pure function of platform state, not of any app/variant/revision. This
is the load-bearing fact for the whole design: **there is no per-application input to
overlay content**, so per-application delivery is a convenience, not a requirement.

## 2. Where the overlay attaches today (server)

`fetch_simple_application` (handler for `GET /simple/applications/{application_id}`) —
`api/oss/src/apis/fastapi/applications/router.py:1881-1932`. It attaches the overlay onto
`additional_context.playground_build_kit.agent_template_overlay` **unconditionally**
whenever the fetched `simple_application` is truthy. It does **not** inspect flags, type,
or ownership — any resolvable application gets the overlay.

Models: `SimpleApplicationAdditionalContext`, `PlaygroundBuildKitContext`,
`AgentTemplateOverlay` in `api/oss/src/apis/fastapi/applications/models.py:627-662`.

`simple_applications_service.fetch(application_id)` —
`api/oss/src/core/applications/service.py:1219-1287` — resolves by reusing the workflows
git storage: `fetch_application` (artifact) → `fetch_application_variant` → newest
`fetch_application_revision`. It returns non-None for **any** workflow that has a variant
and at least one revision. There is no "is this a *simple application* vs a *bare
workflow*" gate.

## 3. How the two creation paths actually build an agent

Both the "classic" and "onboarding" agent creations ultimately go through
**`POST /workflows/`**, not `POST /simple/applications/`:

- `createAppFromTemplate` (`web/packages/agenta-entities/src/workflow/api/createFromTemplate.ts`)
  → `createWorkflow(...)`.
- Onboarding: `useAgentOnboarding.ts` → `useCreateAgent.ts` →
  `createWorkflowFromEphemeralAtom` (`.../workflow/state/commit.ts:564`) →
  `createWorkflow(...)`.

`createWorkflow` (`web/packages/agenta-entities/src/workflow/api/api.ts:795-904`) issues:
1. `POST /workflows/` (artifact, `flags: {is_application: true}`)
2. `POST /workflows/variants/` (a `default` variant)
3. `POST /workflows/revisions/commit` (v0 seed)
4. `POST /workflows/revisions/commit` (v1 with `data.uri` = the agent builtin uri)

So the resulting artifact/variant/revision trio is **identical in shape** to what the
classic path produces. There is no structural difference in the created rows.

## 4. LIVE: the "missing application row" theory is DISPROVEN

Replicated the exact onboarding API sequence against `:8280` under a fresh account, then
fetched the app by its workflow id:

```
AGENT_URI = agenta:builtin:agent:v0   (catalog template key "agent")
POST /workflows/            -> 200  workflow_id = 019f3ce2-ce19-...
POST /workflows/variants/   -> 200
POST /workflows/revisions/commit (v0) -> 200
POST /workflows/revisions/commit (v1) -> 200  revision.workflow_id = 019f3ce2-ce19-...

[A: onboarding]  GET /simple/applications/{workflow_id}
    status=200  overlay=YES  tools=16  app present=True  count=1
    GET /workflows/revisions/{revision_id}.workflow_id = 019f3ce2-ce19-...   (present)

[B: classic]     POST /simple/applications/  -> 200
    GET /simple/applications/{id}
    status=200  overlay=YES  tools=16
```

**Conclusion:** a POST /workflows/-created ("onboarding") agent resolves as a full simple
application and its `GET /simple/applications/{workflow_id}` returns the same 16-tool
overlay as the classic path. The revision also returns its `workflow_id` correctly. The
server is healthy for every creation path. **Hypothesis (d) — onboarding commits a bare
workflow with no application row, causing a 404 — is false.**

This also answers the coordinator's dependency question: **nothing extra depends on a
distinct "application row" existing.** Applications are just workflows with
`is_application` flags; the fetch path is flag-agnostic.

### LIVE: is_agent is inferred server-side at commit

The onboarding commit forwards only `is_application` on the artifact, but the server
infers the handler flags from the URI. The committed revision's flags:

```
is_application: true, is_agent: true, is_managed: true, has_url: true, is_chat: false ...
```

So **every committed agent carries `is_agent: true`** regardless of which path created it.
This is what lets the frontend gate the global overlay purely on entity type. (Ephemeral
drafts also carry `is_agent: true` locally — set in `appUtils.ts` `buildWorkflow`.)

## 5. So where does the gap live? The frontend resolution chain

The overlay reaches the UI through exactly one chain
(`web/packages/agenta-entities/src/workflow/state/store.ts:1185-1203`):

```
workflowAgentTemplateOverlayAtomFamily(revisionId)
  ├─ revisionData = workflowQueryAtomFamily(revisionId).data
  ├─ applicationId = revisionData?.workflow_id
  │                ?? workflowBaseEntityAtomFamily(revisionId)?.workflow_id
  │                ?? null            ← if null, return null (no overlay)
  └─ simpleApplicationQueryAtomFamily(applicationId).data
        .additional_context.playground_build_kit.agent_template_overlay
```

Consumed by `useBuildKit`
(`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useBuildKit.tsx`)
via `useModelHarness.tsx:376-390`, with `revisionId = drillIn?.entityId`
(`AgentTemplateControl.tsx:274`). `hasBuildKitOverlay` drives whether the Advanced section
even renders the block.

### Pre-commit (ephemeral) gap — CONFIRMED by reading the atom

An ephemeral `local-*` entity has no `workflow_id` (its local `Workflow` object sets no
`workflow_id`; `workflowQueryAtomFamily` is disabled for local draft ids —
`store.ts:1070 !isLocalDraftId(revisionId)`). So `applicationId` is `null` and the atom
short-circuits to `null`. No overlay. This is the already-understood pre-commit gap.

### Post-commit gap — a client-state coupling failure, not a data gap

For an onboarding-committed agent the chain **can** resolve on paper: the commit primes
`["workflows","revision", revisionId, projectId]` with the full commit response
(`primeWorkflowRevisionDetailCacheImperative`, `store.ts:136`), and that response carries
`workflow_id` (verified LIVE in §4); `GET /simple/applications/{workflow_id}` returns the
overlay (§4). So the persistent post-commit disappearance is a **client-state
identity/timing failure in the in-place onboarding swap**, where one of these hops fails
to line up:

- **Entity identity:** `revisionId = drillIn?.entityId` must have switched from the
  ephemeral `local-*` id to the committed revision id. Onboarding swaps via
  `setEntityIds([revisionId])` + `history.replaceState` with **no page remount**
  (`useAgentOnboarding.ts:158-175`). The classic path does a full navigation to
  `/apps/{id}/playground`, which remounts and re-fetches the revision fresh (workflow_id
  guaranteed present). The in-place swap has more ways to leave a stale/ephemeral id or a
  half-primed cache in the drill-in.
- **Primed shape:** the overlay atom reads `workflowQueryAtomFamily(revisionId).data`.
  If the primed/normalized revision object dropped `workflow_id`, the fallback
  (`workflowBaseEntityAtomFamily` — only populated for local drafts) yields `null` for a
  committed revision → no overlay.
- **App query firing:** `simpleApplicationQueryAtomFamily(applicationId)` is only enabled
  once `applicationId` is non-null; any window where it's keyed with `""`/null and the
  app query doesn't re-fire on transition would leave it empty.

We did not pin the single exact failing hop in a live browser session (it needs a
headed onboarding repro), because **the chosen design removes the entire chain**, making
the distinction moot. What matters for the design is settled: the server is fine, the
overlay is catalog-static, and the only thing that varies per entity is *whether it's an
agent*.

## 6. Never-persisted behavior (unchanged, must not regress)

`prepareCommitParameters` (`.../workflow/state/commit.ts:68-87`) strips agenta metadata and
commits only the user-owned revision config; the overlay lives in read-only
`additional_context` / session atoms and never enters committed params. The global design
keeps the overlay entirely client-side-applied and out of the committed `data.parameters`,
so this is preserved by construction.

## 7. File / line map (for implementers)

Server:
- `api/oss/src/apis/fastapi/applications/overlay.py:77` — `build_agent_template_overlay()` (static)
- `api/oss/src/apis/fastapi/applications/router.py:1881-1932` — current attachment on fetch
- `api/oss/src/apis/fastapi/applications/models.py:627-662` — overlay models
- `api/oss/src/core/applications/service.py:1219-1287` — `SimpleApplicationsService.fetch`
- `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py` — overlay content tests
- `api/entrypoints/routers.py:630,928,1005` — service + router wiring

Frontend:
- `web/packages/agenta-entities/src/workflow/state/store.ts:1169-1207` — app query atom +
  overlay atom + `workflowBuildKitEnabledAtomFamily`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useBuildKit.tsx` — consumer
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx:376-390`
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx:274`
- `web/oss/src/components/pages/agent-home/PlaygroundOnboarding/useAgentOnboarding.ts` — in-place swap
- `web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts` — commit path
- `web/packages/agenta-entities/src/workflow/state/commit.ts:564` — `createWorkflowFromEphemeralAtom`
- `web/packages/agenta-entities/src/workflow/state/appUtils.ts:126-294` — ephemeral factory (flags incl. is_agent)

## 8. Design — the global model (original research trail; door superseded by §9 / Option F)

> **Superseded door:** the endpoint options weighed below (dedicated route / catalog-template
> rider) are kept for the record only. The delivery door is now **Option F** — the reserved
> static workflow `__ag__build_kit`, resolved by slug through `POST /workflows/revisions/
> retrieve`. See §9 above and
> [context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow). The
> *global model* itself (fetch-once-per-project, merge client-side by entity type) is
> unchanged and is what Option F delivers.

The global model below — fetch-once-per-project, apply client-side by entity type — is
settled and unaffected by which door serves the overlay. **Which route carries it (the
"delivery door") was re-opened after this research was first written**: the dedicated
route below shipped as a first pass (BE-1), then Mahmoud's review challenged it in favor of
reusing the existing catalog-template endpoint — and finally settled on Option F (the
reserved static workflow). The full option comparison and verdict now live in
[context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow)
— that section is the source of truth for the door decision; what follows here is kept as
the original research trail.

### Endpoint (design-interfaces lens)

Classify the payload by semantic role: it is **platform-provided config-overlay metadata**
— server-sourced, project-scoped (tenant/routing dimension, and the natural seam for
future per-plan gating), agent-template-typed. It is not credentials, not user data, not
per-entity data.

**Shape as first implemented (BE-1, now provisional) — a dedicated project-scoped GET in
the applications domain:**

```
GET /api/simple/applications/build-kit?project_id={pid}
  200 -> { "count": 1, "agent_template_overlay": { ...AgentTemplateOverlay } }
```

- Reuse the existing `AgentTemplateOverlay` model and `build_agent_template_overlay()`.
- Project-scoped via the standard `project_id` (VIEW_APPLICATIONS access check, matching
  the current handler). Project scope is what makes future per-plan gating a local change
  (consult entitlements inside this one handler) rather than a cross-cutting one.
- Named top-level field `agent_template_overlay` keeps the semantic role explicit and
  matches the field the FE already reads; no nesting under `additional_context` (that
  envelope existed only because it rode on the app response).
- Verified in this tree: registered `api/oss/src/apis/fastapi/applications/router.py:1801-1809`,
  handler `router.py:1896-1932`, response model `SimpleApplicationBuildKitResponse`
  (`api/oss/src/apis/fastapi/applications/models.py:665-680`).

**Alternative A considered at the time — catalog-scoped route** (e.g. surface the overlay
on the agent entry of `GET /workflows/catalog/templates/`, or
`GET /workflows/catalog/agent-build-kit`). The catalog is arguably the "truest" source
since the overlay is template metadata. Rejected at the time because: (a) the builder and
models already live in the applications domain and the FE already fetches there, so a
same-domain route looked like the smallest, lowest-risk move; (b) the catalog templates
list response is consumed by several create flows and widening its contract touches more
surface.

**Alternative B — reuse `fetch_application_catalog_template` (Mahmoud's suggestion,
now recommended; grounding citation).** This endpoint already exists in the applications
domain named in alternative A above, one level more specific than the list endpoint, and
was not considered in the original pass. Verified in this tree:

- Route: `GET /applications/catalog/templates/{template_key}` — registered
  `api/oss/src/apis/fastapi/applications/router.py:140-148`
  (`operation_id="fetch_application_catalog_template"`,
  `response_model=ApplicationCatalogTemplateResponse`, `response_model_exclude_none=True`).
- Handler: `router.py:470-495` — docstring: "Use this to inspect the exact `uri`, `data`,
  and JSON Schemas for a template before creating an application from it."
- Response model: `ApplicationCatalogTemplateResponse`
  (`api/oss/src/apis/fastapi/applications/models.py:797-804`) — `{count: int, template:
  Optional[ApplicationCatalogTemplate]}`.
- This resolves alternative A's objection (b): the endpoint that would grow is the
  fetch-by-key single-template endpoint, not the list endpoint several create flows
  consume — confirmed no FE surface calls the fetch-by-key endpoint today (grepped
  `web/oss/src` and `web/packages` for `CatalogTemplate` usage; only the list endpoint,
  `fetchWorkflowCatalogTemplates` against `GET /workflows/catalog/templates/`, is called,
  by `createFromTemplate.ts:173`). See context.md's Option B con for the implication: "the
  creation surfaces already call it" is true of the sibling list endpoint, not literally of
  this fetch-by-key one.

### Frontend

- Add a project-scoped atom `agentBuildKitOverlayAtom` (query keyed on `projectId` only,
  `staleTime` high — the overlay changes only with a deploy) that fetches the new endpoint
  once per project/session.
- Replace `workflowAgentTemplateOverlayAtomFamily(revisionId)` with a derivation that
  returns the project overlay **iff the entity is agent-typed**, else `null`:
  `agentBuildKitOverlayAtom` gated by an `is_agent` check on the entity
  (`workflowQueryAtomFamily(revisionId).data?.flags?.is_agent ??
  workflowBaseEntityAtomFamily(revisionId)?.flags?.is_agent`). Keep the same atom-family
  name/signature so `useBuildKit` needs no change, or point `useBuildKit` at the new atom.
- Net effect: ephemeral drafts (agent-typed, no workflow_id) and committed agents alike
  get the overlay; the `workflow_id → application fetch` hops are gone.

### Retire the per-application attachment

Remove the overlay synthesis from `fetch_simple_application` (router.py:1908-1932). If any
other consumer of `additional_context.playground_build_kit` is found, keep it one release
behind a deprecation comment and delete after the FE ships. (FE search shows the atom in
§5 is the only reader.)

## 9. Option F verify-item findings (2026-07-07)

These four items were verified in this tree for the chosen design (build kit as the reserved
static workflow `__ag__build_kit`). Verdicts with file:line.

### Verify 1 — nested embed resolution inside a static workflow: WORKS (this was the risk)

The kit's `parameters.agent` holds two `@ag.embed` entries: the `request_connection` tool
and the `build_an_agent` skill, referenced **by slug** (`{"workflow": {"slug": "__ag__…"}}`
— see `overlay.py:30-52`). Two separate facts confirm the design is safe:

- **The FE display path does not need resolution.** `useBuildKit`
  (`web/packages/agenta-entity-ui/.../agentTemplate/useBuildKit.tsx:42-78,156-160`) renders
  `@ag.embed` entries **as reference rows**, reading the embed's sibling `name` (or the
  ref'd workflow name). The run-time merger (`buildKitOverlay.ts`) also passes embeds
  through untouched, identity-keyed on the embed slug, for the runner to resolve at
  invocation. So the FE should call `POST /workflows/revisions/retrieve` **without
  `resolve`** and read the raw `revision.data.parameters.agent` — embeds + `name` siblings
  intact. A reserved slug returns the synthetic catalog revision **directly**, bypassing DB
  and `_normalize_revision_for_read` (`service.py:1460-1466`), so `parameters.agent` comes
  back exactly as authored.
- **Full resolution also works, if ever needed.** `resolve=True` (or
  `POST /workflows/revisions/resolve`) routes through
  `WorkflowsService.resolve_workflow_revision` (`service.py:2286-2315`): it fetches the
  static revision, then runs `embeds_service.resolve_configuration` over
  `revision.data`. The embed resolver's universal callback routes `workflow`-category refs
  back through `workflows_service.fetch_workflow_revision`
  (`api/oss/src/core/embeds/utils.py:278-325`), and **that is the same `workflows_service`
  that carries the static catalog** — wired at `api/entrypoints/routers.py:617-647`
  (`WorkflowsService(static_catalog=StaticWorkflowCatalog())` and
  `embeds_service.workflows_service = workflows_service`). So `__ag__request_connection` and
  `__ag__build_an_agent` resolve through the catalog, not Postgres. **Nested resolution
  genuinely works for static-catalog entries today; no gap.** The FE simply doesn't need it
  for the kit — it wants the unresolved shape.

### Verify 2 — catalog mechanics + the one place the design needs care

`_STATIC_WORKFLOWS` (`static_catalog.py:129-148`) maps slug → `{latest, versions: {vN:
WorkflowRevision}}`; revision builders (`_skill_revision`, `_client_tool_revision`,
`static_catalog.py:72-125`) return a `WorkflowRevision(name, description,
data=WorkflowRevisionData(uri, parameters))`, and `_build_revision`
(`static_catalog.py:274-299`) stamps ids/slug/version and infers flags via
`infer_flags_from_data(data, slug)`. A `_build_kit_revision()` with
`uri="agenta:builtin:agent:v0"` and `parameters={"agent": <kit>}` infers `is_agent=True`,
`is_managed=True`, `is_skill=False`, `has_url=True`, `is_static=True`
(`sdks/python/agenta/sdk/engines/running/utils.py:702-812`); `_validate_catalog` only
requires `data.uri` truthy and the slug prefixed `__ag__` (`static_catalog.py:201-222`).

- **Gate distinction (keep straight):** the FE `flags.is_agent` gate reads the **target
  entity** being edited, not the kit. The kit's own `is_agent` flag is irrelevant to the
  gate.
- **Two guards the content builder needs (the real risk of the design):**
  (a) `_reserved_static_tool_embeds()` (`overlay.py:54-74`) builds tool embeds by iterating
  `catalog.list_slugs()` and including every **non-skill** static workflow. `__ag__build_kit`
  is a non-skill (agent), so it would embed the kit **into itself**. The builder must exclude
  the build-kit slug (skip by name, or reference the two known tool/skill slugs explicitly).
  (b) `_build_kit_revision()` calling `build_agent_template_overlay()` at import time
  constructs a fresh `StaticWorkflowCatalog()` reading `_STATIC_WORKFLOWS` **while that dict
  is mid-construction** → partial-dict / NameError. Build the kit revision lazily, or pass an
  explicit sub-catalog omitting the build-kit entry. Both are simple; they are the only
  places the design as stated cannot be a naive copy of the current builder.

### Verify 3 — content equivalence

The kit's `parameters.agent` must equal `build_agent_template_overlay()`
(`overlay.py:77-109`): `tools` = `AGENTA_FORCED_TOOLS` (`["read","bash"]`,
`agenta_builtins.py:63`) + the 13 `DEFAULT_BUILD_KIT_OPS` platform configs + the
`request_connection` embed = **16 tools**; `skills` = the build-an-agent embed;
`sandbox.permissions = {write_files: allow, execute_code: allow}`. Both embeds carry a
`name` sibling for display. **overlay.py is absorbed as the kit's builder** (called from
`_build_kit_revision()` with the guards above), not deleted and not duplicated — the
platform-ops list stays put (Mahmoud: nothing relocates). A catalog unit test pins
`retrieve_revision(slug="__ag__build_kit").data.parameters["agent"] ==
build_agent_template_overlay()`.

### Verify 4 — merge semantics at the consumer: unchanged

The overlay is already a `Partial<AgentTemplate>` and is merged client-side in
`web/packages/agenta-playground/src/state/execution/buildKitOverlay.ts`:
`applyBuildKitOverlay(base, overlay)` deep-merges the object sections
(`sandbox`/`runner`/`harness`/`llm`/`instructions`, overlay wins at the leaf) and
identity-merges the list sections (`tools`/`skills`/`mcps`) keyed on `platform:<op>` |
`workflow:<embed-slug>` | `name:<name>` — an overlay entry replaces a same-identity base
entry, else appends. `withBuildKitOverlay` applies it to the per-run `parameters.agent` (or
a bare template) only when the build-kit toggle is enabled. **None of this changes under
Option F** — the atom still hands the merger the same `{tools, skills, sandbox}` object;
only where the atom sources it (slug retrieve of `__ag__build_kit` instead of the app-fetch
`additional_context`) changes. This is also the concrete evidence for Mahmoud's "it is just
an agent configuration" framing: the merge target is literally `parameters.agent`.

## 10. Codex xhigh design review — findings folded into the design (2026-07-07)

A codex xhigh design review of this plan accepted six findings, folded into
[plan.md](./plan.md) (phase changes) and [context.md](./context.md) (decision
refinements). Full detail lives in those files; this section is the research-trail record
plus the one live code verification done for this round.

1. **Layering.** The content builder must live in `core/workflows` (a `build_kit` module
   next to `static_catalog.py`, or inside it), not be imported from
   `apis/fastapi/applications/overlay.py` — core must never import the API layer
   (`api/AGENTS.md`). `overlay.py` becomes a thin back-compat adapter. See plan.md Phase
   BE-1 and context.md's refined "nothing relocates."
2. **Explicit entry metadata.** Replace the "non-skill means tool" inference in
   `_reserved_static_tool_embeds()` with a positive allowlist / explicit per-entry kind
   metadata — only `__ag__request_connection` is a tool embed. Makes the self-embed guard
   structural. See plan.md Phase BE-1.
3. **Embeddability policy.** `__ag__build_kit` is retrievable but not
   embeddable/committable. The embed resolver and/or commit path must reject build-kit
   refs. New plan item + test. See plan.md Phase BE-1 and Phase TEST.
4. **Rider compatibility window.** BE-2 (retiring the per-app rider) is deferred to a
   follow-up release; this PR keeps the rider, and the FE goes slug-first with the existing
   per-app chain retained as a skew fallback. See plan.md Phase FE-1 / BE-2.
5. **RBAC — verified in code, no gap found.** See below.
6. **Tests.** Positive-pin the tool-embed set, add a self-embed-guard test and a
   slug-retrieve content-equivalence test; the existing enumeration-style assertion in
   `test_build_kit_overlay.py` would bless the self-embed bug as written. See plan.md Phase
   TEST.

### RBAC verification (finding 5) — no role gap

**Question:** the new door (slug retrieve of `__ag__build_kit` via
`POST /workflows/revisions/retrieve`) authorizes on `Permission.VIEW_WORKFLOWS`; the old
door (`GET /simple/applications/{id}`) authorizes on `Permission.VIEW_APPLICATIONS`. Does
every default role that has `VIEW_APPLICATIONS` also have `VIEW_WORKFLOWS`, so no role
loses access to the build kit because of the door change?

**Verified in this tree (2026-07-07):**

- New door's check: `retrieve_workflow_revision` —
  `api/oss/src/apis/fastapi/workflows/router.py:1770-1781` — calls `check_action_access(...,
  permission=Permission.VIEW_WORKFLOWS)` at `router.py:1776-1779`.
- Old door's check: `fetch_simple_application` —
  `api/oss/src/apis/fastapi/applications/router.py:1898` —
  `permission=Permission.VIEW_APPLICATIONS`.
- Default role catalog: `api/oss/src/core/access/permissions/types.py`.
  `VIEWER_PERMISSIONS` (`types.py:175-198`) includes **both** `cls.VIEW_APPLICATIONS`
  (`types.py:176`) and `cls.VIEW_WORKFLOWS` (`types.py:181`). Every other default role
  builds additively on top of `VIEWER_PERMISSIONS`: `ANNOTATOR_PERMISSIONS =
  VIEWER_PERMISSIONS + [...]` (`types.py:199-209`), `EDITOR_PERMISSIONS =
  ANNOTATOR_PERMISSIONS + [...]` (`types.py:210-225`), `DEVELOPER_PERMISSIONS =
  EDITOR_PERMISSIONS + [...]` (`types.py:226-232`), `ADMIN_PERMISSIONS =
  DEVELOPER_PERMISSIONS + [...]` (`types.py:233-240`), and `DefaultRole.OWNER: [p for p in
  cls]` (`types.py:242`, every permission). So **every default role that has
  `VIEW_APPLICATIONS` also has `VIEW_WORKFLOWS`**, because both are baseline
  `VIEWER_PERMISSIONS` and no role above `viewer` drops a baseline permission. **No role gap
  in the default catalog.**
- **Caveat (not a plan item):** EE custom roles set via `AGENTA_ACCESS_ROLES` /
  `AGENTA_ACCESS_ROLES_OVERLAY` (`api/ee/src/core/access/permissions/role_overrides.py`)
  let an operator define a **custom** project role with an arbitrary permission list — an
  operator could in principle grant `VIEW_APPLICATIONS` without `VIEW_WORKFLOWS` on a
  hand-rolled role. This is pre-existing RBAC behavior (any two permissions can already be
  split this way today for any other domain pair) and not something this design introduces
  or worsens; no plan item needed.

**Verdict: no plan item required for finding 5** — the default catalog has no gap; the door
change from `VIEW_APPLICATIONS` to `VIEW_WORKFLOWS` does not strip build-kit access from any
default role.
