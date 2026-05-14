# Findings: Dynamic Access and Billing

Origin scan of branch `feat/add-access-controls-in-env-vars` (commits `c33134f45..da0548d5e`) against the `proposal.md` and `gap.md` in this folder. Code was read independently before reconciling against `tasks.md`. All findings have been resolved; see [Closed Findings](#closed-findings).

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

Initial scan surfaced 13 findings: one P0 (project-scope RBAC regression), four P1 (closed-enum holdouts and validation gaps), and the rest P2/P3 hygiene. All have been resolved on this branch — see fixes inline below. EE unit suite (102 tests) green after the changes.

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
