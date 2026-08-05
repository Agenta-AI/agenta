# Status

**State:** IMPLEMENTED — awaiting Mahmoud's PR review. Codex-xhigh implemented both slices per
this plan (Mahmoud authorized implementation with the codex design review as the gate); the
orchestrator adversarially reviewed both diffs. Verified: 1250 api unit tests green (7 new
build-kit tests incl. the self-embed and embed-rejection pins), entities package green (11 new
FE tests), live API (slug retrieve returns the full kit; committing an embed of
`__ag__build_kit` returns the typed 400), and browser QA (fresh AND committed agents render the
kit in Advanced; the network log shows the `__ag__build_kit` retrieve, proving the new path
fired). The legacy rider stays one release as fallback (BE-2 deferred as planned). The
template-builder default-on flip rides a stacked PR on top.
**Date:** 2026-07-07

## Decision

**Option F (Mahmoud, 2026-07-07):** the build kit becomes the reserved static workflow
`__ag__build_kit` in `StaticWorkflowCatalog`, resolved by slug through the existing
`POST /workflows/revisions/retrieve` path, fetched once per project, merged onto any
agent-typed entity. It is a **plain agent config** (`parameters.agent`), and **nothing
relocates**. Full rationale and the superseded A/B analysis:
[context.md](./context.md#delivery-door--decision-option-f-reserved-static-workflow).

## Fate of the parked lane

The built BE-1(Option A) + FE-1 work lives on the UNAPPLIED, unpushed lane
`feat/build-kit-overlay-impl-draft` (commit 7da032b). Under Option F:

- **BE route DISCARDED.** The dedicated `GET /simple/applications/build-kit` route
  (registration `router.py:1801-1809`, handler `router.py:1896-1932`,
  `SimpleApplicationBuildKitResponse` model `models.py:665-680`) and its unit tests are
  **dropped**, not carried forward. Option F adds no route.
- **FE half ADAPTED.** The project-scoped `agentBuildKitOverlayAtom`, the rewritten
  `workflowAgentTemplateOverlayAtomFamily` entity-type gate, and the removal of the
  `simpleApplicationQueryAtomFamily` / `fetchSimpleApplication` chain all **transfer**. The
  only change: the fetch swaps from the discarded Option-A route to
  `retrieveWorkflowRevision({workflowRef: {slug: "__ag__build_kit"}})`, reading the overlay
  from `revision.data.parameters.agent` (unresolved — the FE renders embeds as reference
  rows; see [research.md](./research.md) verify item 1).
- The FE-1 pass also incidentally fixed a pre-existing `types:check` break at `HEAD`
  (`api.ts` called `getAgentaSdkClient` without importing it, from merge `9cb1586329`);
  removing the dead `fetchSimpleApplication` removes that broken call site, so the fix rides
  along with the FE-1 rewrite.

Re-apply the parked lane to salvage the FE atom with
`but apply feat/build-kit-overlay-impl-draft`.

## Process note

This design went to implementation (Option A) before Mahmoud reviewed the delivery door. He
flagged that; the door was re-opened and, after the A→B discussion, settled on **Option F**
(a reserved static workflow — neither a new route nor a rider field). Going forward: **the
updated draft PR #5124 goes to Mahmoud before implementation resumes.**

## Review rounds

**Codex xhigh design review — round complete (2026-07-07).** Verdict: **right seam** (Option
F confirmed) with **six changes folded** into plan.md/context.md/research.md:

1. Layering — content builder moves to `core/workflows`; `overlay.py` becomes a thin
   back-compat adapter.
2. Explicit entry metadata — positive allowlist replaces the "non-skill means tool"
   inference in `_reserved_static_tool_embeds()`.
3. Embeddability policy — `__ag__build_kit` retrievable but not embeddable/committable;
   new plan item + test.
4. Rider compatibility window — BE-2 deferred to a follow-up release; FE goes slug-first
   with the per-app chain kept as a skew fallback.
5. RBAC — verified in code, no default-role gap (see
   [research.md](./research.md#rbac-verification-finding-5--no-role-gap)).
6. Tests — positive-pin tool embeds, add a self-embed-guard test and a slug-retrieve
   content-equivalence test; update the enumeration-style assertion that would otherwise
   bless the self-embed bug.

Naming was also revisited: codex suggested `__ag__playground_build_kit` for lifecycle
clarity; **decision stays `__ag__build_kit`** (Mahmoud's name), with the playground-only
lifecycle documented at the catalog entry instead of encoded in the slug. See
[context.md](./context.md#naming-considered-codex-xhigh-design-review-2026-07-07).

**Next step:** codex-xhigh implementation of the revised plan, then the orchestrator's
adversarial review, live QA, and PRs.

## Root-cause verdict

The build-kit gap is a **frontend delivery-coupling bug, not a server bug**, and the
prior "onboarding creates a bare workflow with no application row" theory is **disproven
live**.

- Both creation paths (classic and onboarding) build the agent through `POST /workflows/`;
  the resulting artifact/variant/revision trio is identical.
- LIVE on `:8280`: an onboarding-style agent resolves as a full simple application, and
  `GET /simple/applications/{workflow_id}` returns the identical 16-tool overlay the
  classic path returns. The committed revision reports its `workflow_id` correctly and
  carries `is_agent: true` (inferred server-side at commit).
- The overlay is **catalog-static** — `build_agent_template_overlay()` takes no app
  argument — yet it is delivered by attaching to one app-fetch response and resolved on the
  FE through a 3-hop chain (`revisionId → workflow_id → applicationId → app fetch`). That
  chain short-circuits for ephemeral drafts (no `workflow_id`) and is identity/timing-
  fragile through the onboarding in-place swap. That coupling is the root of the bug class.

**Chosen fix (Option F):** serve the build kit as the reserved static workflow
`__ag__build_kit`, resolve it by slug through the existing workflow retrieve path, fetch it
once per project/session, and merge it client-side onto any agent-typed entity; retire the
per-application attachment. Full evidence in [research.md](./research.md).

## What contradicts the prior findings

- Prior diagnosis predicted a post-commit 404 / missing application row. **False** — the
  app resolves and returns the overlay for onboarding-created agents (live-verified). Do
  not build the fix around "create an application row on the commit path."
- The prior "classic flow creates via `POST /simple/applications/`" framing is only
  partly right: the classic *template* create (`createAppFromTemplate`) also uses
  `POST /workflows/`. `POST /simple/applications/` is a separate entry that also works, but
  it is not what distinguishes the working path from the broken one. What actually differs
  is **full-navigation remount (classic) vs in-place swap (onboarding)**, plus the
  ephemeral having no `workflow_id`.

## What needs Mahmoud's confirmation

The door is decided (F). Remaining confirmations for the draft PR #5124:

1. **Retire the per-app rider (now deferred to a follow-up release — codex review).** BE-2
   still plans to retire `additional_context.playground_build_kit` on
   `fetch_simple_application`, but not in this PR — this PR keeps the rider live as the FE's
   skew-window fallback (finding 4). Confirm nothing external (SDK, another surface) is
   expected to keep reading it, ahead of the eventual BE-2 follow-up.
2. **Per-plan gating.** Because `__ag__build_kit` resolves per project, a future EE
   entitlement could shape/deny the kit at retrieve time (a local change in the catalog
   resolve path). Confirm this is a wanted future extension (design leaves the seam; no
   gating now).

Not blockers, but noted:
- The **content builder needs guards** — self-reference (now an explicit allowlist per
  codex review, not just an exclusion), import-time bootstrap ordering, and (new) an
  embeddability/commit-rejection guard — so the build kit doesn't embed itself, doesn't read
  a half-built catalog, and can't be embedded into a published agent. See plan.md Phase BE-1
  and research.md §10. The builder also now needs to live in `core/workflows` for layering
  (finding 1) rather than `apis/fastapi/applications/overlay.py`.
- We did not pin the single exact failing hop of the old post-commit chain in a headed
  browser session — Option F removes the whole chain, so the distinction is moot.

## Next steps

1. **Mahmoud's review** of this design (context.md, this file, plan.md, research.md) as
   draft PR #5124 — specifically the Option-F decision and the two confirmations above.
2. **BE-1:** add `__ag__build_kit` to `StaticWorkflowCatalog` (with `build_agent_template_
   overlay()` as the single builder + the two guards), and drop the discarded Option-A
   route/handler/model/tests.
3. **FE-1:** repoint the parked atom's fetch to `retrieveWorkflowRevision({slug:
   "__ag__build_kit"})`; adapt tests.
4. **Five-path live QA** (plan.md Phase QA), run against the slug-backed retrieve.
5. **BE-2 (deferred to a follow-up release):** retire the per-app rider once the slug-first
   path has shipped long enough that deploy skew is no longer a concern (codex review,
   finding 4).
6. **Build-kit PR:** commit BE-1 + FE-1 + TEST together once QA is green. BE-2 ships in a
   separate follow-up-release PR (deferred, finding 4).
7. **Unblock the PR #5121 lane** (flags-default-on re-flip) once the build-kit PR merges —
   see [Gate](#gate).

## Gate

This project **gates the flags-default-on re-flip** (new experience default-on with zero
env; parked on the **PR #5121** lane). Land this first.

## Artifacts / cleanup

- Live probes run under ephemeral admin-minted accounts; all created workflows archived
  (`POST /workflows/{id}/archive`). No persistent test entities left behind.
- Probe scripts kept only in the session scratchpad (not committed).
</content>
