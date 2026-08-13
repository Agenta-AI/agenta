# WP3 — Policy core

Delivers `GatewayPolicyService.authorize()` — the permission check on a `GatewayTarget`,
returning a `PolicyDecision` rather than raising (there is no entitlement check: D29) — and
the six new `Permission` members (`VIEW_LLM_ENDPOINTS`, `EDIT_LLM_ENDPOINTS`,
`USE_LLM_ENDPOINTS`, `VIEW_MCP_ENDPOINTS`, `EDIT_MCP_ENDPOINTS`, `USE_MCP_ENDPOINTS`)
plus their role wiring. Owns `core/gateways/policy/service.py` and one edit to
`core/access/permissions/types.py`.

There is no principal to design (D2): every authenticated call already resolves a
frozen `AuthScope` (organization, workspace, project, user, all required). WP3 consumes
that scope as a parameter; it does not read `request.state`, does not call
`get_auth_scope()` itself (the caller — a router handler in WP10, or the relay path in
WP6/7/8/9 — resolves scope and passes it in), and does not construct a new principal
type.

## What this is NOT

- **No credit check.** `plan.md` is explicit: "the entitlement check. No credit check."
  Credit checks arrive with metering and billing, after checkpoint C (`plan.md`, "After
  checkpoint C"). `authorize()` never touches the legacy credits counter (D24 — left
  alone) and never touches a spend ceiling.
- **Not secret resolution.** `authorize()` never resolves a secret and never calls
  `SecretsResolverInterface` — that is WP2, called separately by the plane service
  *after* `authorize()` returns `allowed=True` (`entities.md` §8's relay pseudocode).
- **Not the real audit publish.** `GatewayPolicyService.record()` is declared here (it is
  part of the frozen `entities.md` §8 surface `authorize`/`record` pair, and the relay
  path in every wave-1 plane service calls it on every outcome), but its real body —
  building `EventType`/attribute payloads and calling `publish_event` — belongs to
  `core/gateways/policy/audit.py`, which is **WP4's file, landing in wave 2** (`plan.md`:
  *"Moved out of wave 1: wave 1 makes the call work, and a record of a call that does not
  happen is worth nothing"*). WP3 must still ship a **safe, callable, non-raising**
  `record()` in wave 1 — because WP6/WP7/WP8/WP9's relay path calls it on the Checkpoint A
  hot path — but it does nothing yet beyond satisfying the contract "never raises." See
  the `record()` section below; do not build a partial audit pipeline to fill the gap and
  do not raise `NotImplementedError` (that would break Checkpoint A, since a stub that
  raises is called on every relay).
- **Not the caller's exception raising.** `authorize()` never raises `PolicyDeniedError`
  or `EntitlementDeniedError` (both are seed-owned, `core/gateways/policy/types.py`, and
  WP3 does not edit that file). It returns a `PolicyDecision` with `allowed=False` and a
  `reason`; the calling plane service is the one that raises, specifically so it can call
  `record()` with the denial *before* the exception leaves the service (`entities.md`
  §8's ordering rule: "the denial is recorded before the exception leaves").
- **Not the target resolution.** `GatewayTarget` is built by the calling plane service
  (WP6/7/8/9) from whatever row or generated entry it already resolved; WP3 only
  evaluates the target it is handed.

## Files

New:
- `api/oss/src/core/gateways/policy/service.py` — `GatewayPolicyService`.

Edited:
- `api/oss/src/core/access/permissions/types.py` — one edit: six new `Permission`
  members plus their entries in `default_permissions()`'s per-role lists. This file has
  no other owner during wave 1 (`workstreams/README.md`'s ownership table names WP3
  explicitly), but it is a shared enum every other domain also extends — add members,
  touch nothing else in the file.

WP3 adds one construction line to `api/entrypoints/routers.py` at the M1 merge (below).

## `GatewayPolicyService` (reproduce verbatim, `entities.md` §8)

```python
class GatewayPolicyService:
    def __init__(
        self,
        *,
        resolver: SecretsResolverInterface,
    ) -> None: ...

    # --- authorization (WP3) ------------------------------------------------ #

    async def authorize(self, *, scope, permission, target) -> PolicyDecision: ...
    # scope: AuthScope; target: GatewayTarget. Permission via check_action_access
    # (core/access/permissions/service.py), fail-CLOSED. No entitlement check in
    # wave 1 (D29). Raises nothing — returns the decision; the caller raises
    # PolicyDeniedError so the audit event can record the denial before the
    # exception leaves the service.

    # --- audit + usage (WP4, D22, §2.7) ------------------------------------- #

    async def record(self, *, scope, target, decision, outcome) -> None: ...
    # One event per call, allowed or denied, built by policy/audit.py and
    # published through publish_event. Never raises — the caller's response
    # must not depend on the stream (the _safe_publish discipline).
```

The constructor takes only `resolver` — WP3 does not need `SecretsResolverInterface`
for `authorize()` or the wave-1 `record()` stub, but the seed-frozen constructor
signature already includes it (`entities.md` §8), and `entities.md` §9's wiring line is
`GatewayPolicyService(resolver=secret_resolver)`. Store it on `self`; a later package
(WP4, or a future policy concern) may need it. Do not drop the parameter to simplify the
constructor — the signature is authoritative.

## `authorize()` — implementation

```python
async def authorize(
    self, *, scope: AuthScope, permission: Permission, target: GatewayTarget,
) -> PolicyDecision:
    allowed = await check_action_access(
        user_uid=str(scope.user_id),
        project_id=str(scope.project_id),
        permission=permission,
    )
    if not allowed:
        return PolicyDecision(allowed=False, permission=permission, reason="permission_denied")

    return PolicyDecision(allowed=True, permission=permission, reason=None)
```

**There is no entitlement arm, by ruling (D29, closing R5).** Every user has both gateways, so
the check would ask a question with one answer, and what entitlements will express here are
*limits* — which cannot be enforced before anything is measured. It ships with usage metering and
billing. Do not add a placeholder key that always permits: a later reader mistakes it for
enforcement.

`check_action_access` (`core/access/permissions/service.py`) is the existing, unconditional
RBAC entry point every domain already calls — it takes `user_uid: str`, `project_id:
Optional[str]`, `permission: Optional[Permission]`, both `str`, not `UUID`; convert with
`str(...)`. It already runs the EE plan-gated RBAC bypass internally
(`check_project_has_role_or_permission`'s `is_ee()`-guarded `Flag.RBAC` check) — **that is
not the entitlement soft check this method performs separately**; it is folded inside
`check_action_access` and WP3 does not touch it.

**"Permission is fail-CLOSED"**: `check_action_access` returning `False` (including on
any internal exception it does not itself swallow) must produce `allowed=False`. Do not
wrap this call in a broad `try/except` that defaults to `True` on error — that inverts
the fail-closed requirement `entities.md` states explicitly for this half of the check.
With the entitlement arm gone (D29), fail-closed is the whole of this
method's error behaviour — there is no fail-open half left to balance it.

### What is deliberately absent: the entitlement soft check

An earlier draft of this spec carried an EE-guarded soft check with a placeholder key. **D29
removed it.** `EntitlementDeniedError` and `PolicyDecision.reason == "entitlement_denied"` stay
declared in the seed and mapped at the boundary, so the wave that adds limits changes a body
rather than a signature — but nothing in wave 1 raises either.

`check_action_access` still runs the EE plan-gated RBAC bypass internally
(`check_project_has_role_or_permission`'s `is_ee()`-guarded `Flag.RBAC` check). That is inside the
permission call and is not an entitlement check this method performs; WP3 does not touch it.

## `record()` — the wave-1 stub, ruled at kickoff (R4)

This is now a ruling, not this spec's proposal. R4 asked whether a method on the checkpoint A
hot path may be the seed's usual not-implemented default; the answer is no — **it ships as a
no-op that returns `None` and never raises.** What the seed freezes is the *call*, which every
wave 1 relay makes unconditionally on both the allow and the deny branch, so wave 2 changes a
body and never a call site.

```python
async def record(
    self, *, scope: AuthScope, target: GatewayTarget, decision: PolicyDecision, outcome: GatewayOutcome,
) -> None:
    # WP4 (wave 2) replaces this body with policy/audit.py's
    # build_gateway_call_attributes + publish_gateway_call. Wave 1 has no
    # audit.py yet (plan.md: "a record of a call that does not happen is worth
    # nothing"), but this method is on the Checkpoint A hot path — every
    # relay call in WP6/7/8/9 calls it on both the allow and deny branch — so
    # it must exist, accept the full signature, and never raise. It does
    # nothing observable in wave 1.
    return
```

Do not log at a level that could be mistaken for a working audit trail (no `log.info`
claiming an event was recorded), and do not partially implement `publish_event` here —
that duplicates WP4's file ownership of `policy/audit.py` and produces two half-built
audit paths to reconcile at the wave-2 merge. A `log.debug` noting the stub was hit is
fine; anything that looks like audit output is not.

## The six new `Permission` members and role wiring (`entities.md` §9)

```python
class Permission(str, Enum):
    ...
    # Gateway: LLM endpoints
    VIEW_LLM_ENDPOINTS = "view_llm_endpoints"
    EDIT_LLM_ENDPOINTS = "edit_llm_endpoints"
    USE_LLM_ENDPOINTS = "use_llm_endpoints"

    # Gateway: MCP endpoints
    VIEW_MCP_ENDPOINTS = "view_mcp_endpoints"
    EDIT_MCP_ENDPOINTS = "edit_mcp_endpoints"
    USE_MCP_ENDPOINTS = "use_mcp_endpoints"
```

`USE`, not `RUN`, is the data-plane verb — following `USE_MOUNTS`, because a gateway
endpoint is *used* like a mount, not *run* like a workflow or *executed* like a tool
(`entities.md` §9: *"'run' belongs to things that execute on our infrastructure; a
gateway endpoint is used"*).

**Role wiring follows the `RUN_TOOLS` precedent exactly**, inside
`Permission.default_permissions()`'s existing per-role list-building
(`core/access/permissions/types.py`, the same method that already builds
`VIEWER_PERMISSIONS`/`ANNOTATOR_PERMISSIONS`/`EDITOR_PERMISSIONS`):

- `VIEWER_PERMISSIONS` gains `VIEW_LLM_ENDPOINTS`, `VIEW_MCP_ENDPOINTS` — alongside the
  existing `VIEW_TOOLS`, `VIEW_TRIGGERS`, `VIEW_MOUNTS`.
- `ANNOTATOR_PERMISSIONS` (built as `VIEWER_PERMISSIONS + [...]`) gains
  `USE_LLM_ENDPOINTS`, `USE_MCP_ENDPOINTS` — alongside `RUN_TOOLS`, `RUN_TRIGGERS`
  (Annotator already holds `RUN_TOOLS` today, which is the precedent `entities.md` cites
  verbatim for why `USE` lands here rather than at Editor).
- `EDITOR_PERMISSIONS` (built as `ANNOTATOR_PERMISSIONS + [...]`) gains
  `EDIT_LLM_ENDPOINTS`, `EDIT_MCP_ENDPOINTS` — alongside `EDIT_TOOLS`, `EDIT_TRIGGERS`,
  `EDIT_MOUNTS`.
- `DEVELOPER_PERMISSIONS` and `ADMIN_PERMISSIONS` need no explicit addition — both are
  built as supersets of `EDITOR_PERMISSIONS` (`DEVELOPER_PERMISSIONS = EDITOR_PERMISSIONS
  + [...]`, `ADMIN_PERMISSIONS = DEVELOPER_PERMISSIONS + [...]`) and `OWNER` is `[p for p
  in cls]` (every permission) — inserting at Editor's list already propagates upward.
  Do not add the two pairs a second time to either superset list.

**Two triples, not one shared pair**, because the planes are separately governable — an
organization may grant annotators model access without tool-server access
(`entities.md` §9). Do not collapse `USE_LLM_ENDPOINTS`/`USE_MCP_ENDPOINTS` into a single
`USE_GATEWAY_ENDPOINTS`.

**Every member must be checked by a named route before this package is considered
done at the wave-1 boundary** — `entities.md` explicitly calls out `RUN_TRIGGERS` as the
counter-example not to repeat ("defined, role-wired, checked by nothing"). WP3 defines
and wires all six; WP6/WP8 (data plane) and WP10 (management CRUD) are the packages that
actually call `authorize(permission=Permission.USE_LLM_ENDPOINTS, ...)` /
`.VIEW_*`/`.EDIT_*` from their handlers. WP3's own done test (below) cannot fully close
this by itself — flag it in the merge notes for M1/M2 as a cross-package check, not
something WP3 can verify alone from its own worktree.

## Contracts this package must honour

- **Permissions and entitlements are kept distinct** — never merged into one boolean, one
  exception type, or one test (`policy.md`: *"conflating them in tests or in code is a
  known trap"*). `PolicyDecision.reason` distinguishes `"permission_denied"` from
  `"entitlement_denied"` for exactly this reason; do not use one generic `"denied"`
  string that a caller cannot map back to `PolicyDeniedError` vs `EntitlementDeniedError`.
- **`authorize()` never raises.** It is a pure decision function from the caller's point
  of view — `try`/`except` around it in a caller that expects an exception is a bug in
  the caller, not something WP3 should accommodate by raising sometimes.
- **`AuthScope` over `request.state`.** WP3 never reads `request.state.project_id` /
  `.user_id` as raw strings — every value it needs comes from the `AuthScope` its caller
  passes in. This departs from the older gateway/tools/triggers routers on purpose
  (`entities.md` §9): those re-wrap raw request state per call site, this domain does
  not.
- **No credit check, anywhere in this file.** If a task here seems to need a spend
  ceiling or the legacy credits counter, that task belongs to the post-checkpoint-C
  metering work (`plan.md` WP11/WP22), not this package.

## Tests

**Unit (no services running, run now):**
`api/oss/tests/pytest/unit/gateways/test_gateways_policy_service.py`

- `authorize()` returns `allowed=True, reason=None` when `check_action_access` returns
  `True` and the entitlement check passes — mock both.
- `authorize()` returns `allowed=False, reason="permission_denied"` when
  `check_action_access` returns `False` — and the entitlement check is **not even
  invoked** in this case (assert the mock was never called — permission is checked
  first, per the docstring order, and an unnecessary entitlement call on an already-denied
  request is wasted work at best and a confusing audit entry at worst).
- `authorize()` returns `allowed=False, reason="entitlement_denied"` when
  `check_action_access` returns `True` but `_check_entitlement` returns `False`.
- `authorize()` never raises when `check_action_access` itself raises — decide and test
  the actual behavior explicitly (either fail-closed by catching and returning
  `allowed=False`, or let it propagate — `entities.md` says "raises nothing", so the
  test should confirm the chosen implementation matches that literally: no exception
  escapes `authorize()`).
- `_check_entitlement` returns `True` unconditionally when `is_ee()` is `False` (OSS
  path) — assert the EE-only import is never attempted in this branch (no import error
  possible in OSS-only environments).
- `record()` is called with a representative `scope`/`target`/`decision`/`outcome` and
  returns without raising and without any observable side effect (no publish call, since
  `policy/audit.py` does not exist in this package's scope) — this is the test that
  guards against someone accidentally wiring a real `publish_event` call into WP3's stub
  ahead of WP4.
- `Permission.VIEW_LLM_ENDPOINTS` through `.USE_MCP_ENDPOINTS` all exist and are members
  of `Permission.default_permissions(DefaultRole.VIEWER)`,
  `.default_permissions(DefaultRole.ANNOTATOR)`, `.default_permissions(DefaultRole.EDITOR)`
  respectively, per the table above — one assertion per (role, permission) pair, six
  pairs for VIEW+USE+EDIT is really 2+2+2 = 6 checks across three roles (`VIEW_*` in
  VIEWER and everything above it, `USE_*` in ANNOTATOR and above, `EDIT_*` in EDITOR and
  above) — also assert `VIEW_LLM_ENDPOINTS` is present in `ADMIN`/`DEVELOPER`/`OWNER`'s
  lists (superset propagation) so a future refactor of the list-building order cannot
  silently drop it from an upper tier without a red test.

**Integration:** none required for this package specifically. `check_action_access`
touches the database and Redis cache (`get_cache`/`set_cache`) and `check_entitlements`
touches EE's meters/subscriptions services — both are mocked in the unit suite above, so
`GatewayPolicyService` itself needs no live dependency to test. A cross-package
acceptance test that a caller without permission is refused end-to-end belongs to
Checkpoint A's acceptance suite (`plan.md`), not to this package's own tests.

## `api/entrypoints/routers.py` diff (apply at the M1 merge)

```python
from oss.src.core.gateways.policy.service import GatewayPolicyService

gateway_policy_service = GatewayPolicyService(resolver=secret_resolver)
```

(`entities.md` §9; depends on WP2's `secret_resolver` construction landing in the
same merge — order this line after WP2's.)

## Checkpoint

Feeds **M1**, then **Checkpoint A** through every plane service (WP6/7/8/9) and the
management routers (WP10), all of which call `authorize()`.

Exit condition, verbatim from `plan.md`: *"a caller without permission on an endpoint is
refused before any upstream call."*

WP3 is done when: the unit suite above passes; `Permission` carries all six new members
correctly wired into `VIEWER`/`ANNOTATOR`/`EDITOR` (and their supersets); and
`authorize()` returns a `PolicyDecision` — never raises, never returns `None` — for every
combination of permission-allowed/denied × entitlement-allowed/denied.

## Out of scope

- `core/gateways/policy/resolution.py` — WP2.
- `core/gateways/policy/audit.py`, the real `publish_event` wiring inside `record()` —
  WP4 (wave 2).
- Anything under `core/gateways/{llms,mcps}/` — WP1, WP6, WP7, WP8, WP9.
- The routers and handlers that call `authorize()` — WP6, WP8 (data plane), WP10
  (management CRUD).
- Credit checks and spend ceilings — post-checkpoint-C metering work.

## Missing from the design, needs a ruling

- **The `PolicyDecision.reason` vocabulary.** `entities.md` §4.2 only says "denial cause,
  stable and terse" with no enumerated set of allowed strings. This spec picks
  `"permission_denied"` / `"entitlement_denied"` as the two wave-1 values because they
  are the only two failure modes `authorize()` produces, but nothing in the design
  document fixes this string set as a contract other packages (WP4's audit attribute
  builder, WP10's exception-mapping) can rely on verbatim. Flagging so WP4 (which reads
  `decision.reason` into the audit event's attributes) and WP10 (whose
  `handle_gateway_exceptions()` may want to surface it) agree on the same strings rather
  than each inventing their own.
