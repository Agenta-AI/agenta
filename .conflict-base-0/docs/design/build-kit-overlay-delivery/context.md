# Context

## What the build kit is

Every agent config in the playground carries a read-only **build kit** overlay, rendered
as a "Playground build kit" accordion at the top of the Advanced section. It advertises
the tools, skills, and elevated sandbox permissions the platform injects into the agent's
runtime **while the user is building the agent in the playground** — so the assistant can
create files, run code, inspect the platform, and edit the agent's own config. The
current overlay contains:

- 16 tools: 13 platform ops + read/bash builtins + `request_connection`
- the build-an-agent skill
- sandbox permission elevations (e.g. reads/writes the assistant needs)

None of this is part of the *published* agent. The backend strips agent metadata on
commit, so the overlay is a **playground-only, never-persisted** augmentation. It exists
to make the in-playground building experience work; it must not leak into the committed
revision's parameters.

## The bug

Mahmoud reports the build kit is **missing** on agents created through the new
template-builder / playground-native onboarding flow — and, critically, **it stays
missing after the agent is committed**. That post-commit datum is what makes this more
than the already-understood "ephemeral draft has no server row yet" gap: it says the
delivery mechanism fails even once a real, committed, server-backed agent exists.

The classic path (create an app, land on its playground) shows the overlay correctly.

## Why the current delivery is the root of the bug class

`build_agent_template_overlay()` (`api/oss/src/apis/fastapi/applications/overlay.py`)
takes **no arguments**. The overlay is a pure function of the platform catalog — the same
16 tools for every agent, in every project (modulo future per-plan gating). Yet it is
delivered by **attaching it to one specific application-fetch response** and resolved on
the frontend by walking from the open revision up to its application and fetching that
application. That coupling:

- breaks for ephemeral drafts, which have no application/workflow id yet;
- is identity- and timing-fragile for the onboarding in-place swap (the drill-in entity
  id, the primed revision cache, and the app query all have to line up);
- makes a global, static resource behave as if it were per-application data.

The correct model is: fetch the catalog-static overlay **once per project**, and apply it
**client-side by entity type**. See [research.md](./research.md) for the evidence.

## The gate: flags-default-on

This project **must land before** the new-experience-default-on re-flip. The requirement
(Mahmoud) is: the new agent onboarding ships **default-on with zero env configuration**.
The parked default-flip work is on the **PR #5121** lane. Shipping the new onboarding by
default while the build kit — the visible signal that the playground gives the assistant
building powers — is absent on freshly created agents would ship a visibly broken core
affordance. So: fix delivery first, then flip the default.

## Constraints that must hold

These are fixed requirements for any design in this workspace:

1. **Server-sourced.** The catalog stays the single source of truth. Tool/skill embeds
   are resolved server-side. The frontend never hard-codes the overlay. This also keeps
   the door open for **future per-plan gating** (an EE entitlement could shape the overlay
   per subscription).
2. **Agent-template-type-scoped.** The overlay applies only to agent-typed entities. The
   frontend decides applicability by entity **type** (`flags.is_agent`), not by any id.
3. **Never persisted.** The overlay is playground-only and stripped on commit. This
   behavior is unchanged — commit already reads only the user-owned revision config
   (`prepareCommitParameters` in `web/packages/agenta-entities/src/workflow/state/commit.ts`
   strips agenta metadata), so the overlay never enters committed parameters. Do not
   regress this. This now also covers the reserved workflow itself: `__ag__build_kit` is
   retrievable by slug but must be **rejected** if referenced by `@ag.embed` from another
   config's commit (the embeddability policy, codex review — see the delivery-door section
   above and [plan.md](./plan.md)).
4. **Cover every creation path** with no regression: ephemeral pre-commit, onboarding
   post-commit, classic template flow, and SDK-created apps.

## Coverage matrix (what "done" means)

| Creation path | Entity in playground | Must show build kit |
|---|---|---|
| Ephemeral draft (onboarding, pre-commit) | `local-*` (no workflow_id), `is_agent: true` | Yes |
| Onboarding-committed agent | real revision id, `is_agent: true` (inferred at commit) | Yes |
| Classic template app | real revision id, `is_agent: true` | Yes (no regression) |
| SDK-created agent app | real revision id, `is_agent: true` | Yes |
| Non-agent entity (prompt, evaluator, chat) | any | No (unchanged) |

## Delivery door — DECISION: Option F (reserved static workflow)

**Decision (Mahmoud, 2026-07-07): Option F.** The build kit becomes a **reserved static
workflow `__ag__build_kit`** in the existing `StaticWorkflowCatalog`
(`api/oss/src/core/workflows/static_catalog.py`), joining the three constants already
there (`__ag__getting_started_with_agenta`, `__ag__request_connection`,
`__ag__build_an_agent`). The frontend resolves it **by slug** through the existing workflow
retrieve path that already serves those other `__ag__*` slugs, fetches it **once per
project/session**, and merges it as the overlay onto any agent-typed entity
(`flags.is_agent`). Options A and B (below) are superseded; C/D/E stay rejected.

### Mahmoud's two refinements (the load-bearing part of F)

1. **The build kit is just an agent configuration.** The static workflow's revision data
   carries `parameters.agent` populated with the kit fields — `tools` (the read/bash
   forced builtins + the 13 platform ops + the `request_connection` embed), `skills` (the
   build-an-agent embed), and `sandbox` (the permission elevations). That is the **same
   shape any agent config already has** (`parameters.agent` is a partial/full
   `AgentTemplate`; the FE already merges this exact shape — see
   [research.md](./research.md) §Merge). There is **no new schema flavor, no
   `parameters.overlay`, no new selector kind**. "Overlay" is only how the playground *uses*
   this config (merge it into runs, strip it on commit), not a new type on the wire.
2. **Nothing relocates *in the domain sense*.** The catalog entry is added where the catalog
   already lives — `api/oss/src/core/workflows/static_catalog.py`, the **core** layer (this
   file previously mislabeled that as "API layer"; corrected by the codex review below). The
   platform-ops content itself is not rewritten or re-scoped to a new domain, and no SDK
   migration is needed.

   **Layering refinement (codex xhigh design review, 2026-07-07):** core code must never
   import the API layer (`api/AGENTS.md` layering rule). `static_catalog.py` (core) cannot
   therefore call `build_agent_template_overlay()` in
   `apis/fastapi/applications/overlay.py` (API layer) the way the original plan assumed. The
   content builder — the `DEFAULT_BUILD_KIT_OPS` list, the tool/skill/sandbox assembly, and
   `_reserved_static_tool_embeds()` — **moves into `core/workflows`** (a new `build_kit`
   module next to `static_catalog.py`, or folded into `static_catalog.py` itself).
   `overlay.py` becomes a **thin back-compat adapter** that calls the relocated core
   builder; the SDK-constant imports (`AGENTA_FORCED_TOOLS`, `BUILD_AN_AGENT_SLUG`,
   `REQUEST_CONNECTION_WORKFLOW_SLUG`) move their import site to the new core module
   accordingly. This still matches Mahmoud's intent — "wherever the static catalog is, we
   would add this" — the content lives next to the catalog; the refinement is that "next to
   the catalog" is a core-layer location, so the builder has to live there too, not that the
   content changes ownership or domain. Full detail:
   [plan.md](./plan.md#phase-be-1--add-__ag__build_kit-to-the-static-catalog-api).

   **Embeddability policy (codex review, new constraint):** because `__ag__build_kit` is a
   real catalog workflow addressable by slug, it must be **retrievable but not
   embeddable/committable** — the embed resolver and/or commit path must reject any
   `@ag.embed` reference to it, so no API caller can persist a reference that drags
   playground-only tools into a published agent. See the embeddability policy and its test
   in [plan.md](./plan.md#phase-be-1--add-__ag__build_kit-to-the-static-catalog-api).

   **Rider compatibility window (codex review):** BE-2 (removing
   `additional_context.playground_build_kit` from `fetch_simple_application`) is **deferred
   to a follow-up release**, not shipped in this PR. This PR keeps the rider live
   server-side; the FE goes **slug-first** (retrieve `__ag__build_kit` by slug) with the
   existing per-app `additional_context` chain retained as a **fallback** for deploy skew —
   an old API server paired with a new FE, or a cached old FE bundle paired with a new API.
   See [plan.md](./plan.md#phase-fe-1--slug-retrieve--entity-type-gate-frontend) and
   [plan.md](./plan.md#phase-be-2--retire-the-per-application-rider-api--deferred-to-a-follow-up-release).

### Why F beats the earlier doors

| Door | One-line reason F wins |
|---|---|
| **A — dedicated `GET /simple/applications/build-kit`** (built in BE-1, now discarded) | New route, new `operation_id`, new response model, new Fern surface for content that already has a home in the catalog. F adds **no endpoint and no id**. |
| **B — rider field on `fetch_application_catalog_template`** (previously recommended) | Still a bespoke `agent_template_overlay` field grafted onto an unrelated response, and no FE caller of that route exists today. F puts the kit in the **same `__ag__*` namespace and one mental model** as the other three static constants, reached by the retrieve path the FE already uses. |

F also leaves **embed-ability open as a future product choice**: because the kit is a real
catalog workflow addressable by slug/id, it can later be embedded by reference from other
configs the same way `__ag__build_an_agent` and `__ag__request_connection` already are — a
door A/B rider on an inspect response could never offer. (For now, per the embeddability
policy above, it must actively be **rejected** as an embed target — "open as a future
choice" is a deliberate later decision, not the current default.)

### Naming considered (codex xhigh design review, 2026-07-07)

Codex suggested `__ag__playground_build_kit` for lifecycle clarity — the slug would signal
"playground-only" the way `__ag__build_an_agent` signals its purpose. **Decision: stays
`__ag__build_kit`** (Mahmoud's name). The playground-only lifecycle (never persisted, never
embeddable) is documented at the catalog entry itself — its `description` field and a code
comment in the core `build_kit` module/`static_catalog.py` — not encoded into the slug.

### The three earlier options, kept for the record

**Option A — dedicated route (implemented in BE-1, now DISCARDED).**
`GET /simple/applications/build-kit` (`SimpleApplicationsRouter`, registered
`api/oss/src/apis/fastapi/applications/router.py:1801-1809`, handler
`router.py:1896-1932`, `operation_id="fetch_simple_application_build_kit"`, response model
`SimpleApplicationBuildKitResponse` — `api/oss/src/apis/fastapi/applications/models.py:665-680`).
Superseded by F: a whole new route/model/Fern surface for one catalog-static object. The
parked BE code for it is **discarded** (see [status.md](./status.md)).

**Option B — rider on `fetch_application_catalog_template` (Mahmoud's earlier suggestion).**
`GET /applications/catalog/templates/{template_key}` (registered `router.py:140-148`,
handler `router.py:470-495`, response model `ApplicationCatalogTemplateResponse` —
`models.py:797-804`). Superseded by F: it still adds a bespoke overlay field to a template
response, and no FE surface calls that fetch-by-key route today, so "the creation surfaces
already call it" was never literally true. F needs no rider field at all.

**Option C — the agent service `/inspect` channel.** Rejected (unchanged). The kit resolves
`@ag.embed` references against the API-layer `StaticWorkflowCatalog`; serving it from the
agent service would cross domain ownership.

**Option D — FE hardcode.** Rejected (unchanged). Drift: the backend can add a platform op
or skill and the FE would show a stale kit until a frontend deploy. The kit must stay
server-sourced — and under F the catalog *is* that single server source.

**Option E — persist into configs.** Rejected (unchanged). The overlay is playground-only
and stripped on commit; it must not enter committed `data.parameters`. F preserves this:
the catalog workflow is merged into runs client-side and never written to the user's
revision.

**Provisional parked work now resolved:** the BE-1 Option-A route/handler/model is
**discarded**. The FE-1 half (project-scoped atom + `is_agent` gate) **transfers** — only
its fetch swaps from the app-fetch chain to the slug-based retrieve of `__ag__build_kit`.
See [plan.md](./plan.md) and [status.md](./status.md).

## Glossary

- **Build kit**: under Option F, the reserved static workflow `__ag__build_kit` whose
  revision `data.parameters.agent` carries the platform tools, authoring skills, and
  sandbox elevation. It is a plain agent config, not a new type.
- **Overlay**: how the playground *uses* the build kit — merge its `parameters.agent` into
  the per-run copy (client-side), render it read-only in the Advanced section, strip it on
  commit. The FE object handed to the merger is still shaped `{tools, skills, sandbox}`.
- **Reserved / static workflow**: a code-defined workflow served from
  `StaticWorkflowCatalog` under the `__ag__*` slug namespace, never from Postgres. A user
  cannot author or shadow one.
- **Ephemeral / `local-*` entity**: a client-only draft minted from a catalog template
  before any server write (`createEphemeralAppFromTemplate`).
- **The old atom chain (removed by this design)**: the current 3-hop frontend resolution
  `workflowAgentTemplateOverlayAtomFamily(revisionId)` →
  `workflowQueryAtomFamily(revisionId).data.workflow_id` →
  `simpleApplicationQueryAtomFamily(applicationId)` → `additional_context`. Option F
  replaces it with a single project-scoped slug retrieve of `__ag__build_kit`, gated by the
  target entity's `flags.is_agent`.
- **Onboarding in-place swap**: after commit, onboarding does `setEntityIds([revisionId])`
  + `history.replaceState` instead of a full page navigation, so the playground never
  remounts (`useAgentOnboarding.ts`).
</content>
