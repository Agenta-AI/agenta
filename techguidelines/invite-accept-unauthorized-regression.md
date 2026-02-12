# Invitation Accept Returns Unauthorized (Regression)

GitHub issue: [#3739](https://github.com/Agenta-AI/agenta/issues/3739)

## Summary

Users cannot accept workspace invitations. The API returns `{"detail": "Unauthorized"}` before the invite-accept handler ever runs. The regression was introduced in PR [#3680](https://github.com/Agenta-AI/agenta/pull/3680) and shipped in `v0.85.2`.

## Root Cause

PR #3680 added a membership check inside `verify_bearer_token` (`api/oss/src/services/auth_service.py:525`). When a request includes a `project_id` or `workspace_id` query parameter, the middleware now verifies that the authenticated user belongs to that project or workspace. If the user is not a member, the middleware raises `UnauthorizedException` at line 546 and caches a `deny` entry.

This is a valid security fix (IDOR prevention). However, it did not account for the invite-accept flow. Invite-accept requests include `project_id` in the query string (see `web/oss/src/services/workspace/api/index.ts:129`). The invited user is, by definition, not yet a member. So the membership gate rejects them before the route handler (`api/oss/src/routers/organization_router.py:330`) can process the invitation.

Note that there is already a bypass for invitation routes in `_check_organization_policy` (line 814). That bypass handles org-level auth policy enforcement. But the membership check in `verify_bearer_token` is a separate gate and has no equivalent bypass.

### Two commits introduced this

1. `f47a93c0e7` (Feb 9, 16:18 UTC+1): Added project membership verification when `query_project_id` is present.
2. `84abf751e8` (Feb 9, 16:35 UTC+1): Extended the check to also cover `query_workspace_id`.

Both belong to PR #3680, merged Feb 10 into `release/v0.85.2`.

### Additional concern: deny cache poisoning

When the membership check fails, the middleware caches `{"deny": True}` for the user+project+workspace combination (line 538). This means a single failed invite-accept attempt permanently blocks the user for that project, even after a fix is deployed, until the cache entry expires.

## Suggested Fix

Skip the membership check when the request targets an invitation route. This preserves the IDOR protection for all other endpoints.

In `verify_bearer_token` (`api/oss/src/services/auth_service.py`), wrap the membership block with a path check:

```python
# Existing invitation path patterns (same list used in _check_organization_policy)
_INVITATION_PATHS = ("/invite/accept",)

# ... inside verify_bearer_token, around line 525:

is_invite_route = any(p in request.url.path for p in _INVITATION_PATHS)

if is_ee() and (query_project_id or query_workspace_id) and not is_invite_route:
    if query_project_id:
        is_member = await db_manager_ee.project_member_exists(
            project_id=project_id,
            user_id=user_id,
        )
    else:
        is_member = await db_manager_ee.workspace_member_exists(
            workspace_id=workspace_id,
            user_id=user_id,
        )

    if not is_member:
        await set_cache(
            project_id=query_project_id,
            user_id=user_id,
            namespace="verify_bearer_token",
            key=cache_key,
            value={"deny": True},
        )
        raise UnauthorizedException()
```

The only change is the `and not is_invite_route` guard. All non-invitation endpoints keep the full membership check.

### Why this is safe

The invite-accept route handler already validates the invitation token, checks expiration, and verifies the user's email against the invitation record (`api/ee/src/services/workspace_manager.py:366`). A user cannot exploit this bypass to access arbitrary projects; they can only complete a valid, unexpired invitation addressed to their email.

### Deployment note

After deploying this fix, previously affected users may still be blocked by cached `deny` entries. Either flush the `verify_bearer_token` cache namespace for those users, or wait for natural cache expiry.
