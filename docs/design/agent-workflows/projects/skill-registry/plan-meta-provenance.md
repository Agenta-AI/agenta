# Meta-first provenance (Package 2)

Decision record + execution plan for moving skill import provenance off the
`skill_sources` / `skill_source_links` tables and onto workflow metadata, per
Mahmoud's backend-interface review and the 2026-09-07 discussion with Arda.
Full trade-off analysis: the "Where should skill provenance live?" decision
review (tables vs meta, feature-by-feature, reversibility asymmetry).

## Decisions (2026-09-07, with Arda)

1. **Meta-first storage.** Pull migration `oss000000027`; no skill-specific
   tables in v1. Origin lives on the workflow artifact, immutable provenance on
   each imported/applied revision. Reversibility drove this: meta→tables later
   is an additive backfill from immutable provenance; tables→meta later is a
   destructive down-migration.
2. **Backend-owned `_ag` namespace, enforced at the git DAO** (revised
   2026-09-07, per Mahmoud's requirement): every meta write in the git layer
   passes `guard_platform_meta` (`core/git/platform_meta.py`) — EDITS preserve
   the stored `_ag` (it can be neither replaced nor removed by clients),
   CREATES/COMMITS strip an incoming `_ag` (no forged provenance, and a
   local-edit commit never inherits it — derived detachment depends on that
   absence). Trusted platform writes (skills import/apply) pass
   `platform_meta=True` through the service layer. Because legacy routes
   construct the same DAO, the rule holds platform-wide for workflow writes.
3. **Canonical origin shape: nested.** Identity fields are written at import
   and change only when the user re-points; the checkpoint rewrites on every
   successful import/apply:

   ```json
   {
     "meta": {
       "_ag": {
         "origin": {
           "kind": "catalog",
           "provider": "github",
           "identifier": "obra/superpowers/skills/brainstorming",
           "locator": {"repository": "obra/superpowers", "ref": null, "path": "skills/brainstorming"},
           "last_imported": {
             "resolved_version": "<commit sha>",
             "content_hash": "<skill_content_hash>",
             "url": "https://github.com/..."
           }
         }
       }
     }
   }
   ```

   Revision provenance is FLAT (one immutable event):

   ```json
   {"meta": {"_ag": {"provenance": {"operation": "import|update",
     "provider": "github", "identifier": "...",
     "resolved_version": "<sha>", "content_hash": "<hash>", "url": "..."}}}}
   ```

4. **Local-edit rule: absence-as-signal, hash as ground truth.** Only
   import/apply stamp revision provenance; local edits stamp nothing.
   Detachment is derived purely from content:
   `skill_content_hash(head.parameters.skill) != origin.last_imported.content_hash`.
   Provenance stamps are history/display, never the detachment authority — an
   uncooperative writer produces an unstamped revision with a changed hash and
   correctly reads as detached.
5. **Sync toggle removed for v1.** Every refresh is check-then-Apply (the
   two-phase flow that shipped); `sync_enabled` only skipped the Apply click
   and has no home without a source row. The agent ops (`check_skill_updates`
   read-only / `apply_skill_update` approval-gated) are unchanged in behavior.
6. **No per-source stored state.** "Sources" stop being a resource: the
   registry's per-repo sections become client-side grouping by
   `origin.locator.repository`; "synced Nh ago" derives from the group's
   `last_imported` values. `missing_in_source` becomes an update-check result,
   not a persisted flag.
7. **Endpoint shape is facade-shaped from the start.** The endpoints this
   package must rewrite anyway adopt the facade's final shape now, so refresh
   is not rebuilt twice:
   - `POST /skills/sources/scan` stays (read-only preview; unchanged).
   - Import stays `POST /skills/sources` (creates workflows + stamps meta).
   - `POST /skills/{skill_id}/updates/check` (read-only) and
     `POST /skills/{skill_id}/updates/apply` (write, optimistic concurrency via
     base revision) REPLACE `POST /skills/sources/{id}/refresh`.
   - `GET /skills/sources` is derived (distinct origins from artifact meta) or
     dropped in favor of client grouping — decide in W-P2.3.
   The remaining facade routes (create/commit/archive/restore/revisions via
   `/skills`, `referenced-by` replacing `usage`) land in the follow-up facade
   stack, NOT here.

## Stack

- `feat/skills-meta-provenance-api` (base: `feat/skill-registry`): this plan,
  migration removal, meta stamping, check/apply endpoints, protection in
  skills-owned paths, tests, Fern regen.
- `feat/skills-meta-provenance-web` (base: the api branch): FE moves off
  sources atoms/endpoints, client-side grouping, per-skill check/apply UI,
  drop the "Keep in sync" switch, scan markers read the meta-backed response.
- Facade stack (2 PRs, api + web) follows on top.

## Work packages (API)

- **P2-A1** Remove `oss000000027`, the skills DBEs/DAO/mappings, and their
  wiring. Repair the migration chain (the migration has not shipped in a
  release; remove, don't compensate).
- **P2-A2** Meta writer: import stamps artifact `origin` + revision
  `provenance`; update-apply rewrites `origin.last_imported` and stamps the
  new revision. One shared helper owns the `_ag` merge (deep-merge, never
  replace) and is the ONLY way skills code writes meta.
- **P2-A3** Derived reads: registry listing gains origin attribution from
  artifact meta (replacing the link/source join); `already_imported_paths` in
  scan comes from an artifact-meta scan; detachment derives per decision 4.
- **P2-A4** `updates/check` + `updates/apply` per skill (apply commits with
  the head as base revision → 409 on race), replacing `refresh`.
- **P2-A5** Tests: import idempotency via meta (incl. the read-then-write race
  documented as accepted), detachment derivation incl. unstamped local edits,
  `_ag` merge protection in skills paths, check/apply modes, backfill-shaped
  provenance completeness (every stamp carries repo+path+sha+hash).
- **P2-A6** OpenAPI + Fern regen.

## Accepted v1 weaknesses (explicit)

- Duplicate-on-race at import (read-then-write, no DB constraint): low
  frequency, cleanup = archive one copy.
- Shared per-repo facts are N copies that can disagree after a partial
  refresh; the UI derives group state and shows per-skill truth.

## Later triggers for reintroducing a table

Credentials for private repos, scheduled sync, webhooks, org-level catalog
administration — at that point a general catalog-connection resource is added
and backfilled from revision provenance (additive migration).
