# RBAC in OSS — Gap analysis

Status: gap analysis. What stands between today's state ([research.md](./research.md))
and the target ([proposal.md](./proposal.md)). Ordered by risk.

## G1 — Entitlement gate has no OSS answer (design gap, resolved by decision)

`check_project_has_role_or_permission` calls `check_entitlements(Flag.RBAC)`, which
reads Stripe subscriptions. OSS has no subscriptions, so the call cannot run in OSS.

- Resolution: decided "always enforce in OSS" — OSS skips the gate entirely; EE keeps
  it behind `is_ee()` with a function-local import. See proposal §"the one behavioral
  seam".
- Residual risk: low. The only subtlety is ensuring the `is_ee()`-guarded import is
  function-local (not module-top) so OSS deployments without the `ee` package don't
  fail to import.

## G2 — Lockout risk from always-on enforcement (behavioral gap, must verify)

Today OSS is allow-all; flipping to always-enforce can lock users out of orgs whose
memberships weren't seeded with a privileged role.

- Safe paths confirmed: `commoners.py:create_organization()` sets `owner_id` and seeds
  `owner` across org/workspace/project; admin account creation defaults to `owner`.
- **Gap:** `db_manager.py:add_user_to_workspace_and_org()` creates the
  `OrganizationMemberDB` row with **no role** (server default `viewer`) while passing
  the intended `role` to workspace and project rows. Org `owner_id` is correctly left
  alone (invitees aren't owners). Enforcement reads role at project level and via org
  `owner_id`, so this likely isn't a hard lockout — but the silent `viewer` org role is
  an inconsistency that should be made explicit before roles are enforced.
- Action: audit every membership-creation path for a deterministic role; fix the org
  row in `add_user_to_workspace_and_org` to take/set an explicit role. Add a regression
  test: create org → creator can perform an `owner`-gated action; invite user with role
  X → user has exactly X.

## G3 — Symbols don't resolve in OSS yet (mechanical gap, largest surface)

The enforcement service, enums, role catalog, and four DB lookups live in EE. 28 OSS
files import them under `if is_ee():` and guard the calls the same way; the OSS access
router short-circuits with `if is_oss(): return Allow()`.

- Gap: until the symbols live in OSS, none of the existing OSS call sites can enforce.
- Action: move the modules (proposal target layout), then un-gate the 28 files'
  imports and call guards, then drop the access-router short-circuit. Mechanical but
  broad — must be exhaustive or coverage is silently partial.
- Watch-out: do not un-gate the `local_secrets` / `Counter.CREDITS_CONSUMED` branch —
  that's a paid meter, stays `is_ee()`.

## G4 — Catalog module entanglement (structural gap)

`ee/src/core/access/controls.py` builds plans + roles in one import-time pass behind one
hash. Roles must come out without breaking plans.

- Gap: a naive move of the whole module would drag the plan/entitlement (billing)
  dependencies into OSS.
- Action: extract only `build_role_controls` + `get_role*` to OSS; leave
  `build_plan_controls` + `get_plan*` in EE; EE `controls.py` re-exports role accessors
  from OSS. Verify the import-time build still succeeds in both editions and the
  controls hash/logging still composes.

## G5 — Re-export discipline for EE back-compat (mechanical gap)

EE code (billing/events/workspace routers, `db_manager_ee` callers) imports the moved
symbols from their current EE paths.

- Gap: moving files breaks those imports unless EE re-exports from the new OSS
  locations.
- Action: leave thin re-export shims at every vacated EE path
  (`ee/.../permissions/{types,controls,service}.py`, the four functions in
  `db_manager_ee.py`, the role accessors in EE `controls.py`). Per repo convention,
  shared functions live in OSS and EE imports directly — no re-export *of OSS through a
  second EE shim* where avoidable, but transitional shims at vacated paths are
  acceptable to keep the diff small. Decide per-path in the plan.

## G6 — Test coverage across editions (validation gap)

RBAC enforcement currently only meaningfully runs in EE.

- Gap: no OSS acceptance tests asserting enforcement (today OSS is allow-all, so none
  could exist).
- Action: per the OSS/EE test-account convention, add acceptance tests for the now-
  ungated endpoints in **both** editions — OSS with the basic class account, EE with an
  inline business+developer account. Assert: owner allowed; viewer denied on an
  edit-gated action; allowed on a view-gated action. EE must additionally prove the
  `Flag.RBAC`-not-entitled bypass still returns allow-all.

## G7 — Cache namespace collision (low-risk, verify)

`check_action_access` caches under `check_action_access`; the access router under
`check_permissions`. Both keyed by project_id+user_id.

- Gap: none expected — same code, same keys, just resolved in OSS now. Verify the
  cache TTL/invalidation behaves identically and that a role change invalidates
  correctly (existing behavior; just confirm the move didn't drop an invalidation
  call).

## Summary

| Gap | Type | Risk | Resolution |
|-----|------|------|------------|
| G1 entitlement gate | design | low (decided) | OSS skips; EE `is_ee()` local import |
| G2 lockout / seeding | behavioral | **high** | audit + fix org-role seeding, add test |
| G3 symbol resolution + un-gate | mechanical | medium (broad) | move modules, un-gate 28 files + router |
| G4 catalog split | structural | medium | extract role half, leave plan half |
| G5 re-export shims | mechanical | low | shims at vacated EE paths |
| G6 cross-edition tests | validation | medium | OSS + EE acceptance tests |
| G7 cache namespaces | validation | low | confirm invalidation intact |
