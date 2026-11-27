# RBAC in OSS — Research (status quo & learnings)

Status: research only. No code changed. Captures the current state of RBAC across
OSS and EE so the proposal, gap, and plan can be reasoned about precisely.

## TL;DR

Memberships and roles already live in OSS. What remains in EE is the **enforcement
logic** and the **permission vocabulary** (the `Permission`/role enums and the role
catalog). The OSS routers already *call* the enforcement functions and the OSS access
router already contains the full check pipeline — but all of it is gated behind
`is_ee()` (for imports/calls) or short-circuited by `if is_oss(): return Allow()` (in
the access router). So "RBAC in OSS" is mostly **un-gating code that already exists**,
plus moving three self-contained modules down from EE to OSS, plus replacing one
entitlement gate.

## Where things live today

### Membership data — already in OSS

- `oss/src/models/db_models.py`: `OrganizationMemberDB`, `WorkspaceMemberDB`,
  `ProjectMemberDB`. Each has `user_id`, the scope FK, and `role` (String,
  `server_default="viewer"`). `ProjectMemberDB` additionally has `is_demo`.
- EE re-exports these from OSS (`ee/src/models/db_models.py`), so existing EE code
  keeps importing them from EE unchanged.
- Three-level hierarchy: Organization → Workspace → Project, each with its own role.

### Permission vocabulary & role catalog — in EE

- `ee/src/core/access/permissions/types.py` — pure enums, **zero EE deps**:
  - `Permission` (~60 action slugs: `VIEW_APPLICATIONS`, `EDIT_BILLING`,
    `MODIFY_USER_ROLES`, `VIEW_EVENTS`, …)
  - `DefaultRole` (owner, admin, developer, editor, annotator, viewer)
  - `RequiredRole` (owner, admin, viewer — guaranteed in every scope)
- `ee/src/core/access/permissions/controls.py` — `build_role_controls()`, env-override
  parsing for `AGENTA_ACCESS_ROLES` / `AGENTA_ACCESS_ROLES_OVERLAY`. Imports only
  `oss.src.utils.env` and the enums above. **Zero billing deps.**
- `ee/src/core/access/controls.py` — composition root that builds **both** the plan
  catalog (billing) **and** the role catalog in one module, at import time, behind one
  `_CONTROLS_HASH`. Role accessors (`get_roles`, `get_role`, `get_role_permissions`,
  `get_role_description`) are clean; plan accessors (`get_plan*`) pull in entitlements.

### Enforcement service — in EE

`ee/src/core/access/permissions/service.py` is the heart:

- `check_action_access(user_uid, project_id, permission|role)` — cached entry point
  (Redis namespace `check_action_access`).
- `check_rbac_permission(...)` — resolves project → workspace → organization, then
  checks workspace access and project role/permission.
- `check_project_has_role_or_permission(project, user_id, role|permission)` — the core
  decision. Fetches project members, handles demo members, **calls
  `check_entitlements(Flag.RBAC)`**, treats org owner and project `OWNER` as
  always-allowed, else resolves role→permissions via `get_role_permissions`.
- `check_user_org_access(...)`, `check_user_access_to_workspace(...)` — org/workspace
  membership checks (used by EE org/workspace routers).

This file already imports from `oss.src.*` for everything except: the permission/role
enums, the role catalog accessors, the entitlements gate, and four `db_manager_ee`
lookups.

### The entitlement gate — genuinely EE

`ee/src/core/access/entitlements/service.py`: `check_entitlements(key=Flag.RBAC, scope)`
reads the org's **Stripe subscription** → plan → plan entitlements → the `RBAC` flag.
Call chain bottoms out in `SubscriptionsDAO`. There is no OSS notion of subscriptions,
so this gate cannot move as-is. In EE today, **RBAC-not-entitled ⇒ grant full access**
(the free/legacy bypass).

### DB lookups used by enforcement — OSS-shaped, sitting in EE

In `ee/src/services/db_manager_ee.py`, all plain relational reads over OSS tables, **no
EE logic**:

- `get_project_members(project_id)` — `ProjectMemberDB` rows (joinedload user).
- `get_workspace_members(workspace_id)` — `WorkspaceMemberDB` rows.
- `get_organization(organization_id)` — `OrganizationDB` row.
- `get_user_org_and_workspace_id(user_uid)` — user's org_ids + workspace_ids from
  `OrganizationMemberDB` / `WorkspaceMemberDB`.

### The access router — pipeline already in OSS, gated off

`oss/src/apis/fastapi/access/router.py` already contains the full three-stage
`check_permissions` pipeline (scope → action → resource) with caching. But:

- Top of file: `if is_ee(): from ee.src.core.access... import Permission,
  check_action_access, check_entitlements, Counter`.
- Line ~119: `if is_oss(): return Allow(credentials_header)` — short-circuits the whole
  pipeline in OSS, so OSS is allow-all today.
- The `_check_resource_access` `local_secrets` branch calls
  `check_entitlements(Counter.CREDITS_CONSUMED)` — this is a **credits meter** (paid
  usage), not RBAC. It must stay EE-gated.

Mounting: OSS `AccessRouter` is mounted in `entrypoints/routers.py` under `/access`. EE
adds its own `/access/plans` and `/access/roles` (read-only catalogs) via
`ee.extend_main(app)`. No conflict; they coexist.

## The big learning: OSS already calls enforcement everywhere

**28 OSS files import RBAC symbols from `ee.src.core.access` under `if is_ee():`**, and
the call sites guard the actual call the same way. Pattern (e.g.
`oss/src/routers/api_key_router.py`):

```python
if is_ee():
    from ee.src.core.access.permissions.types import Permission
    from ee.src.core.access.permissions.service import check_action_access
...
if is_ee():
    has_permission = await check_action_access(
        user_uid=..., project_id=..., permission=Permission.VIEW_API_KEYS,
    )
    if not has_permission:
        raise HTTPException(403, ...)
```

The 28 files:

```
oss/src/apis/fastapi/access/router.py
oss/src/apis/fastapi/annotations/router.py
oss/src/apis/fastapi/applications/router.py
oss/src/apis/fastapi/environments/router.py
oss/src/apis/fastapi/environments/utils.py
oss/src/apis/fastapi/evaluations/router.py
oss/src/apis/fastapi/evaluators/router.py
oss/src/apis/fastapi/folders/router.py
oss/src/apis/fastapi/invocations/router.py
oss/src/apis/fastapi/legacy_variants/router.py
oss/src/apis/fastapi/otlp/router.py
oss/src/apis/fastapi/queries/router.py
oss/src/apis/fastapi/testcases/router.py
oss/src/apis/fastapi/testsets/router.py
oss/src/apis/fastapi/tools/router.py
oss/src/apis/fastapi/traces/router.py
oss/src/apis/fastapi/tracing/router.py
oss/src/apis/fastapi/vault/router.py
oss/src/apis/fastapi/webhooks/router.py
oss/src/apis/fastapi/workflows/router.py
oss/src/core/accounts/service.py
oss/src/core/events/utils.py
oss/src/routers/api_key_router.py
oss/src/routers/organization_router.py
oss/src/routers/user_profile.py
oss/src/routers/workspace_router.py
oss/src/tasks/asyncio/events/worker.py
oss/src/tasks/asyncio/tracing/worker.py
```text

Consequence: once the enforcement symbols resolve in OSS and the `is_ee()` guards are
relaxed to "RBAC available", these sites enforce **without per-site logic changes** —
they already pass the right `Permission`. The work is largely mechanical un-gating, not
rewriting handlers.

EE-only call sites (stay as-is, keep importing from EE via re-export):
`ee/src/routers/workspace_router.py`, `ee/src/apis/fastapi/billing/router.py`,
`ee/src/apis/fastapi/events/router.py`, plus `check_user_org_access` in the EE org
routers.

## Owner / role seeding (lockout safety)

Enforcement treats two things as always-allowed: `organization.owner_id == user_id`,
and project `OWNER` role. So a freshly created org must seed both.

- **Safe path — `oss/src/services/commoners.py:create_organization()`**: sets
  `organization.owner_id = user.id`, and creates org/workspace/project memberships all
  with `role="owner"`. Creator cannot be locked out.
- **Admin account creation — `oss/src/core/accounts/service.py`**: defaults all three
  memberships to `role="owner"` when none specified.
- **Invitee path — `oss/src/services/db_manager.py:add_user_to_workspace_and_org()`**:
  passes `role` to workspace and project memberships, but the **org membership row is
  created with no `role`** (falls to the `"viewer"` server default) and does not touch
  `organization.owner_id` (correct — invitees aren't owners). Not a lockout per se, but
  the org-membership role being silently `viewer` is an inconsistency worth fixing for
  correctness once roles are enforced.

## Caching & infra already shared

`get_cache` / `set_cache` (`oss/src/utils/caching.py`), `get_module_logger`, the auth
context (`get_auth_context`, `get_auth_scope`), and `get_transactions_engine` are all
OSS utilities the EE enforcement code already uses. Moving the code down a layer does
not change its infra dependencies.

## Open EE-only surface after a move

- `Flag.RBAC` entitlement gate (Stripe-backed) — EE keeps it; OSS must not call it.
- `Counter.CREDITS_CONSUMED` in `_check_resource_access` (`local_secrets`) — EE-gated.
- Plan catalog (`get_plan*`, `build_plan_controls`) — stays in EE.
- `/access/plans` and `/access/roles` EE catalog router — stays in EE (or its roles
  half could later move; out of scope here).
