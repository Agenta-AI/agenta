# RBAC-in-OSS — Findings

Sync metadata:

- Path: `docs/designs/rbac-in-oss`
- PR: [#4801](https://github.com/Agenta-AI/agenta/pull/4801) (`feat/move-rbac-to-oss` → `main`, OPEN)
- Sources: PR review threads (Copilot, CodeRabbit), maintainer review comment, local code re-check
- Last sync: against current local working tree (uncommitted on `main`)

## Sources

- Maintainer review (mmabrouk, COMMENTED): asked to include the docs update in this PR.
- Copilot inline review: 3 comments.
- CodeRabbit inline review: ~13 threads. All GitHub threads currently `isResolved: false`.
- Local re-check of the highest-severity code findings.

## Summary

14 distinct findings. All actionable findings fixed this session; 1 verified false positive.

- **Fixed this session:** F-ORG-PROJ-SCOPE (Critical), F-WS-UUID (Major), F-EVAL-PERMS (Major), F-HTTP-IN-CORE (Major), F-CACHE-INVALIDATION (Major), F-DOUBLE-SESSION, F-CONTROLS-HASH, F-OVERLAY-CONTRACT, F-SLUG-FULLMATCH, F-SUBPROCESS-TIMEOUT, F-MD-FENCE, F-CHECKLIST-STATUS, F-DOCS-SYNC, F-PERM-SLUG-NAME (documented as intentional alias).
- **False positive (verified):** F-ROLE-ENUM — str-enum equality makes the comparison correct.
- Permission parity verified: workflow / application / evaluator edit perms all sit in `EDITOR_PERMISSIONS`, views all in `VIEWER_PERMISSIONS`, so switching evaluator routes to evaluator perms denies no role that previously passed.
- Verification after fixes: ruff clean across `api/`; imports resolve in both editions; 1123 stack-free unit tests pass.

## Open Questions

None outstanding. All review findings are resolved or recorded as verified false positives.

## Open Findings

### [CLOSED] F-ORG-PROJ-SCOPE — invite/resend authorize a project not bound to the target org

- Origin: sync (CodeRabbit) · Lens: verification · Severity: P0 (Critical) · Confidence: medium · Status: fixed · Category: Security
- Files: `api/oss/src/routers/organization_router.py:256,350`; `api/oss/src/services/db_manager.py:119`
- Evidence: invite/resend authorize against the project resolved from `workspace_id` (`get_project_by_workspace`), but the OSS branch then acts on the default project for `organization_id`. `get_project_by_workspace` scopes only by `workspace_id`. A caller could pair an org they do not administer with a workspace they do, passing the RBAC check for the wrong org.
- Cause: the authorized project and the acted-on project are resolved independently; no check that the workspace belongs to the org.
- Suggested Fix: resolve ONE target project; validate `project.organization_id == organization_id` (404 if not); use that same project for both the permission check and the service call. Optionally add an `organization_id` filter to `get_project_by_workspace`.
- Sources: thread on db_manager.py:119 (Critical), thread on organization_router.py:270 (Major, "Also applies to: 350-364").

### [CLOSED] F-WS-UUID — get_workspace_members binds raw string to a UUID column

- Origin: sync (Copilot + CodeRabbit) · Lens: verification · Severity: P1 (Major) · Confidence: high · Status: fixed · Category: Correctness
- Files: `api/oss/src/services/db_manager.py:2340`
- Evidence: `select(WorkspaceMemberDB).where(WorkspaceMemberDB.workspace_id == workspace_id)` passes the raw string; `WorkspaceMemberDB.workspace_id` is `UUID(as_uuid=True)`. Sibling code (line 185, and `get_project_members`) casts with `uuid.UUID(...)`. Confirmed present in current local tree. Risk: binding failure or zero rows, breaking workspace membership checks on a hot RBAC path.
- Suggested Fix: `WorkspaceMemberDB.workspace_id == uuid.UUID(workspace_id)`.
- Sources: Copilot #3459021143, CodeRabbit thread on db_manager.py:2342.

### [CLOSED] F-EVAL-PERMS — evaluator routes gated with workflow permissions

- Origin: sync (CodeRabbit) · Lens: verification · Severity: P1 (Major) · Confidence: medium · Status: fixed · Category: Security
- Files: `api/oss/src/apis/fastapi/evaluators/router.py:835` (also 864-869, 899-904, 938-943, 967-972, 1003-1008, 1066-1071, 1680-1685)
- Evidence: evaluator variant/revision-log handlers gate with `EDIT_WORKFLOWS` / `VIEW_WORKFLOWS` instead of `EDIT_EVALUATORS` / `VIEW_EVALUATORS`. Can deny evaluator-only roles and allow workflow-only roles to read/mutate evaluator data.
- Note: evaluators reuse workflow persistence (`workflow_id=evaluator_id`), so this may be intentional historical behavior carried over from EE — confirm it is not a pre-existing pattern out of scope for this move.
- Suggested Fix: swap to evaluator permissions on the listed handlers, OR confirm-and-document the workflow-permission reuse as intentional.
- Sources: CodeRabbit thread on evaluators/router.py:835.

### [CLOSED] F-CACHE-INVALIDATION — RBAC decision cache can serve stale allows

- Origin: sync (CodeRabbit) · Lens: verification · Severity: P1 (Major) · Confidence: medium · Status: fixed · Category: Security
- Files: `api/oss/src/core/access/permissions/service.py` (cache key); `api/oss/src/services/db_manager.py` (`add_user_to_project`, `add_user_to_workspace_and_org`, `remove_user_from_workspace`); `api/ee/src/services/db_manager_ee.py` (`update_user_roles`)
- Evidence: cache key was project/user + permission-or-role only, TTL 5 min. A cached allow could survive user removal, role demotion, catalog change. The only prior membership-path invalidation cleared the `verify_bearer_token` namespace, not `check_action_access`; OSS membership mutations invalidated nothing.
- Resolution: (1) added `get_controls_hash()` (now permission-aware via F-CONTROLS-HASH) to the `check_action_access` cache key, so catalog/overlay changes auto-expire decisions; (2) wired `invalidate_cache(namespace="check_action_access", project_id=...)` into every membership/role mutation chokepoint in `db_manager` (covers OSS + EE: add-to-project, add-to-workspace/org accept, remove-from-workspace) and EE `update_user_roles` (role change/unassign). Revocation now takes effect immediately instead of within the 5-min TTL.
- Sources: CodeRabbit thread on service.py:229.

### [CLOSED] F-HTTP-IN-CORE — core RBAC service raises HTTPException (layering)

- Origin: sync (CodeRabbit) · Lens: validation · Severity: P1 (Major) · Confidence: high · Status: fixed · Category: Maintainability
- Files: `api/oss/src/core/access/permissions/service.py:3,26` (FORBIDDEN_EXCEPTION); imported by ~8 routers
- Evidence: core module imports `fastapi.HTTPException` and exports `FORBIDDEN_EXCEPTION`, against the "no HTTPException in core" guideline.
- Note: this code was moved verbatim from EE; the seam pre-exists the move. Decision: fix now (define a domain exception, convert at the router boundary across ~8 routers) vs. accept as a carried-over seam out of scope for a move PR.
- Sources: CodeRabbit thread on service.py:26 (cites coding guidelines).

### [CLOSED] F-DOUBLE-SESSION — get_user_org_and_workspace_id opens a second session for the user lookup

- Origin: sync (Copilot) · Lens: verification · Severity: P2 (Minor) · Confidence: high · Status: fixed · Category: Performance
- Files: `api/oss/src/services/db_manager.py:2368-2369`
- Evidence: `get_user_org_and_workspace_id` opens a session, then calls `get_user_with_id()` which opens a second session for a simple user lookup — on a hot RBAC path (every `check_action_access`). The earlier greenlet stack trace runs through exactly this chain.
- Suggested Fix: fetch the user row in the already-open session instead of delegating to `get_user_with_id`.
- Sources: Copilot #3459021216.

### [CLOSED] F-CONTROLS-HASH — controls_hash ignores permissions, only role slugs

- Origin: sync (CodeRabbit) · Severity: P2 (Minor) · Confidence: high · Status: fixed · Category: Consistency
- Files: `api/oss/src/core/access/controls.py:39`
- Evidence: hash payload uses only role slugs, so a role that keeps its slug but changes permissions produces the same hash; logs/cache keys cannot distinguish materially different catalogs. (Interacts with F-CACHE-INVALIDATION.)
- Suggested Fix: include each role's sorted permission list in the hash payload.
- Sources: CodeRabbit thread on controls.py:39.

### [CLOSED] F-OVERLAY-CONTRACT — new-role overlay validation does not match docs

- Origin: sync (CodeRabbit) · Severity: P2 (Minor) · Confidence: high · Status: fixed · Category: Correctness
- Files: `api/ee/src/core/access/permissions/role_overrides.py:281,283`
- Evidence: docstring/comment say a new overlay role requires both `description` and `permissions`, but code only rejects missing `permissions`; a new role without `description` is accepted as `description=None`. Error message hardcodes `['project']` though the loop also runs for `workspace`.
- Suggested Fix: enforce both fields (or correct the docs), and interpolate `scope_name` into the error message.
- Sources: CodeRabbit thread on role_overrides.py:293.

### [CLOSED] F-SLUG-FULLMATCH — slug regex uses match() not fullmatch()

- Origin: sync (CodeRabbit) · Severity: P2 (Minor) · Confidence: high · Status: fixed · Category: Security
- Files: `api/oss/src/apis/fastapi/tools/router.py:59,905`
- Evidence: `^[a-zA-Z0-9_-]+$` with `re.match()` accepts a trailing newline (`"valid\n"` passes). Pre-existing on `origin/main`; only line-shifted by this PR's un-gate.
- Resolution: regex changed to `r"[a-zA-Z0-9_-]+"` and the call to `.fullmatch(segment)`, which anchors the whole string and rejects trailing newlines.
- Sources: CodeRabbit thread on tools/router.py:61.

### [CLOSED] F-PERM-SLUG-NAME — EDIT_APPLICATIONS_VARIANT maps to "delete_application_variant"

- Origin: sync (CodeRabbit) · Severity: P2 (Minor) · Confidence: high · Status: fixed · Category: Consistency
- Files: `api/oss/src/core/access/permissions/types.py:67,73`
- Evidence: enum member `EDIT_APPLICATIONS_VARIANT = "delete_application_variant"` (edit-named, delete-valued), included in EDITOR_PERMISSIONS; `EDIT_APPLICATIONS = "edit_application"` (plural/singular mismatch).
- Note: slugs migrated verbatim from EE and likely match persisted role/permission data — renaming the slug is a data-compat risk. Likely wontfix / back-compat alias; confirm intentional.
- Suggested Fix: confirm the name↔slug pairing is an intentional alias and leave the slug as-is, or rename the member only (not the slug value).
- Sources: CodeRabbit thread on types.py:73.

### [CLOSED] F-SUBPROCESS-TIMEOUT — OSS role-controls test subprocess has no timeout

- Origin: sync (CodeRabbit) · Severity: P3 (Minor) · Confidence: high · Status: fixed · Category: Testing
- Files: `api/oss/tests/pytest/unit/access/test_role_controls_oss.py:31`
- Evidence: `subprocess.run(...)` without `timeout=` can hang CI on an import/runtime stall.
- Suggested Fix: add `timeout=15` (or similar) to the `subprocess.run` call.
- Sources: CodeRabbit thread on test_role_controls_oss.py:31.

### [CLOSED] F-MD-FENCE — unlabeled markdown code fences in design docs

- Origin: sync (CodeRabbit, markdownlint MD040) · Severity: P3 (Minor) · Confidence: high · Status: fixed · Category: Maintainability
- Files: `docs/designs/rbac-in-oss/plan.md:95`, `docs/designs/rbac-in-oss/proposal.md:27`, `docs/designs/rbac-in-oss/research.md:119`
- Evidence: dependency-graph / architecture / call-site fenced blocks have no language tag.
- Suggested Fix: add a `text` language tag to each fence.
- Sources: CodeRabbit threads on plan.md:99, proposal.md:42, research.md:149.

### [CLOSED] F-CHECKLIST-STATUS — checklist says COMPLETE with unchecked items

- Origin: sync (CodeRabbit) + user · Severity: P3 (Minor) · Confidence: high · Status: fixed · Category: Maintainability
- Files: `docs/designs/rbac-in-oss/checklist.md:1-3,8-20,73-77`
- Evidence: header reads "Status: COMPLETE" while move/shim/WP1 task boxes remain `[ ]`. Ambiguous completion state.
- Suggested Fix: tick the completed boxes, or reword the header as an archival ledger.
- Sources: CodeRabbit thread on checklist.md:27.

## Closed Findings

### [CLOSED] F-DOCS-SYNC — user-facing docs still called RBAC plan-gated — fixed

- Origin: user (mmabrouk) + scan · Severity: P2 · Status: fixed · Category: Documentation
- Files: `docs/docs/administration/access-control/03-rbac.mdx:11`; `docs/docs/administration/access-control/01-organizations.mdx:26,53`; `docs/blog/entries/open-sourcing-agenta.mdx:13,39`
- Resolution: updated this session. RBAC availability callout now "every edition incl. OSS"; organizations doc no longer lists RBAC as plan-gated and drops the conditional invite-role wording; blog post removes RBAC from the commercial-license list (SSO + audit logs retained). Config/env docs (`02-configuration.mdx`, `04-dynamic-access-controls.mdx`) and `env.py` AccessConfig were already correct (custom roles = EE).
- Sources: maintainer review comment; doc scan.

### [CLOSED] F-ROLE-ENUM — role comparison enum-vs-string "always false" — false positive

- Origin: sync (Copilot) · Severity: was P1 claim · Status: stale (false positive) · Confidence: high · Category: Correctness
- Files: `api/oss/src/core/access/permissions/service.py:74` (`_project_has_role`)
- Evidence: Copilot claimed `role == role_to_check` is always False because the DB role is `str` and `role_to_check` is `RequiredRole`. Verified locally: `RequiredRole(str, Enum)`, and `"admin" == RequiredRole.ADMIN` returns `True` (both directions). Role checks work correctly.
- Resolution: no change. Recorded as a verified false positive; the GitHub thread can be replied-to and resolved with this evidence.
- Sources: Copilot #3459021193.
