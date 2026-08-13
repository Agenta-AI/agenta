# WP3 tasks — Policy core

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/policy/{dtos,types,interfaces}.py`) already existing on the base branch.
Depends on nothing else — WP3 can start immediately alongside WP1 and WP2.

## Setup

- [ ] Read `core/access/permissions/service.py::check_action_access` and
      `check_project_has_role_or_permission` in full — confirm the parameter types
      (`user_uid: str`, `project_id: Optional[str]`) and the existing `Flag.RBAC`
      plan-gate behavior folded inside it. That gate lives inside the permission call and
      is not an entitlement check this package adds — WP3 adds none at all (D29).

## `core/access/permissions/types.py` — Permission enum

- [ ] Add the six new `Permission` members after `USE_MOUNTS` (or wherever the gateway
      block reads best, but do not scatter them across the file): `VIEW_LLM_ENDPOINTS`,
      `EDIT_LLM_ENDPOINTS`, `USE_LLM_ENDPOINTS`, `VIEW_MCP_ENDPOINTS`,
      `EDIT_MCP_ENDPOINTS`, `USE_MCP_ENDPOINTS` — values are the lower-snake-case string
      form of each name, exactly as `entities.md` §9 lists.
- [ ] In `default_permissions()`, add `cls.VIEW_LLM_ENDPOINTS`, `cls.VIEW_MCP_ENDPOINTS`
      to `VIEWER_PERMISSIONS`.
- [ ] Add `cls.USE_LLM_ENDPOINTS`, `cls.USE_MCP_ENDPOINTS` to `ANNOTATOR_PERMISSIONS`
      (built as `VIEWER_PERMISSIONS + [...]` — do not also re-add the `VIEW_*` pair
      here).
- [ ] Add `cls.EDIT_LLM_ENDPOINTS`, `cls.EDIT_MCP_ENDPOINTS` to `EDITOR_PERMISSIONS`
      (built as `ANNOTATOR_PERMISSIONS + [...]`).
- [ ] Confirm by reading the method body that `DEVELOPER_PERMISSIONS`, `ADMIN_PERMISSIONS`
      and `OWNER`'s `[p for p in cls]` all pick up the six new members automatically
      through the superset chain — do not add them a second time anywhere.
- [ ] Ruff format + check; commit: "core/access: add gateway endpoint permissions".

## `core/gateways/policy/service.py` — skeleton

- [ ] `GatewayPolicyService.__init__(self, *, resolver: CredentialResolverInterface) ->
      None`: store `self.resolver = resolver`. Nothing else in the constructor.

## `authorize()`

- [ ] Implement `authorize(self, *, scope: AuthScope, permission: Permission, target:
      GatewayTarget) -> PolicyDecision`: call `check_action_access(user_uid=str(scope.user_id),
      project_id=str(scope.project_id), permission=permission)`. `False` → return
      `PolicyDecision(allowed=False, permission=permission, reason="permission_denied")`.
- [ ] `True` → return `PolicyDecision(allowed=True, permission=permission, reason=None)`.
      One check, not two (D29).
- [ ] Confirm no `try/except` around the `check_action_access` call swallows an exception
      into `allowed=True` — permission is fail-closed; let an unexpected exception from
      `check_action_access` propagate (or explicitly convert to `allowed=False` — pick
      one, document the choice in a one-line comment, and make the unit test assert the
      chosen behavior).

## No `_check_entitlement()` — removed by ruling (D29)

- [ ] Write **no** entitlement method and **no** placeholder key. Every user has both
      gateways, so the check would ask a question with one answer; what entitlements will
      express here are limits, which cannot be enforced before anything is measured. It
      ships with usage metering and billing (D29, closing R5).
- [ ] `EntitlementDeniedError` and `reason="entitlement_denied"` stay declared in the seed
      and mapped at the boundary — nothing in wave 1 raises either. Do not delete them, and
      do not add a call that always permits: a later reader mistakes it for enforcement.

## `record()` — the wave-1 stub

- [ ] Implement `record(self, *, scope: AuthScope, target: GatewayTarget, decision:
      PolicyDecision, outcome: GatewayOutcome) -> None`: accept the full signature, do
      nothing beyond an optional `log.debug` noting the stub was invoked, `return`. No
      `publish_event` call, no partial audit attribute building — that is WP4's file
      (`policy/audit.py`), which does not exist yet.
- [ ] Confirm by reading the diff that this method cannot raise under any input —
      `entities.md` §8's contract ("never raises — the caller's response must not depend
      on the stream") applies from wave 1 even though the body is empty.

## Ruff

- [ ] Ruff format then ruff check `core/gateways/policy/service.py` and
      `core/access/permissions/types.py`; fix all errors.
- [ ] Commit: "core/gateways: implement GatewayPolicyService".

## tests — unit (run now)

- [ ] `api/oss/tests/pytest/unit/gateways/test_gateways_policy_service.py`: mock
      `check_action_access` at the module boundary. Nothing else to mock — `authorize()`
      has one dependency.
- [ ] `check_action_access` → `True`: `authorize()` returns
      `allowed=True, reason=None`.
- [ ] `check_action_access` → `False`: `authorize()` returns `allowed=False,
      reason="permission_denied"`.
- [ ] `check_action_access` raises: assert the documented behavior (no exception escapes
      `authorize()` — confirm which of "propagates" vs "caught and treated as denied" was
      chosen in the implementation task above, and pin it here).
- [ ] `record()` called with representative arguments returns `None`, raises nothing, and
      (via a patch on `publish_event` or equivalent) is confirmed to call **no** publish
      path.
- [ ] `Permission.default_permissions(DefaultRole.VIEWER)` contains
      `VIEW_LLM_ENDPOINTS` and `VIEW_MCP_ENDPOINTS`.
- [ ] `Permission.default_permissions(DefaultRole.ANNOTATOR)` contains those two plus
      `USE_LLM_ENDPOINTS`, `USE_MCP_ENDPOINTS`.
- [ ] `Permission.default_permissions(DefaultRole.EDITOR)` contains all of the above plus
      `EDIT_LLM_ENDPOINTS`, `EDIT_MCP_ENDPOINTS`.
- [ ] `Permission.default_permissions(DefaultRole.ADMIN)` and
      `.default_permissions(DefaultRole.OWNER)` both contain all six — the superset
      propagation check.
- [ ] Ruff format + check; commit.

## `api/entrypoints/routers.py` diff (hand off at merge, do not commit directly)

- [ ] Write the `GatewayPolicyService(resolver=credential_resolver)` construction line
      from `specs-wp3.md` into this package's PR description for the M1 merge — ordered
      after WP2's `credential_resolver` construction line.

## Definition of done

Feeds **M1**, then **Checkpoint A** through every plane service and management router
that calls `authorize()`. Exit condition, verbatim from `plan.md`: *"a caller without
permission on an endpoint is refused before any upstream call."*

WP3 is done when: the unit suite above passes in full; the six `Permission` members are
correctly wired through `VIEWER`/`ANNOTATOR`/`EDITOR` and propagate to
`DEVELOPER`/`ADMIN`/`OWNER`; `authorize()` never raises and never returns anything but a
`PolicyDecision`; and `record()` is safely callable with the full signature and produces
no observable side effect in wave 1. Note in the M1/M2 merge notes that "every member is
checked by a named route" (the `RUN_TRIGGERS` lesson) cannot be fully verified from this
package alone — it depends on WP6/WP8/WP10 actually calling `authorize()` with each of
the six permissions, and should be grepped for at the Checkpoint A merge, not assumed.
