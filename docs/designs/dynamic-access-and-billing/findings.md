# Findings: Dynamic Access and Billing

Origin scan of branch `feat/add-access-controls-in-env-vars` (commits `c33134f45..da0548d5e`) against the `proposal.md` and `gap.md` in this folder. Code was read independently before reconciling against `tasks.md`. Findings from a subsequent PR #4330 external review (Copilot) appended as FIND-014..019 — all closed. FIND-020 added from a local migration-tree audit and resolved on user direction by rebasing this branch's migration after the meters reshape. All findings resolved. See [Open Findings](#open-findings) and [Closed Findings](#closed-findings) for current state.

## Sources

- `docs/designs/dynamic-access-and-billing/{research,gap,proposal,tasks}.md`
- `api/oss/src/utils/env.py`
- `api/ee/src/core/entitlements/{controls.py,types.py,service.py}`
- `api/ee/src/core/subscriptions/{settings.py,service.py,types.py}`
- `api/ee/src/apis/fastapi/billing/router.py`
- `api/ee/src/utils/{entitlements.py,permissions.py}`
- `api/ee/src/services/{converters.py,db_manager_ee.py,workspace_manager.py,throttling_service.py,admin_manager.py,db_manager_ee.py}`
- `api/ee/src/routers/workspace_router.py`
- `api/ee/src/models/{shared_models.py,db_models.py,api/workspace_models.py,api/api_models.py}`
- `api/ee/src/core/tracing/service.py`
- `api/ee/src/core/meters/service.py`
- `api/oss/src/core/{accounts,auth}/service.py`
- `api/oss/src/routers/workspace_router.py`
- `api/ee/databases/postgres/migrations/core/versions/{a9f3e8b7c5d1_clean_up_organizations.py,a1b2c3d4e5f7_unify_org_member_role_to_viewer.py,7990f1e12f47_create_free_plans.py}`
- `api/ee/tests/pytest/unit/{test_access_controls.py,test_controls_env_override.py,test_billing_settings.py,test_billing_router.py}`
- `web/oss/src/lib/{Types.ts,helpers/useEntitlements.ts}`, `web/ee/src/services/billing/types.d.ts`, `web/ee/src/components/SidebarBanners/state/atoms.ts`
- `docs/docs/self-host/{02-configuration.mdx,04-dynamic-access-controls.mdx,05-dynamic-billing-settings.mdx}`

## Summary

Initial scan surfaced 13 findings: one P0 (project-scope RBAC regression), four P1 (closed-enum holdouts and validation gaps), and the rest P2/P3 hygiene — all resolved on this branch. PR #4330 external review (Copilot) added six more:

- **Closed:** FIND-014 (P2, design-doc retention defaults updated to match shipped code), FIND-015 (P3, override-vs-overlay terminology tightened in MDX), FIND-016 (P1, acceptance tests fixed by renaming `member`→`viewer`), FIND-017 (P2, `assert` replaced with explicit `if/raise EventException` in trial-checkout), FIND-018 (P3, `_normalize_pricing_entry` now rejects empty `{}` with a slug-pointing error; covered by new unit test), FIND-019 (P3, `existing_type=sa.String()` threaded through both `alter_column` calls in the member→viewer migration), FIND-020 (P0, EE `core` migration tree fork resolved by chaining `a1b2c3d4e5f7` after `9d3e8f0a1b2c`).
- **Open:** (none — all findings resolved as of this sync).

EE unit suite (102 tests) green after the changes.

## Rules

- Severity uses `P0`/`P1`/`P2`/`P3` (proposal-blockers, gap-from-proposal, real-but-bounded, hygiene).
- Confidence is `high` when code lines directly confirm the behavior, `medium` when a regression is implied by code paths I traced but did not run.
- Findings tagged `Category: Correctness` are functional regressions; `Consistency` are spec-vs-implementation drift; `Migration` are operational risks at upgrade time.

## Notes

- `controls.py` and `settings.py` parse env at import time. Changing `env.access_controls.*` / `env.billing.*` after import does not re-trigger validation. Tests work around this via subprocess.
- `WorkspaceRole(str, Enum)` enables `role == "owner"`-style comparisons everywhere; that is why `_project_is_owner` still works after the refactor.
- Per `CLAUDE.md`, all new env access must funnel through `oss.src.utils.env.env`; the implementation respects that.

## Open Findings

(none)

## Closed Findings

### FIND-001 — [CLOSED] WorkspaceMember response model still uses closed `WorkspaceRole` enum

- ID: FIND-001
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: `WorkspacePermission.role_name: WorkspaceRole` and `InviteRequest.roles: List[WorkspaceRole]` (renamed from `OrganizationMembersResponse.roles` — the actual field) blocked serialization of env-defined role slugs.
- Resolution: Switched `WorkspacePermission.role_name` to `str` in both [api/ee/src/models/api/workspace_models.py](api/ee/src/models/api/workspace_models.py) and [api/ee/src/core/workspaces/types.py](api/ee/src/core/workspaces/types.py); switched `InviteRequest.roles` to `List[str]` in [api/ee/src/models/api/api_models.py](api/ee/src/models/api/api_models.py). Validation against the effective scope catalog now happens at the API boundary (see FIND-003 for the assignment validation).
- Sources: proposal.md "Refactor Imports".

### FIND-002 — [CLOSED] Project-scope defaults drop workspace-role permissions (RBAC regression)

- ID: FIND-002
- Origin: scan
- Lens: verification
- Severity: P0
- Confidence: high
- Status: fixed
- Category: Correctness
- Summary: `_default_roles()["project"]` returned minima-only (`owner`/`viewer`), but `project_members.role` is populated with workspace-role slugs (`admin`/`developer`/`editor`/`annotator`) by every project-membership writer. `_project_has_permission` resolved `get_role_permissions("project", "admin")` → `[]`, stripping non-owner project members of every permission.
- Resolution: Extended the project-scope code defaults to mirror the workspace-scope default extras ([api/ee/src/core/entitlements/controls.py:215-243](api/ee/src/core/entitlements/controls.py#L215-L243)). Tests updated: [test_access_controls.py:53-66](api/ee/tests/pytest/unit/test_access_controls.py#L53-L66) now asserts project-scope mirrors the full `WorkspaceRole` set; the env-override path replaces the default extras when the project scope is explicitly overridden.
- Sources: gap.md "Workspace roles are also too static"; proposal.md "Refactor Imports".

### FIND-003 — [CLOSED] `workspace_router.update_user_roles` still validated against `WorkspaceRole.is_valid_role`

- ID: FIND-003
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: Even after env-defined roles were returned by `GET /workspace/roles/`, the assignment path rejected anything not in the closed `WorkspaceRole` enum.
- Resolution: Replaced the enum check with `get_role("workspace", payload.role)` in [api/ee/src/routers/workspace_router.py:91-96](api/ee/src/routers/workspace_router.py#L91-L96). Removed the unused `WorkspaceRole` import from that module and from [api/ee/src/models/api/workspace_models.py](api/ee/src/models/api/workspace_models.py).
- Sources: tasks.md "Update `WorkspaceRole` runtime usage".

### FIND-004 — [CLOSED] `db_manager_ee.get_all_workspace_roles()` still returned `list(WorkspaceRole)`

- ID: FIND-004
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The DB-manager and workspace-manager wrappers were unchanged after the refactor; any direct caller (admin tooling, integration tests) still saw the closed enum.
- Resolution: Both [db_manager_ee.get_all_workspace_roles](api/ee/src/services/db_manager_ee.py) and [workspace_manager.get_all_workspace_roles](api/ee/src/services/workspace_manager.py) now return `get_roles("workspace")` directly. The local import of `controls.get_roles` inside `db_manager_ee` avoids any potential import cycle.
- Sources: tasks.md "Update role discovery APIs to return `get_roles()`".

### FIND-005 — [CLOSED] `get_free_plan()` fallback ignored effective plan set

- ID: FIND-005
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: When operators set a custom `AGENTA_ACCESS_PLANS` without `cloud_v0_hobby`, the unguarded literal fallback in `get_free_plan()` would write a non-existent plan during cancel/downgrade.
- Resolution: `_build_settings()` now raises at startup when (a) no pricing entry is marked `"free": true` AND (b) `cloud_v0_hobby` is not in the effective plan set ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)). Loud failure beats silent corruption.
- Sources: proposal.md "Acceptable fallback behavior".

### FIND-006 — [CLOSED] `get_default_plan()` did not validate against the effective plan set

- ID: FIND-006
- Origin: scan
- Lens: verification
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: `subscriptions.types.get_default_plan()` returned `env.agenta.default_plan` raw if set, skipping the proposal-mandated membership check.
- Resolution: Validation is performed once at startup inside `_build_settings()` ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)) — a non-matching `AGENTA_DEFAULT_PLAN` now fails the API boot with a clear error. Keeps `get_default_plan()` itself dependency-free.
- Sources: proposal.md "Organization Onboarding".

### FIND-007 — [CLOSED] Admin `start_plan` accepted arbitrary plan strings

- ID: FIND-007
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: The admin account-create flow no longer cast the plan through the `Plan` enum, so unknown slugs reached `start_plan` unchecked.
- Resolution: Added a `plan not in _ee_get_plans()` guard in [api/oss/src/core/accounts/service.py](api/oss/src/core/accounts/service.py) that raises `AdminValidationError` before `start_plan`. Validation lives at the admin boundary; `start_plan` still trusts validated input from internal callers.
- Sources: proposal.md "Subscription plan values read from DB or Stripe metadata must exist in the effective plan set".

### FIND-008 — [CLOSED] `AGENTA_BILLING_PRICING.stripe.meters` keys were not validated against `Counter`/`Gauge`

- ID: FIND-008
- Origin: scan
- Lens: verification
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Validation
- Summary: Typos in meter keys silently disabled Stripe reporting via `get_stripe_meter_price()`.
- Resolution: Added `_VALID_METER_KEYS` (`Counter` ∪ `Gauge`) and reject unknown keys with the allowed list in the error message ([api/ee/src/core/subscriptions/settings.py](api/ee/src/core/subscriptions/settings.py)).
- Sources: research.md "Validation Needs".

### FIND-009 — [CLOSED] `AGENTA_BILLING_CATALOG` entries passed through with no schema validation

- ID: FIND-009
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: The parser only checked `isinstance(entry, dict)`; docs advertised required fields (`title`, `description`, `type`, `features`) that weren't enforced.
- Resolution: Added a Pydantic `_CatalogEntry` model with `extra="allow"` so operators can still extend the payload, but `title`/`description`/`type`/`features` are now required and `type` must be `"standard"` or `"custom"`. Tests in [test_billing_settings.py](api/ee/tests/pytest/unit/test_billing_settings.py) and [test_controls_env_override.py](api/ee/tests/pytest/unit/test_controls_env_override.py) updated to use the full schema.
- Sources: docs/docs/self-host/05-dynamic-billing-settings.mdx.

### FIND-010 — [CLOSED] Default plan literal `cloud_v0_hobby` referenced in multiple migrations

- ID: FIND-010
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Migration
- Summary: Migrations seed `subscriptions.plan = 'cloud_v0_hobby'`; on an upgrade with a custom plan map that omits it, runtime would fail every entitlement check for those orgs.
- Resolution: Comments in both migrations ([a9f3e8b7c5d1_clean_up_organizations.py](api/ee/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py), [7990f1e12f47_create_free_plans.py](api/ee/databases/postgres/migrations/core/versions/7990f1e12f47_create_free_plans.py)) call out the operator constraint, and the FIND-005 guard in `_build_settings()` now refuses to start the API if the constraint is violated — so the failure surface moves from "silently broken org subscriptions" to "loud startup error".
- Sources: gap.md "Multi-process consistency".

### FIND-011 — [CLOSED] `_PlanOverride` rejected plans with only a `description`

- ID: FIND-011
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Consistency
- Summary: research.md described description-only plans as valid; the parser rejected them.
- Resolution: Dropped the `"must define at least one of..."` guard from `_parse_plans_override` ([api/ee/src/core/entitlements/controls.py](api/ee/src/core/entitlements/controls.py)) — display-only plans now resolve with an empty entitlement map. `fetch_usage` distinguishes "unknown plan" (None → 404) from "plan exists but enforces nothing" (`{}` → empty usage) ([api/ee/src/apis/fastapi/billing/router.py](api/ee/src/apis/fastapi/billing/router.py)). Tests in [test_access_controls.py](api/ee/tests/pytest/unit/test_access_controls.py) and [test_controls_env_override.py](api/ee/tests/pytest/unit/test_controls_env_override.py) updated.
- Sources: research.md "Recommended Override Shape".

### FIND-012 — [CLOSED] Workspace-scope `viewer` minima silently overrides any env override

- ID: FIND-012
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: wontfix
- Category: Consistency
- Summary: The minima `viewer` permission set is fixed at code-default and cannot be redefined from env.
- Resolution: Behavior is intentional and matches the documented contract ([docs/docs/self-host/04-dynamic-access-controls.mdx:168-180](docs/docs/self-host/04-dynamic-access-controls.mdx#L168-L180)). Tests assert this lock-in. Closing as wontfix — no operator demand for viewer-permission overrides yet; reopen if that changes.
- Sources: docs/docs/self-host/04-dynamic-access-controls.mdx "Platform minima".

### FIND-013 — [CLOSED] Throttling middleware no-opped on unknown plan

- ID: FIND-013
- Origin: scan
- Lens: verification
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: Misconfigured / orphaned subscriptions used to bypass throttling entirely with only a warning log.
- Resolution: `throttling_middleware` now falls back to the free-plan throttle bucket when the org's plan is unknown or carries no throttles ([api/ee/src/services/throttling_service.py](api/ee/src/services/throttling_service.py)). If the free plan also has no throttles defined (e.g. unusual self-host config), the request still goes through — but at least the safe-default path is exercised first, and the log entry now identifies the fallback explicitly.
- Sources: research.md "Failure Behavior".

### FIND-016 — [CLOSED] `OrganizationRole` `"member"` → `"viewer"` rename breaks acceptance tests

- ID: FIND-016
- Origin: PR #4330 review (Copilot, comment id 3242587323)
- Lens: external review
- Severity: P1
- Confidence: high
- Status: fixed
- Category: Correctness
- Summary: [api/ee/src/services/admin_manager.py:92](../../../api/ee/src/services/admin_manager.py#L92) renames the `OrganizationRole` literal from `"member"` to `"viewer"`. This is a breaking API change for `POST /admin/simple/accounts/organizations/memberships/`. Three acceptance tests still posted `"role": "member"` and would fail Pydantic validation: [test_memberships.py:52](../../../api/ee/tests/pytest/acceptance/accounts/test_memberships.py#L52), [test_transfer_ownership.py:65](../../../api/ee/tests/pytest/acceptance/accounts/test_transfer_ownership.py#L65), [test_transfer_ownership.py:118](../../../api/ee/tests/pytest/acceptance/accounts/test_transfer_ownership.py#L118).
- Resolution: All three call sites updated to use `"viewer"` — matching the new canonical slug. The API is internal-only (no external consumers post `"member"`) and the admin endpoint is the single boundary, so a deprecation alias was not necessary. Wider grep confirmed no other `role: "member"` references in source (the remaining occurrences in [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py) and [a9f3e8b7c5d1_clean_up_organizations.py](../../../api/ee/databases/postgres/migrations/core/versions/a9f3e8b7c5d1_clean_up_organizations.py) are the historical migration that performed the unification and must stay).
- Sources: PR #4330 Copilot review, [admin_manager.py:92](../../../api/ee/src/services/admin_manager.py#L92).

### FIND-014 — [CLOSED] `Counter.EVENTS_INGESTED` retention default mismatch between design docs and code

- ID: FIND-014
- Origin: PR #4330 review (Copilot, comment id 3242370086)
- Lens: external review
- Severity: P2
- Confidence: high
- Status: fixed (docs)
- Category: Consistency
- Summary: Three design docs ([research.md:290-292](research.md#L290), [gap.md:72-73](gap.md#L72), [proposal.md:323-326](proposal.md#L323)) and the [tasks.md:135](tasks.md#L135) checklist stated the default for `Counter.EVENTS_INGESTED.retention` was `null` / "no retention" / "events kept forever unless operators opt in". The as-shipped [DEFAULT_ENTITLEMENTS](../../../api/ee/src/core/entitlements/types.py) declares `Counter.EVENTS_INGESTED: Quota(period=Period.MONTHLY, retention=Retention.MONTHLY|QUARTERLY|YEARLY)` on Hobby/Pro/Business and `retention=None` only on Agenta/Self-hosted. Operator copy-pasting from the design docs would have configured the wrong behavior.
- Resolution: **Code is canonical** — the retention values (MONTHLY/QUARTERLY/YEARLY on the three cloud plans, None on Agenta and Self-hosted) are correct per `events_ingested` aligning with `traces_ingested` retention on each plan; only the design folder was stale. [research.md](research.md), [gap.md](gap.md), [proposal.md](proposal.md), and [tasks.md](tasks.md) updated to match the shipped enum (`Counter.EVENTS_INGESTED`), the new `Quota` shape (`period: Period.MONTHLY` replaces `monthly: True`), and the per-plan retention values. The MDX docs at [docs/docs/self-host/04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) already reflect the shipped code, so no MDX change was needed for this finding.
- Sources: PR #4330 Copilot review, [api/ee/src/core/entitlements/types.py](../../../api/ee/src/core/entitlements/types.py).

### FIND-015 — [CLOSED] Docs must make the override-vs-overlay semantic split explicit

- ID: FIND-015
- Origin: PR #4330 review (Copilot, comment id 3242370144)
- Lens: external review
- Severity: P3
- Confidence: high
- Status: fixed (docs)
- Category: Consistency
- Summary: Copilot framed this as a behavior bug, but the behavior is by design: `AGENTA_ACCESS_ROLES` and `AGENTA_ACCESS_PLANS` are **overrides** — replacing the role catalog / plan map for the named scope or plan — and `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` / `AGENTA_ACCESS_ROLES_OVERLAY` are the **overlays** that field-merge into a base. Verified by [test_override_only_specified_scope_keeps_other_defaults](../../../api/ee/tests/pytest/unit/test_access_controls.py). The MDX docs leaked some ambiguity: the `AGENTA_ACCESS_ROLES` description said env "may add" roles, which can read as merge semantics, but the override actually replaces. An operator who reached for `AGENTA_ACCESS_ROLES` to add a single role would replace the project-scope default extras (admin/developer/editor/annotator) and strip every existing project member of their permissions.
- Resolution: [04-dynamic-access-controls.mdx](../../docs/self-host/04-dynamic-access-controls.mdx) was rewritten to call out the split explicitly: (a) a `:::warning Override semantics: replace, not merge` callout at the top of the `AGENTA_ACCESS_ROLES` examples spelling out the FIND-002-redux footgun and redirecting "add one role" cases to the overlay; (b) two side-by-side H4 examples under that warning — "Override the full project-scope catalog (destructive — restate everything)" vs "Add a single role on top of the defaults (use the overlay)" — so operators see both paths concretely; (c) `:::note Scope of effect` callouts on both `_ROLES_OVERLAY` (plan-independent) and `_DEFAULT_PLAN_OVERLAY` (plan-targeted) sections, contrasting their scope. The override-vs-overlay terminology is now consistent throughout the page.
- Sources: PR #4330 Copilot review, [test_access_controls.py](../../../api/ee/tests/pytest/unit/test_access_controls.py), [controls.py](../../../api/ee/src/core/entitlements/controls.py).

### FIND-020 — [CLOSED] EE `core` migration tree forks at `e6f7a8b9c0d1`: two heads block `alembic upgrade head`

- ID: FIND-020
- Origin: sync
- Lens: verification
- Severity: P0
- Confidence: high
- Status: fixed
- Category: Migration
- Summary: After merging `feat/clean-up-meters` into this branch, the EE `core` Alembic tree had two heads — `9d3e8f0a1b2c_reshape_meters_table.py` (meters reshape) and `a1b2c3d4e5f7_unify_org_member_role_to_viewer.py` (this PR's org-role unification) — both declaring `down_revision = "e6f7a8b9c0d1"`. `alembic upgrade head` would fail with `Multiple head revisions are present`.
- Evidence (pre-fix): `find_head.py core` output `Heads: ['9d3e8f0a1b2c', 'a1b2c3d4e5f7']` with a forking branch at the `e6f7a8b9c0d1` node. EE `tracing`, OSS `core`, and OSS `tracing` were single-head and unaffected.
- Files:
  - [api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py)
  - [api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py](../../../api/ee/databases/postgres/migrations/core/versions/9d3e8f0a1b2c_reshape_meters_table.py)
- Cause: Two feature branches (`feat/clean-up-meters` and `feat/add-access-controls-in-env-vars`) each added a revision parented at the same release tip; the merge brought both files in without linearizing.
- Resolution: Per user direction ("this branch's migration(s) go after the extend-meter's migration(s)"), edited `a1b2c3d4e5f7.down_revision` from `"e6f7a8b9c0d1"` to `"9d3e8f0a1b2c"` so the org-role unification chains after the meters reshape. The org-role migration body operates on `organization_members.role` and is independent of the meters schema, so the rebase is safe. Verified by re-running `python find_head.py core` from `api/ee/databases/postgres/migrations/` — output is now `Heads: ['a1b2c3d4e5f7']` with a single linear chain.
- Sources: `find_head.py core` before/after output, [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py:25-29](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py#L25-L29).

### FIND-017 — [CLOSED] `assert` guard in trial-checkout path stripped under `-O` / `PYTHONOPTIMIZE`

- ID: FIND-017
- Origin: sync
- Lens: validation
- Severity: P2
- Confidence: high
- Status: fixed
- Category: Soundness
- Summary: A runtime correctness guard inside the trial-checkout path used `assert`. Python's `-O` / `PYTHONOPTIMIZE` strips asserts, so in an optimized deployment a mis-configured trial state could silently flow through with `None` values into `trial_period_days=None` and the Stripe metadata, instead of failing loudly.
- Evidence (pre-fix): [api/ee/src/core/subscriptions/service.py:95-98](../../../api/ee/src/core/subscriptions/service.py#L95-L98) used `assert trial_days is not None and trial_plan is not None` for type narrowing.
- Files:
  - [api/ee/src/core/subscriptions/service.py](../../../api/ee/src/core/subscriptions/service.py)
- Cause: Type-narrowing convenience: `get_trial_days()` and `get_trial_plan()` return `Optional[int]` / `Optional[str]`; the `assert` let the rest of the body treat them as non-None without explicit handling.
- Resolution: Replaced the `assert` with an explicit guard that raises `EventException` — the same domain exception already used at lines 87 and 90 of the same function. The guard now survives `python -O` / `PYTHONOPTIMIZE` and surfaces a clear domain-level error at the boundary instead of an opaque downstream Stripe failure. Comment annotated to document the rationale.

  ```python
  trial_days = get_trial_days()
  trial_plan = get_trial_plan()
  if trial_days is None or trial_plan is None:
      raise EventException(
          "Reverse trial invoked without configured trial state "
          "(trial_days and trial_plan must both be set)."
      )
  ```

- Sources: PR #4330 Copilot review (comment id 3260011657, thread `PRRT_kwDOJbjazM6C4VLH`); [subscriptions/service.py:95-105](../../../api/ee/src/core/subscriptions/service.py#L95-L105).

### FIND-018 — [CLOSED] `_normalize_pricing_entry` accepted empty `{}` per plan slug, silently 400s at checkout

- ID: FIND-018
- Origin: sync
- Lens: validation
- Severity: P3
- Confidence: high
- Status: fixed
- Category: Validation
- Summary: An empty `{}` pricing entry for any plan slug passed startup validation, occupied a slot in `_PRICING`, contributed nothing to free-plan derivation, and silently made `get_stripe_line_items(slug)` return `[]`. The failure surface was a late-stage `400 "not available for purchase"` at checkout instead of a clear startup error.
- Evidence (pre-fix): [api/ee/src/core/subscriptions/settings.py:122-179](../../../api/ee/src/core/subscriptions/settings.py#L122-L179) only restricted top-level keys to `{"free", "stripe"}` via the unknown-keys check; neither key was required.
- Files:
  - [api/ee/src/core/subscriptions/settings.py](../../../api/ee/src/core/subscriptions/settings.py)
  - [api/ee/tests/pytest/unit/test_billing_settings.py](../../../api/ee/tests/pytest/unit/test_billing_settings.py)
- Cause: The two top-level keys were treated as individually optional; there was no joint constraint requiring at least one.
- Resolution: Added a guard at the end of `_normalize_pricing_entry` that raises a slug-pointing `ValueError` if `normalized` ends up empty. Operator typos and partial copy-pastes now fail fast at startup with the offending slug named in the message.

  ```python
  if not normalized:
      raise ValueError(
          f"AGENTA_BILLING_PRICING['{slug}'] must declare at least one of "
          "'free' or 'stripe'."
      )
  ```

  Added [test_billing_settings.py::TestNormalizePricingEntry::test_empty_pricing_entry_rejected](../../../api/ee/tests/pytest/unit/test_billing_settings.py) to lock in the behavior. Full `test_billing_settings.py` suite green (33/33).
- Sources: PR #4330 Copilot review (comment id 3260011743, thread `PRRT_kwDOJbjazM6C4VMT`); [subscriptions/settings.py:174-190](../../../api/ee/src/core/subscriptions/settings.py#L174-L190).

### FIND-019 — [CLOSED] Alembic `alter_column(..., existing_type=None)` in member→viewer migration

- ID: FIND-019
- Origin: sync
- Lens: verification
- Severity: P3
- Confidence: medium
- Status: fixed
- Category: Migration
- Summary: `op.alter_column(..., existing_type=None)` was passed in both `upgrade()` and `downgrade()` of the member→viewer migration. For a server-default-only change on PostgreSQL this rendered as `ALTER COLUMN ... SET DEFAULT ...` and worked today, but relied on dialect-specific leniency and would have misrepresented the column to alembic's renderer if the underlying type were ever altered upstream.
- Files:
  - [api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py)
- Cause: Server-default-only change; the author didn't thread the column type through to `alter_column`.
- Resolution: Imported `sqlalchemy as sa` and changed `existing_type=None` to `existing_type=sa.String()` on both `alter_column` calls. No behavior change on PostgreSQL today; survives a future dialect addition or column-type change upstream without misrepresenting the column. Ruff clean after the change.
- Sources: PR #4330 Copilot review (comment id 3260011798, thread `PRRT_kwDOJbjazM6C4VM9`); [a1b2c3d4e5f7_unify_org_member_role_to_viewer.py:22, :47, :61](../../../api/ee/databases/postgres/migrations/core/versions/a1b2c3d4e5f7_unify_org_member_role_to_viewer.py).
