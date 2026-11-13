# Access / Entitlements / Permissions Refactor — Migration Plan

Status: PROPOSED (no edits applied). For review before execution.

## Goal (per user)

Restructure the EE access surface so concerns are cleanly separated:

- `core/access/controls.py` — **shared** build/orchestration: env loading,
  `_build_controls()`, the singleton, `controls_hash`, shared validators/schemas.
  **Depends on** `entitlements/controls.py` + `permissions/controls.py` (one-way,
  downward — `access` is the composition layer on top).
- `core/entitlements/controls.py` — **plans only**: plan/quota/counter/gauge/
  throttle parsing + overlays + `get_plan*` accessors.
- `core/permissions/controls.py` — **roles only**: role builders/parsers/overlays
  + `get_role*` accessors.
- Move `utils/entitlements.py` + `utils/permissions.py` into `core/` (they are
  stateful service layers, not utils).

Dependency direction (no cycles):
```
core/{entitlements,permissions}/types.py      (leaf types)
        ▲
core/entitlements/controls.py (plans)   core/permissions/controls.py (roles)
        ▲                                        ▲
        └───────────────┬────────────────────────┘
                core/access/controls.py  (shared build + singleton + hash)
                        ▲
        utils/* (services) , apis/fastapi/access/router.py , db_manager_ee, ...
```

## Current `entitlements/controls.py` function inventory (single file today)

PLAN cluster:
- `_PlanOverride` (47), `_default_plans` (76), `_validate_flag_key` (82),
  `_validate_counter_key` (89), `_validate_gauge_key` (96),
  `_parse_plans_override` (103)
- `_ThrottleOverlay` (565), `_DefaultPlanOverlay` (578), `_merge_quota` (591),
  `_merge_throttle` (602), `_parse_default_plan_overlay` (614),
  `_apply_default_plan_overlay` (646), `_resolve_default_plan_slug` (721)
- accessors: `get_plans` (812), `get_plan` (817), `get_plan_entitlements` (824),
  `get_plan_description` (831)
- `_DEFAULT_PLAN_DESCRIPTIONS` (module-level, near _default_plans)

ROLE cluster:
- `_RoleOverride` (57), `_read_only_permissions` (165),
  `_viewer_permissions_for_scope` (175), `_admin_permissions_for_scope` (186),
  `_minima_for` (197), `_default_roles` (236), `_parse_roles_override` (280),
  `_RoleOverlayEntry` (413), `_parse_roles_overlay` (426),
  `_apply_roles_overlay` (506)
- accessors: `get_roles` (838), `get_role` (845), `get_role_permissions` (853),
  `get_role_description` (861)

SHARED:
- `_validate_permission` (270) — used by role parsers; depends on `Permission`.
  (Move to permissions/controls.py — it is role/permission-only despite the name.)
- `_build_controls` (740) — orchestrates plan+role parse+overlay, builds the
  combined `controls_hash`, logs sources.
- singleton: `_PLANS, _PLAN_DESCRIPTIONS, _ROLES, _CONTROLS_HASH = _build_controls()` (804)
- `get_controls_hash` (868)
- imports: `env`, `hashlib`, `dumps`, pydantic; `entitlements.types` (Tracker,
  Flag, Counter, Gauge, DEFAULT_ENTITLEMENTS, DefaultPlan, OWNER_PERMISSIONS,
  Quota, SCOPES, Throttle); `permissions.types` (Permission, DefaultRole, RequiredRole)

Verdict: plan and role clusters have **zero cross-calls**. Only `_build_controls`
+ the shared `controls_hash` + `SCOPES` couple them. Clean to split.

## Target module contents

### `core/entitlements/controls.py` (plans)
- All PLAN-cluster functions above.
- New internal: `build_plan_controls() -> (plans, descriptions)` — does the
  env-or-default + plan-overlay logic currently inlined in `_build_controls`
  lines 746-766.
- Public `get_plan*` accessors read a module-level `_PLANS`/`_PLAN_DESCRIPTIONS`
  populated by `access/controls.py` via a registration hook (see "singleton"
  below) OR keep accessors in access/controls.py. **Decision needed — see Q1.**
- Imports `entitlements.types` only. No permissions import.

### `core/permissions/controls.py` (roles)
- All ROLE-cluster functions + `_validate_permission`.
- New internal: `build_role_controls() -> roles` — env-or-default + role-overlay
  logic currently inlined in `_build_controls` lines 768-779.
- Public `get_role*` accessors. Same singleton question (Q1).
- Imports `permissions.types` (+ `SCOPES`, `OWNER_PERMISSIONS` from
  entitlements.types — note this is a small permissions→entitlements.types dep;
  acceptable since types are leaf. Alternatively move `SCOPES`/`OWNER_PERMISSIONS`
  to a neutral spot — see Q2).

### `core/access/controls.py` (shared orchestration)
- `_build_controls()` — calls `build_plan_controls()` + `build_role_controls()`,
  computes the combined `controls_hash`, logs sources.
- The singleton init.
- `get_controls_hash()`.
- Imports BOTH `entitlements.controls` and `permissions.controls`.

### `utils/ → core/` service move
- `utils/entitlements.py` → `core/entitlements/service.py`
  (NOTE: an `entitlements/service.py` was just deleted — the dead
  `EntitlementsService`. This new file is the *check_entitlements* service, a
  different thing. Name ok, or use `core/entitlements/checks.py` — see Q3.)
- `utils/permissions.py` → `core/permissions/service.py` (or `checks.py`).

## The singleton question (Q1 — the crux)

Today: `get_plans`/`get_roles` read module-level `_PLANS`/`_ROLES` built at import
of `controls.py`. If plans/roles accessors live in their *own* modules but the
build is orchestrated in `access/controls.py`, the accessor modules can't build
their own singletons (they'd each only know their half, and env-override parsing
+ hashing is centralized).

Two clean designs:

- **(A) Accessors stay with the data, access registers into them.**
  `entitlements/controls.py` owns `_PLANS` + `get_plan*`; `permissions/controls.py`
  owns `_ROLES` + `get_role*`. Each exposes `build_*_controls()` (pure, no global)
  AND a `register_*_controls(...)` setter. `access/controls.py` at import calls
  build for both, computes hash, then registers each half into its module +
  stores the hash. Accessors raise if not yet registered.
  - Pro: accessors live with their domain; clean reads.
  - Con: import order matters — *something* must import `access/controls.py` at
    startup before any accessor is called. Today that is implicit (importing
    controls.py runs the build). Need an explicit bootstrap call (mirrors how
    `utils/entitlements.py` already does `register_entitlements_services`).

- **(B) access/controls.py owns the singleton AND all accessors.**
  `entitlements/controls.py` + `permissions/controls.py` are pure (build + parse,
  no globals). `access/controls.py` builds, holds `_PLANS`/`_ROLES`/`_HASH`, and
  exposes ALL accessors (`get_plans`, `get_roles`, ...). Every importer switches
  to `from ee.src.core.access.controls import get_plans/get_roles/...`.
  - Pro: one singleton, one build, no registration hook, no import-order trap
    (importing access.controls runs the build, exactly like today).
  - Con: accessors live in `access`, not in their domain module. But that is
    arguably correct — they read the *combined effective* controls, which is an
    access-layer concern. entitlements/permissions controls.py become pure
    builder/parser libraries.

**Recommendation: (B).** It preserves today's "import runs the build" semantics
(no new bootstrap-order bug), keeps the split pure, and matches the existing
`apis/fastapi/access/` framing (access = the combined surface). entitlements/
permissions `controls.py` become stateless builders; `access/controls.py` is the
stateful composition root. This is also the lowest-cycle-risk design.

## Open questions for sign-off

- **Q1 (singleton design):** A (register into domain modules) vs **B (access owns
  singleton + all accessors)**. Recommend B.
- **Q2 (`SCOPES`/`OWNER_PERMISSIONS` location):** they sit in `entitlements.types`
  but are permission/role concepts. Leave (small types-level dep from permissions
  → entitlements.types), or move to `permissions.types` / a neutral `access.types`?
  Recommend: leave for now (types are leaf, no cycle); revisit later.
- **Q3 (service file naming):** `core/{entitlements,permissions}/service.py` vs
  `checks.py`. `service.py` collides conceptually with the just-deleted
  EntitlementsService; `checks.py` is more descriptive (`check_entitlements`,
  `check_action_access`). Recommend `service.py` (domain convention) — the
  collision was a *deleted* file, so no real clash.
- **Q4 (scope):** do utils→core move in the SAME change as the controls split, or
  separate? The controls split is ~15 accessor importers; the utils move is
  ~24 (entitlements) + ~30 (permissions) + worker entrypoints. Recommend
  **two separate changes**: (1) controls split, (2) utils→core move.

## Blast radius (importer rewrites)

Controls split (design B — all accessors move to `access.controls`):
- Plan-accessor importers (6): billing/router, tracing/service, subscriptions/
  settings, events/service, throttling, utils/entitlements.
- Role-accessor importers (5): oss workspace_router, oss organization_router,
  ee workspace_router, utils/permissions, workspace_manager.
- `get_plan_description` + `get_plans`/`get_roles` in access/router (1).
- db_manager_ee (imports get_roles? — it imports from entitlements.controls; check).
- `test_controls_env_override.py`: ~28 in-string imports (`from
  ...entitlements.controls import get_plans/get_roles/...`) → rewrite to
  `...access.controls`.

utils→core move:
- `utils/entitlements.py`: 24 importer files.
- `utils/permissions.py`: 30 importer files.
- plus worker entrypoints referencing `bootstrap_entitlements_services`.

## Execution order (proposed)

Change 1 — controls split (design B):
1. Create `core/entitlements/controls.py` content = pure plan builder/parser
   (`build_plan_controls`, `_parse_plans_override`, overlays, `_default_plans`,
   `_DEFAULT_PLAN_DESCRIPTIONS`). No globals, no accessors.
2. Create `core/permissions/controls.py` = pure role builder/parser
   (`build_role_controls`, role parsers/overlays/minima, `_validate_permission`).
   No globals, no accessors.
3. Create `core/access/controls.py` = imports both, `_build_controls()`,
   singleton, ALL accessors (`get_plans/get_plan*/get_roles/get_role*`),
   `get_controls_hash`.
4. Delete the role/plan logic from the old `entitlements/controls.py` (file
   becomes the pure-plan module from step 1).
5. Rewire ~15 accessor importers + the test's in-string imports → `access.controls`.
6. Verify: ruff + per-file tests (test_access_controls, test_controls_env_override).

Change 2 — utils→core service move (separate):
1. `git mv utils/entitlements.py core/entitlements/service.py`,
   `git mv utils/permissions.py core/permissions/service.py`.
2. Rewire ~54 importers + worker entrypoints.
3. Verify.

## Risks

- **Import-order / cycle:** design B avoids the bootstrap-order trap. Confirm
  `access.controls` importing both domain controls creates no cycle (it won't:
  domain controls import only `*.types`, which import nothing).
- **The combined `controls_hash`** stays unified (computed in access) — no
  behavior change.
- **Large importer churn**, esp. the utils move (~54 files) and the test file's
  28 in-string imports — mechanical but wide; do with sed + per-file verify.
- **Working tree already large/uncommitted** — recommend committing current
  session work before Change 1, and doing Change 1 and Change 2 as separate
  commits.
