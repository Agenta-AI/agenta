# Platform Admin Implementation Notes

Status: in-progress
Last updated: 2026-04-14

Tracks implementation decisions, gaps, and differences between
[contracts.md](contracts.md) and the code in
`api/oss/src/core/platform_admin/accounts/` and
`api/oss/src/apis/fastapi/platform_admin/accounts/`.

---

## Resolved

### B-1 — api_keys ref key was "default_key" instead of "key" (FIXED)

`graph_dto.api_keys` was keyed as `{"default_key": ...}` in both
`_create_one_simple_account` and `create_user`. Renamed to `"key"` so the
`accounts.py` fixture assertion `api_keys["key"]` resolves correctly.

### R-1 — Test fixtures used flat single-account shape (FIXED)

The three `utils/accounts.py` test fixtures (api, sdk, services) were sending
`{user: {...}, options: {...}}` directly. Updated to the batch format the endpoint
actually expects:

```json
{
  "accounts": {
    "user": {
      "user": {"email": "..."},
      "options": {"create_api_keys": true, "return_api_keys": true, "seed_defaults": true}
    }
  }
}
```

### R-2 — contracts.md had wrong reset-password path and DTO (FIXED)

Contracts previously described `POST .../users/{user_id}/reset-password` with
`{reason?, notify_user?}`. Implementation uses a flat path
`POST /admin/simple/accounts/reset-password` with
`{user_identities: AdminUserIdentityCreate[]}`. The contract now matches the code.

### R-3 — organizations field was List, examples.http showed Dict (FIXED)

`AdminSimpleAccountsOrganizationsTransferOwnershipDTO.organizations` was
`Optional[List[EntityRef]]`. Changed to `Optional[Dict[str, EntityRef]]` to match
the keyed-map style shown in `examples.http` and used everywhere else. The
`transfer_ownership` service method was updated to iterate `.items()` and use the
key in error messages. The contract was updated to reflect the dict shape.

### R-4 — DELETE /admin/simple/accounts/users/{user_id}/ (PENDING)

The `delete_user` service method is complete. The route is not yet registered in
`router.py`. The contract already documents this route correctly. A test needs to be
added when the route is wired up.

### E-1 — No EE subscription provisioned on org creation (FIXED)

After `_db_create_organization`, the service now calls
`_ee_subscription_service.start_plan(organization_id, get_default_plan())` when
`_EE_AVAILABLE`. Failures are non-fatal: a `subscription_provision_failed`
structured error is appended to the response and the org record is kept.

Imports added to the EE try/except block:
`SubscriptionsService`, `SubscriptionsDAO`, `get_default_plan`.

### E-2 — No default owner memberships in simple account creation (FIXED)

`_create_one_simple_account` now automatically injects `owner` role memberships for
org, workspace, and project when `is_ee()` and no explicit memberships are provided.
Explicit memberships in the entry still take precedence. This matches the behaviour
of `commoners.py::create_organization_for_signup`.

---

## Open / Deferred

### R-4 — DELETE /admin/simple/accounts/users/{user_id}/ (PENDING)

The `delete_user` service method is complete. The route is not yet registered in
`router.py`. The contract already documents this route correctly. A test needs to be
added when the route is wired up.

### M-1 — accounts response key is always "user" for single-account calls

`create_simple_accounts` keys the response by whatever `AccountRef` the caller
uses. For the typical single-account fixture call the key is `"user"`. The fixture
uses `next(iter(accounts.values()))` so any stable key works. No action needed
unless a deterministic key is required by a specific consumer.

### M-2 — _user_db_to_read_dto maps name from username

`_user_db_to_read_dto` sets `name=user.username`. If `UserDB` gains a separate
`name` column this should be updated. Low priority — cosmetic only.

---

## Staged File Review

| File | Change | Notes |
|---|---|---|
| `core/platform_admin/accounts/service.py` | New + revised | E-1, E-2, R-3 dict iteration, B-1 key fix applied. |
| `core/platform_admin/accounts/dtos.py` | New + revised | R-3: organizations changed to `Dict[str, EntityRef]`. |
| `core/platform_admin/accounts/errors.py` | New | No issues. |
| `apis/fastapi/platform_admin/accounts/router.py` | New + revised | R-4 route + handler added. |
| `apis/fastapi/platform_admin/accounts/models.py` | New | Re-exports only; inherits DTO fixes. |
| `services/db_manager.py` | Modified | New `admin_*` helpers. No issues. |
| `ee/src/services/db_manager_ee.py` | Modified | New `admin_*` membership/transfer helpers. No issues. |
| `entrypoints/routers.py` | Modified | Router mounting. No issues. |
| `api/oss/tests/pytest/utils/accounts.py` | New + revised | R-1 batch format applied. |
| `sdk/oss/tests/pytest/utils/accounts.py` | New + revised | R-1 batch format applied. |
| `services/oss/tests/pytest/utils/accounts.py` | New + revised | R-1 batch format applied. |
| `docs/designs/platform-admin/contracts.md` | Modified | R-2, R-3 DTO shapes and route paths corrected. R-4 route row updated. |
| `docs/designs/platform-admin/examples.http` | New | Shows batch create, reset-password, transfer-ownership, delete flows. |
