# Skill registry — API plan

Reviewed against code 2026-09-05 (Opus review); v2 incorporates the findings.
Follow `api/AGENTS.md` layering; new config via `env.py`; domain exceptions in
`core/skills/` (never `HTTPException` from a service).

## WP-A0 — seam decision (do FIRST, jointly for A1+A2)

The flag system is a hard-coded PARTITION, not inheritance:
`WorkflowsService.WORKFLOW_ARTIFACT_FLAG_KEYS = frozenset({is_application,
is_evaluator, is_snippet})` (`service.py:254-258`) drives
`_split_workflow_flag_values` (`:417-432`) — a key lives in exactly one bucket.
Naively adding `is_skill` to the frozenset would STRIP it from stored revision
rows (`_dump_stored_revision_flags:410-415`), breaking revision-flag containment,
negating migration `oss000000010`, and failing
`test_flag_ownership.py:288`. A second test codifies the exact invariant we are
changing (`test_flag_ownership.py:70-98`: "is_skill … never lands on the
artifact").

Two options — decide before A1 starts:

- **Option A (cheap probe): reuse `is_snippet`.** The role table already maps
  builtin skills to `is_snippet=True` (`sdks/.../running/utils.py:619`), and
  `is_snippet` IS artifact-level and SQL-filterable today. Registry query =
  artifact `{is_snippet: true}` + revision `is_skill` refinement. Rejected only if
  non-skill snippets are expected soon — confirm with Mahmoud; if snippets ≡
  skills for the foreseeable future this makes A1 nearly free.
- **Option B (clean): a duplicated-flag concept.** New
  `WORKFLOW_DUPLICATED_FLAG_KEYS = {"is_skill"}` emitted into BOTH buckets by
  `_split_workflow_flag_values`, handled in `_merge_workflow_flags` (`:483-497`)
  and `_artifact_query_flags_from_any` (`:447`). Requires rewriting
  `test_flag_ownership.py:70-98` as an intentional contract change (state why
  `is_skill` is relaxed but `is_custom`/`is_chat` are not: it is the only
  revision-derived flag that must drive artifact-level listing).

- **Option C (RECOMMENDED — see the data-model doc): don't touch the flag model.**
  Revision-flag filtering already runs in SQL (`dao.py:1445`) and `is_skill` is
  already backfilled on every revision by `oss000000010`. The only missing piece
  is a HEAD-REVISION query — `DISTINCT ON (project_id, workflow_variant_id) ...
  ORDER BY version DESC` with the flag filter in the WHERE clause — which WP-A3
  needs anyway, and which the agent-discovery tool (M3) reuses. Registry list =
  skill heads joined back to artifacts, paginated over artifacts. Zero flag-model
  changes, zero new backfill, no `test_flag_ownership` rewrite. Concession: skills
  stay invisible to the generic `/workflows/query` artifact filter — acceptable,
  the registry ships its own endpoint (A2).

Decision doc with diagrams/SQL:
<https://claude.ai/code/artifact/34ce8d81-671d-4577-bf8c-abfa880d6f31>.
**Under Option C, WP-A1 collapses to: the head-revision DAO method (+ its tests);**
the sections below marked (Option B only) apply only if C is rejected.

## WP-A1 — artifact-level `is_skill` (Option B only — skipped under C)

1. Duplicated-flag mechanism per A0.
2. **Stamping seam**: `SimpleWorkflowsService.create` (`service.py:3159-3300`) —
   the only method holding both `flags` and `data` (create → variant → commits in
   one call). `create_workflow` (`:985-1026`) receives no data (nothing to infer
   from); `commit_workflow_revision` (`:2379-2453`) never touches the artifact row
   (stamping there = extra artifact write + cache invalidation on the hottest
   path). Non-simple `create_workflow` callers must pass `is_skill` explicitly —
   document on the endpoint.
3. **Fix the query paths, not just the flag**: `SimpleWorkflowsService.query`
   DISCARDS flags before SQL (`query_data.pop("flags", None)`, `:3608-3609`) then
   re-filters in Python (`:3625-3639`); `query_workflows` has the same post-SQL
   refilter (`:1187-1192`). Forward the artifact-subset flags from
   `SimpleWorkflowQuery` into `WorkflowQuery` so `is_skill` filters in SQL; keep
   the Python refilter only for genuinely revision-only flags, and say so in code.
4. **Backfill migration** (`oss000000022_…`): materially harder than the
   `oss000000010` precedent — join artifact → variant → HEAD revision
   (`DISTINCT ON (project_id, workflow_variant_id) ... ORDER BY version DESC`,
   non-deleted) across the three composite-PK tables; set
   `workflow_artifacts.flags['is_skill']` where the head revision has it. Keep the
   provenance side-table pattern for downgrade. Note: JSONB `@>` matches only
   present keys, so the backfill is MANDATORY for `is_skill: false` filtering to
   see pre-existing artifacts — not merely tidy.
5. OpenAPI churn note: `EvaluatorArtifactFlags`/`ApplicationArtifactFlags` inherit
   `WorkflowArtifactFlags`, so the field appears in ~14 generated types — harmless
   but expected in the Fern regen diff.
6. Tests: extend/replace `test_flag_ownership.py` deliberately; SQL-filtered
   pagination correctness for `{is_skill: true}` and `{is_skill: false}`.

## WP-A2 — registry listing: dedicated endpoint on the SIMPLE seam

`POST /workflows/query` is the WRONG seam: its response (`Workflow`,
`dtos.py:214`) carries only the 3 artifact flags — no `is_static` (which is also
deliberately stripped by `_drop_default_server_owned_query_flags:313-322`), no
`data`, so no skill description. `SimpleWorkflow` (`dtos.py:477-484`) carries the
FULL flag set + `data`. Actual mount for the simple router is
**`POST /simple/workflows/query`** (`routers.py:1398-1401`; there is also a
hidden `/preview/...` twin) — not `/workflows/simple/query` as earlier docs said.

1. New handler `POST /skills/query` (skills router, WP-A5's module) calling a
   `SimpleWorkflowsService.list_registry_skills(project_id, query)`:
   - DB skills: `SimpleWorkflowQuery` + forwarded SQL flags (A1.3). Add `name`
     search to `SimpleWorkflowQuery` (`dtos.py:498-502` has only slug/flags —
     the artifact query's `name.ilike` at `dao.py:419` is unreachable from the
     simple seam today).
   - Static built-ins: returned as a SEPARATE unpaginated `builtin` block in the
     response — merging code-defined entries into keyset pagination has no correct
     cursor semantics (`StaticWorkflowCatalog.list_slugs:360` / synthetic UUIDs).
2. **Description search is cheap, not deferred**: artifacts have a first-class
   `description` column already ILIKEd at `dao.py:422-426`; populate
   `workflow_create.description` from `SkillTemplate.description` at create/import
   time (the static catalog already mirrors it, `static_catalog.py:100-108`).
3. Third consumer (M3): the `search_registry_skills` platform tool for agent-driven
   discovery wraps the same service method (register in the platform op/tool
   catalog; the op catalog already applies `add_item` on the skills list, so
   self-install needs no new write path).
4. Fern: this endpoint gets a proper request-body model — required by the FE
   (the generated client for `/workflows/query` flattens everything to query
   params and types `flags` as `string|null`, so the FE cannot send a flags
   object; see plan-web F6).

## WP-A3 — usage (reverse-embed) query

1. Endpoint `POST /skills/usage` `{workflow_id | slug}` →
   `[{agent_workflow_id, agent_name, mode: latest|pinned, pinned_version?}]`.
2. **There is no agent-enumeration seam**: `is_agent` has zero consumers in api/
   (declarations only, `dtos.py:144,181`), and revision-flag queries return every
   VERSION of every agent then refilter in Python (`service.py:2085-2091`) — the
   bound is total agent revisions, not agent count. Add a head-revision DAO
   method: `DISTINCT ON (project_id, workflow_variant_id) ... ORDER BY version
   DESC` filtered by revision flags — then walk each head's
   `data.parameters.agent.skills[]` with `find_object_embeds`
   (`embeds/utils.py:1037`; classify by deepest reference level, branch at
   `utils.py:290-345`). Cache 30s.
3. Tests: latest vs pinned classification; static-skill refs; agents with none.

## WP-A4 — SKILL.md parser (Python)

No parser or GitHub-fetch code exists in api/ (verified). BUT a TS parser exists
(`web/.../skillUpload.ts:40` `parseSkillMarkdown` + unit tests) — A5/W5 must
delegate the client to the server scan (or delete the TS path) or the two WILL
drift.

1. `api/oss/src/core/skills/parser.py`: `parse_skill_dir`, `scan_tree` (layout
   detection: marketplace.json → root SKILL.md → glob), pure + fixture-tested.
2. Mirror the SDK contract EXACTLY (`sdks/.../skills/models.py`): name kebab ≤64
   (`:18`), description 1–1024, body 1–50k, file content ≤200k, path 1–255, and
   ALL FOUR path rules (`_validate_safe_skill_file_path:21-46`): no absolute
   paths, **no backslashes anywhere**, no `..` segments, and NO root-level
   `SKILL.md` in files (case-insensitive — reserved for composed frontmatter).
   Both models are `extra="forbid"`.
3. Dependency: add `pyyaml>=6,<7` to `api/pyproject.toml` (currently only
   transitive via the SDK). `puremagic` is available for binary sniffing;
   tar/zip are stdlib.

## WP-A5 — import service + endpoints

1. Module `core/skills/{import_service.py,dtos.py,exceptions.py}`; router class
   per the workflows pattern (`add_api_route` + `operation_id`), mounted TWICE in
   `entrypoints/routers.py`: `/skills` and `/preview/skills`
   (`include_in_schema=False`), mirroring `:1385-1410`.
2. **Permissions**: every handler gates via `check_action_access` —
   `VIEW_WORKFLOWS` for scan/query, `EDIT_WORKFLOWS` for import/refresh (RBAC is
   always-on; no new permission needed).
3. **Errors**: domain exceptions in `core/skills/exceptions.py` (precedent
   `core/tools/exceptions.py`), intercepted at the router; agent-actionable
   envelope `{code, message, retryable, next_step?, details?}` for the scan/import
   failure modes (bad URL, rate limit, oversized, `name_collision`, …).
4. **Storage shape**: `data.parameters.skill = SkillTemplate.model_dump(mode="json")`
   — snake_case, as the static catalog stores it (`static_catalog.py:104-107`).
   NOT `to_wire()` (camelCase runner shape; `extra="forbid"` would fail resolution).
5. Tables `skill_sources` + `skill_source_links`: copy the mounts DBA/DBE pattern
   (`dbs/postgres/mounts/dbas.py:16-42`, `dbes.py:13-49`): composite
   `PrimaryKeyConstraint(project_id, id)` + FK to projects ON DELETE CASCADE.
   **Own alembic migration** (precedent `oss000000006_add_mounts.py`); EE runs the
   OSS chain (`ee/.../runner.py:12-35`) — no EE overlay needed.
6. Import applies per skill via `SimpleWorkflowsService.create` (one call:
   create + variant + commit v1); collisions rejected per-skill with
   `name_collision` code (surfaced by the scan preview).
7. Endpoints as before: `POST /skills/sources/scan` (URL or uploaded archive),
   `POST /skills/sources`, `POST /skills/sources/{id}/refresh`.
8. Fern regen requires a running local API (`clients/scripts/generate.sh` fetches
   `localhost/api/openapi.json`) and regenerates both language clients.

## WP-A6 — sync refresh

1. HEAD-sha + ETag check → tarball re-scan → per-link `content_hash` compare.
2. Commit: `WorkflowsService.commit_workflow_revision(project_id, user_id,
   WorkflowRevisionCommit(workflow_id, workflow_variant_id, slug, data,
   message=f"sync: {repo}@{sha}"), expected_head_revision_id=<link's last known>)`
   — the `expected_head_revision_id` 409 IS the detach race guard. Use
   `commit_workflow_revision_checked` (`service.py:2141`) so identical content
   doesn't churn versions.
3. **Detach: explicit origin marker, not author comparison.** A manual refresh
   runs as the requesting user, so author cannot distinguish sync from hand-edit,
   and `WorkflowRevisionCommit` carries no origin field. Mark sync commits with
   `meta={"skill_sync": {source_id, sha}}` (writable; note `meta` is JSON, not
   JSONB — NOT queryable, `dao.py:405-409`). The queryable state lives on
   `skill_source_links.detached` (a column): the refresh flow sets `detached=true`
   when the link's recorded head no longer matches the workflow head and the
   intervening commit lacks the `skill_sync` meta. Repo-deleted paths → link
   `missing_in_source`, never delete the workflow.
4. Trigger v1: manual endpoint + lazy FE call from the registry page. No cron.

## Non-goals

Org-scoped publication records, private-repo auth, description FTS beyond ILIKE,
wildcard auto-discovery. `/workflows/revisions/resolve`, commit, change-set
semantics untouched.
