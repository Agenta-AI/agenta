# RBAC in OSS — Proposal

Status: proposal. Builds on [research.md](./research.md). Decisions baked in below were
confirmed with the requester.

## Goal

Make role-based access control a first-class OSS feature: the permission vocabulary,
the role catalog, the enforcement service, and the supporting DB lookups all live in
OSS and enforce in both editions. EE keeps only what is genuinely EE: the
subscription/plan entitlement gate and billing-specific meters.

## Decisions

1. **OSS always enforces RBAC.** No entitlement gate in OSS. (Chosen over an env
   on/off flag.) RBAC is simply part of OSS.
2. **EE keeps its plan gate via `is_ee()`.** The `Flag.RBAC` Stripe-backed bypass
   (RBAC-not-entitled ⇒ allow-all) is preserved exactly, layered back at the single
   decision point with an `is_ee()`-guarded, function-local import of the EE
   entitlements service. OSS never imports `ee.*`.
3. **Move, don't fork.** The enforcement service, permission/role enums, the role
   half of the catalog, and the four DB lookups move *down* into OSS. EE re-exports the
   moved symbols from their new OSS locations so existing EE imports keep working.

## Target architecture

```text
oss/src/core/access/permissions/
    types.py        # Permission, DefaultRole, RequiredRole   (moved from EE)
    controls.py     # build_role_controls + get_role* accessors (moved from EE)
    service.py      # check_action_access, check_rbac_permission, ...  (moved from EE)

oss/src/services/db_manager.py
    get_project_members, get_workspace_members, get_organization,
    get_user_org_and_workspace_id                              (moved from db_manager_ee)

ee/src/core/access/
    controls.py     # plan catalog only; re-exports role accessors from OSS
    permissions/{types,controls,service}.py  # thin re-export shims → oss
    entitlements/   # unchanged (Stripe/plans/meters)
ee/src/services/db_manager_ee.py  # re-exports the four lookups from oss db_manager
```

### The one behavioral seam — the entitlement gate

In the moved `oss/.../permissions/service.py`,
`check_project_has_role_or_permission` replaces the unconditional
`check_entitlements(Flag.RBAC)` call with:

```python
if not is_demo:
    if is_ee():
        from ee.src.core.access.entitlements.service import (
            check_entitlements, scope_from, Flag,
        )
        check, _, _ = await check_entitlements(
            key=Flag.RBAC,
            scope=scope_from(organization_id=project.organization_id),
        )
        if not check:
            return True  # EE: RBAC not entitled → preserve allow-all bypass
    # OSS: no gate → fall through and enforce role/permission
```

- OSS: never imports `ee.*`, never bypasses, always enforces.
- EE: behavior byte-for-byte identical to today.

The function-local import inside the `is_ee()` branch is the deliberate, sanctioned
exception to the module-top-import convention — a module-level `from ee.src...` in an
OSS file would break OSS-only deployments where the `ee` package is absent. This is the
established OSS→EE optional-coupling pattern, and `is_ee()` is the correct runtime
guard (not `_EE_AVAILABLE`).

### The role/plan catalog split

`ee/src/core/access/controls.py` currently composes plans + roles behind one import-time
build and hash. The proposal:

- Move `build_role_controls` and the `get_role*` accessors to
  `oss/src/core/access/permissions/controls.py` (it already only depends on
  `oss.src.utils.env` and the enums).
- Leave `build_plan_controls` and `get_plan*` in EE's `controls.py`.
- EE's `controls.py` re-exports the role accessors from OSS so any EE caller of
  `get_role_permissions` etc. is unaffected.

### Un-gating the call sites

The 28 OSS files already call `check_action_access(..., permission=Permission.X)` under
`if is_ee():`. Once the symbols resolve in OSS:

- Imports become unconditional (`from oss.src.core.access.permissions...`).
- The `if is_ee():` guard around each *call* is removed so the check runs in both
  editions. The handlers already pass the correct `Permission`; no per-handler logic
  changes.
- The access router drops `if is_oss(): return Allow()`. The `local_secrets` /
  `Counter.CREDITS_CONSUMED` branch stays behind `is_ee()`.

## Non-goals

- Moving the plan/entitlement catalog or the `/access/plans` and `/access/roles`
  catalog endpoints to OSS.
- Changing the permission vocabulary, the default role→permission mapping, or the env
  override format (`AGENTA_ACCESS_ROLES[_OVERLAY]`).
- Redesigning membership tables or the auth/scope context.
- Building a roles management UI/API in OSS (separate effort).

## Compatibility & rollout posture

- EE behavior is unchanged by construction (re-exports + `is_ee()` gate preserve the
  plan bypass and all existing imports).
- The visible OSS change: endpoints stop being allow-all and begin enforcing roles.
  This is a behavior change for self-hosters and must be gated by the seeding
  guarantees in [gap.md](./gap.md) so creators/admins are never locked out.
