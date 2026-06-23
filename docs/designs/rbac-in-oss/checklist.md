# RBAC in OSS — Implementation checklist (WP0 inventory)

Status: COMPLETE. All work packages landed; see plan.md "Outcome (as implemented)".
Verified against the codebase before implementation. This is the coverage ledger for WP5.

## Modules to move (EE → OSS)

- [ ] `ee/src/core/access/permissions/types.py` → `oss/src/core/access/permissions/types.py`
      — `Permission`, `DefaultRole`, `RequiredRole`. Pure enums, zero deps.
- [ ] `ee/src/core/access/permissions/controls.py` → `oss/src/core/access/permissions/controls.py`
      — `build_role_controls` + parsers. Deps: enums, `oss.src.utils.env`, and the
      `SCOPES` / `OWNER_PERMISSIONS` constants (defined locally in OSS).
- [ ] `ee/src/core/access/permissions/service.py` → `oss/src/core/access/permissions/service.py`
      — enforcement. The entitlement gate becomes `is_ee()`-guarded function-local import.
- [ ] role half of `ee/src/core/access/controls.py` (`get_roles`/`get_role`/
      `get_role_permissions`/`get_role_description`) → OSS controls module. Plan half stays EE.
- [ ] 4 DB lookups in `ee/src/services/db_manager_ee.py` → `oss/src/services/db_manager.py`:
      `get_organization` (L78), `get_workspace_members` (L165), `get_project_members` (L1070),
      `get_user_org_and_workspace_id` (L1449).

## Re-export shims left at vacated EE paths

- [ ] `ee/.../permissions/types.py` → re-export from OSS
- [ ] `ee/.../permissions/controls.py` → re-export from OSS
- [ ] `ee/.../permissions/service.py` → re-export from OSS
- [ ] `ee/.../access/controls.py` → keep plan accessors, re-export role accessors from OSS
- [ ] `ee/.../db_manager_ee.py` → re-export the 4 lookups from OSS db_manager

## WP5 un-gate ledger — 31 OSS files importing `ee.src.core.access`

Legend: **R** = imports RBAC (`permissions.*`) → un-gate to OSS.
**E** = imports entitlements (`entitlements.*`) → STAYS EE-gated.

| File | RBAC | Entitlements | Action |
|------|:----:|:----:|--------|
| apis/fastapi/access/router.py | R | E | un-gate RBAC + drop `if is_oss(): return Allow()`; keep `Counter` EE |
| apis/fastapi/annotations/router.py | R | | un-gate |
| apis/fastapi/applications/router.py | R | | un-gate |
| apis/fastapi/environments/router.py | R | | un-gate |
| apis/fastapi/environments/utils.py | R | | un-gate |
| apis/fastapi/evaluations/router.py | R | E | un-gate RBAC; keep `Counter` EE |
| apis/fastapi/evaluators/router.py | R | | un-gate |
| apis/fastapi/folders/router.py | R | | un-gate |
| apis/fastapi/invocations/router.py | R | | un-gate |
| apis/fastapi/legacy_variants/router.py | R | | un-gate |
| apis/fastapi/otlp/router.py | R | E | un-gate RBAC; keep `Counter` EE |
| apis/fastapi/queries/router.py | R | | un-gate |
| apis/fastapi/testcases/router.py | R | | un-gate |
| apis/fastapi/testsets/router.py | R | | un-gate |
| apis/fastapi/tools/router.py | R | | un-gate |
| apis/fastapi/traces/router.py | R | | un-gate |
| apis/fastapi/tracing/router.py | R | E | un-gate RBAC; keep `Counter` EE |
| apis/fastapi/vault/router.py | R | | un-gate |
| apis/fastapi/webhooks/router.py | R | | un-gate |
| apis/fastapi/workflows/router.py | R | | un-gate |
| core/accounts/service.py | R (controls) | | un-gate role accessors |
| core/events/utils.py | | E | leave EE-gated (entitlements only) |
| routers/api_key_router.py | R | | un-gate |
| routers/organization_router.py | R | E | un-gate RBAC; keep entitlements EE |
| routers/user_profile.py | R | | un-gate |
| routers/workspace_router.py | R | E | un-gate RBAC (`check_rbac_permission`, `RequiredRole`, `get_roles`); keep entitlements EE |
| services/admin_manager.py | R? | | verify import; un-gate if RBAC |
| tasks/asyncio/events/worker.py | | E | leave EE-gated (entitlements only) |
| tasks/asyncio/tracing/worker.py | | E | leave EE-gated (entitlements only) |
| models/api/workspace_models.py | R? | | verify import; un-gate if RBAC |
| utils/env.py | R? | | verify import; un-gate if RBAC |

EE-only callers (unchanged, import via re-export): `ee/src/routers/workspace_router.py`,
`ee/src/apis/fastapi/billing/router.py`, `ee/src/apis/fastapi/events/router.py`,
`ee/src/apis/fastapi/organizations/router.py`, `ee/src/services/*`.

## WP1 seeding (done first)

- [ ] `add_user_to_workspace_and_org`: org member row gets explicit `role=role`
      (was silently `viewer`). Both callers pass `invitation.role`. (db_manager.py:829)
- [x] `commoners.create_organization` seeds `owner` across all scopes (verified, no change).
- [x] admin account creation defaults to `owner` (verified, no change).

## Cache namespaces (G7)

- `check_action_access` namespace in service; `check_permissions` in access router.
  Same keys (project_id+user_id). Role-change invalidation: `invalidate_cache` in
  `workspace_manager.accept` path. Confirm intact after move.
