# WP3 tasks — Policy core

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/policy/{dtos,types,interfaces}.py`) already existing on the base branch.
Depends on nothing else — WP3 can start immediately alongside WP1 and WP2.

## Setup

- [ ] Read `core/access/permissions/service.py::check_action_access` and
      `check_project_has_role_or_permission` in full — confirm the parameter types
      (`user_uid: str`, `project_id: Optional[str]`) and the existing `Flag.RBAC`
      plan-gate behavior folded inside it, so the entitlement soft check this package
      adds is not confused with that existing gate.
- [ ] Read `core/events/utils.py`'s L1 soft-check call site (search for
      `check_entitlements` in that file) — this is the literal pattern `entities.md` §8
      says to follow for the entitlement half of `authorize()`.
- [ ] Read `ee/src/core/access/entitlements/types.py`'s `Flag`/`Counter` enums — confirm
      no existing member fits "gateway call" before writing the placeholder constant (do
      not skip this check; a member may have been added since this spec was written).

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
      `PolicyDecision(allowed=False, permission=permission, reason="permission_denied")`
      **without** calling the entitlement check.
- [ ] On permission-allowed, call `self._check_entitlement(scope=scope, target=target)`.
      `False` → return `PolicyDecision(allowed=False, permission=permission,
      reason="entitlement_denied")`.
- [ ] Both checks pass → return `PolicyDecision(allowed=True, permission=permission,
      reason=None)`.
- [ ] Confirm no `try/except` around the `check_action_access` call swallows an exception
      into `allowed=True` — permission is fail-closed; let an unexpected exception from
      `check_action_access` propagate (or explicitly convert to `allowed=False` — pick
      one, document the choice in a one-line comment, and make the unit test assert the
      chosen behavior).

## `_check_entitlement()` — the placeholder

- [ ] Implement `_check_entitlement(self, *, scope: AuthScope, target: GatewayTarget) ->
      bool`: `if not is_ee(): return True`. Otherwise, deferred `is_ee()`-guarded import
      of `check_entitlements` from `ee.src.core.access.entitlements.service`, call with
      `cache=True` and a clearly-named placeholder key constant (e.g.
      `_GATEWAY_ENTITLEMENT_KEY`, module-level, with a comment pointing at this package's
      "Missing from the design, needs a ruling" section) and `scope=scope_from(
      organization_id=scope.organization_id)`.
- [ ] Add a module-level comment above the placeholder constant stating plainly that it
      is not a real entitlement key and must be replaced once a ruling lands — do not let
      this read as a finished decision to a future reader skimming the file.
- [ ] Do not wrap this call in extra exception handling — `check_entitlements` already
      fails open on infrastructure errors by its own contract; adding a second layer
      changes nothing but hides what the real behavior is.

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
      `check_action_access` and `_check_entitlement` (or the underlying
      `check_entitlements` import) at the module boundary.
- [ ] `check_action_access` → `True`, entitlement → `True`: `authorize()` returns
      `allowed=True, reason=None`.
- [ ] `check_action_access` → `False`: `authorize()` returns `allowed=False,
      reason="permission_denied"`; assert the entitlement mock was **never called**.
- [ ] `check_action_access` → `True`, entitlement → `False`: `authorize()` returns
      `allowed=False, reason="entitlement_denied"`.
- [ ] `check_action_access` raises: assert the documented behavior (no exception escapes
      `authorize()` — confirm which of "propagates" vs "caught and treated as denied" was
      chosen in the implementation task above, and pin it here).
- [ ] `is_ee()` patched to `False`: `_check_entitlement` returns `True` without importing
      anything from `ee.*` (assert via `sys.modules` or a patch that raises if the EE
      import is attempted).
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
