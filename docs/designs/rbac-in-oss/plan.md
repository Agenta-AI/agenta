# RBAC in OSS — Implementation plan

Status: plan. Work packages, no timeline. Builds on [proposal.md](./proposal.md) and
[gap.md](./gap.md). Packages are ordered so each lands behind a green build; WP2–WP4
are the move, WP5 is the behavior flip, WP6 the safety net.

Convention reminders (from `api/AGENTS.md` and codebase memory): `ruff format` then
`ruff check --fix` in `api/` before committing; use `is_ee()` as the runtime guard;
keep in-code comments to one terse line; OSS must never import `ee.*` at module top.

## WP0 — Pre-flight inventory & guard rails

- Snapshot the exhaustive call-site list (28 OSS files + EE-only sites from research)
  into a checklist so WP5 coverage is verifiable, not approximate.
- Confirm `get_cache`/`set_cache` invalidation paths touched by enforcement (G7).
- Define the cross-edition test matrix up front (owner-allow, viewer-deny-edit,
  viewer-allow-view; EE bypass-when-not-entitled) so WP6 has acceptance criteria.
- Deliverable: a tracking checklist in this folder; no code.

## WP1 — Audit & fix membership role seeding (G2, lockout safety)

Do this **first** — it's the gate on the behavior flip being safe.

- Audit every membership-creation path: `commoners.py:create_organization`,
  `accounts/service.py` admin creation, `db_manager.py:add_user_to_*` and
  `add_user_to_workspace_and_org`.
- Fix `add_user_to_workspace_and_org` so the `OrganizationMemberDB` row gets an
  explicit role instead of the silent `viewer` default.
- Confirm `organization.owner_id` is always set on org creation and that enforcement's
  owner-allow path reads it reliably.
- Tests: creator can perform an `owner`-gated action immediately after org creation;
  invitee with role X gets exactly X.

## WP2 — Move permission vocabulary & role catalog to OSS (G3 part 1, G4)

- Move `permissions/types.py` (`Permission`, `DefaultRole`, `RequiredRole`) → 
  `oss/src/core/access/permissions/types.py`. Pure enums; no logic change.
- Extract role half of the catalog: `build_role_controls` + `get_role*` →
  `oss/src/core/access/permissions/controls.py`. Leave `build_plan_controls` +
  `get_plan*` in EE `controls.py`.
- EE re-exports: `ee/.../permissions/types.py` and EE `controls.py` re-export role
  symbols from OSS (G5).
- Verify import-time catalog build succeeds in both editions; controls hash/logging
  still composes.

## WP3 — Move the four DB lookups to OSS (G3 part 2, G5)

- Move `get_project_members`, `get_workspace_members`, `get_organization`,
  `get_user_org_and_workspace_id` from `db_manager_ee.py` into
  `oss/src/services/db_manager.py` (plain relational reads over OSS tables).
- `db_manager_ee.py` re-exports them so EE callers are unaffected.

## WP4 — Move the enforcement service to OSS + relocate the entitlement gate (G1)

- Move `permissions/service.py` → `oss/src/core/access/permissions/service.py`.
  Repoint its imports to the new OSS locations (types, controls, db_manager lookups).
- Replace the unconditional `check_entitlements(Flag.RBAC)` block with the
  `is_ee()`-guarded, **function-local** EE import per proposal §seam. OSS path falls
  through and enforces; EE path preserves the not-entitled allow-all bypass.
- EE `permissions/service.py` becomes a re-export shim → OSS (G5).
- Unit-test `check_project_has_role_or_permission` in isolation for both branches
  (mock `is_ee()` true/false).

## WP5 — Un-gate enforcement everywhere (G3 part 3) — the behavior flip

- Drop `if is_oss(): return Allow()` from `oss/.../access/router.py`; make its
  `Permission`/`check_action_access` imports unconditional from OSS. Keep the
  `local_secrets` / `Counter.CREDITS_CONSUMED` branch behind `is_ee()`.
- For each of the 28 OSS files (checklist from WP0): switch the gated import to an
  unconditional OSS import and remove the `if is_ee():` guard around the
  `check_action_access` call so it runs in both editions. Handlers already pass the
  correct `Permission` — no per-handler logic changes.
- Leave EE-only routers (billing, events, EE workspace/org) importing from EE
  re-export paths.
- This WP is where OSS stops being allow-all; it must not merge before WP1 and WP6.

## WP6 — Cross-edition acceptance tests (G6, G7)

- Add acceptance tests for the now-ungated endpoints in **both** editions: OSS with the
  basic class account, EE with an inline business+developer account.
- Assert: owner allowed on edit-gated action; viewer denied on edit-gated, allowed on
  view-gated. EE: prove `Flag.RBAC`-not-entitled still yields allow-all.
- Confirm cache invalidation on role change (G7) in both editions.

## WP7 — Cleanup & docs

- Decide which transitional EE re-export shims to keep vs. convert callers to import
  directly from OSS (per layering convention; avoid leaving dead shims long-term).
- Update `api/AGENTS.md` / relevant area docs to state RBAC enforcement is OSS and
  always-on, with the EE plan-gate as the only edition difference.
- Final `ruff format` + `ruff check` pass over touched files.

## Dependency graph

```
WP0 ─┬─> WP1 ───────────────┐
     ├─> WP2 ─> WP4 ─┐       │
     └─> WP3 ─> WP4 ─┴> WP5 ─┴> WP6 ─> WP7
```

- WP2 and WP3 are independent and can proceed in parallel; both feed WP4.
- WP5 (the flip) requires WP4 (symbols resolve in OSS) **and** WP1 (no lockout).
- WP6 validates WP5; WP7 closes out.

## Risk register (carried from gap.md)

- **Highest:** WP1/WP5 lockout — never merge WP5 without WP1's seeding fix + tests.
- **Broad surface:** WP5 must cover all 28 files exhaustively (use the WP0 checklist).
- **Structural:** WP2 catalog split must not drag plan/billing deps into OSS.
- **Invariant:** OSS never imports `ee.*` at module top; entitlement import is
  function-local under `is_ee()`.

## Outcome (as implemented)

What shipped, including decisions refined during implementation:

- **Moves (WP2–WP4):** `permissions/{types,controls,service}.py` and the `get_role*`
  composition root moved to `oss/src/core/access/`; the four RBAC DB lookups (plus
  `get_project_by_workspace`) moved to `oss/src/services/db_manager.py`. EE keeps thin
  re-export shims at every vacated path. EE `controls.py` keeps the plan half and
  re-exports role accessors from OSS.
- **Entitlement seam (WP4):** `check_project_has_role_or_permission` enforces in both
  editions; the `Flag.RBAC` allow-all bypass runs only under `is_ee()` via a
  function-local import of `ee...entitlements.service`. Verified: hobby (not entitled)
  → bypass; business/self-hosted (entitled) → enforce.
- **Un-gate (WP5):** 21 data-plane routers un-gated mechanically (RBAC unconditional;
  entitlement/meter calls stay `is_ee()`). `organization_router.py` and
  `workspace_router.py` were NOT mechanical — their `is_ee()` blocks gated the whole
  EE management flow with a separate OSS path. Per decision, enforcement
  (`check_action_access` / `check_rbac_permission`) was hoisted above the edition fork
  so invite/resend/remove enforce in both editions. `accounts/service.py` is plan
  (not RBAC) and was left as-is.
- **Custom roles = EE (refinement):** `AGENTA_ACCESS_ROLES` / `_OVERLAY` are an EE
  feature. The override parsers moved to `ee/src/core/access/permissions/role_overrides.py`;
  OSS `build_role_controls()` returns the code-default catalog and only applies overrides
  under a function-local `is_ee()` import. OSS ignores the env vars.
- **Env-var editions:** auth/onboarding vars (`ALLOWED_OWNER_EMAILS`,
  `ALLOWED_DOMAINS`, `BLOCKED_DOMAINS`, `BLOCKED_EMAILS`, `EMAIL_DISABLED`) are OSS;
  `PLANS`/`DEFAULT_PLAN*` and the role overrides are EE.
- **Tests (WP6):** relocated the broken role-override unit tests in
  `ee/tests/.../test_access_controls.py` to import from `role_overrides`; added
  `oss/tests/.../unit/access/test_role_controls_oss.py` (OSS ignores custom-role env;
  66 EE + 8 OSS unit tests green). Added cross-edition acceptance tests:
  `oss/.../test_rbac_enforcement.py` and `ee/.../test_rbac_enforcement_ee.py` (owner
  allowed / viewer denied; EE also asserts the not-entitled allow-all bypass).
- **Verification:** `ruff format` + `ruff check` clean across `api/`; every touched
  module imports in both `AGENTA_LICENSE=oss` and `=ee`.
