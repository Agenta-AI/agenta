"""Cross-edition RBAC enforcement (EE).

Mirrors oss/tests/pytest/acceptance/accounts/test_rbac_enforcement.py with a
business-plan account (pinned so enforcement runs deterministically). Asserts:

  - the org owner is ALLOWED to invite/remove workspace members,
  - a viewer member is DENIED (403) the same action.

This suite covers permissions only. The EE entitlement gate (the
`Flag.RBAC`-not-entitled allow-all bypass) is an entitlements concern and is
exercised by the entitlements suite, not here — permissions and entitlements
are tested independently.
"""

from uuid import uuid4


def _create_account(admin_api, *, email, plan=None):
    """Create a seeded account, optionally pinned to a subscription plan.

    The plan is pinned explicitly (rather than relying on the default) so the
    RBAC entitlement is deterministic regardless of whether Stripe is enabled
    in the test environment.
    """
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": True,
        },
    }
    if plan is not None:
        account["subscription"] = {"plan": plan}

    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={"accounts": {"u": account}},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["accounts"]["u"]


def _delete_account_by_email(admin_api, *, email):
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


def _first_id(values):
    return next(iter(values.values()))["id"]


def _api_key(account):
    return account["api_keys"]["key"]


def _add_project_member(admin_api, *, project_id, user_id, role):
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/projects/memberships/",
        json={
            "membership": {
                "project_ref": {"id": project_id},
                "user_ref": {"id": user_id},
                "role": role,
            }
        },
    )
    assert resp.status_code == 200, resp.text


def _create_api_key_for_project(admin_api, *, project_id, user_id):
    """Mint an API key for `user_id` scoped to `project_id` (keys are
    project-scoped, so a member needs a key in the OWNER's project to be tested
    against it)."""
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/api-keys/",
        json={
            "options": {"return_api_keys": True},
            "api_key": {
                "project_ref": {"id": project_id},
                "user_ref": {"id": user_id},
            },
        },
    )
    assert resp.status_code == 200, resp.text
    account = resp.json()["accounts"][0]
    api_key = next(iter(account["api_keys"].values()))
    return api_key["value"]


class TestRbacEnforcementEe:
    def test_owner_allowed_viewer_denied(self, admin_api):
        uid = uuid4().hex[:12]
        owner_email = f"rbac-ee-owner-{uid}@test.agenta.ai"
        viewer_email = f"rbac-ee-viewer-{uid}@test.agenta.ai"
        target_email = f"rbac-ee-target-{uid}@agenta.ai"

        owner = _create_account(admin_api, email=owner_email, plan="cloud_v0_business")
        viewer = _create_account(admin_api, email=viewer_email)

        organization_id = _first_id(owner["organizations"])
        workspace_id = _first_id(owner["workspaces"])
        project_id = _first_id(owner["projects"])
        viewer_user_id = viewer["user"]["id"]

        owner_headers = {"Authorization": f"ApiKey {_api_key(owner)}"}

        try:
            _add_project_member(
                admin_api,
                project_id=project_id,
                user_id=viewer_user_id,
                role="viewer",
            )
            viewer_key = _create_api_key_for_project(
                admin_api, project_id=project_id, user_id=viewer_user_id
            )
            viewer_headers = {"Authorization": f"ApiKey {viewer_key}"}

            params = {"project_id": project_id, "organization_id": organization_id}

            invite_resp = admin_api(
                "POST",
                f"/organizations/{organization_id}/workspaces/{workspace_id}/invite",
                params={"project_id": project_id},
                headers=owner_headers,
                json=[{"email": target_email, "roles": ["viewer"]}],
            )
            assert invite_resp.status_code == 200, invite_resp.text

            # Enforcement runs → viewer is denied.
            viewer_remove = admin_api(
                "DELETE",
                f"/workspaces/{workspace_id}/users",
                params={**params, "email": target_email},
                headers=viewer_headers,
            )
            assert viewer_remove.status_code == 403, viewer_remove.text

            owner_remove = admin_api(
                "DELETE",
                f"/workspaces/{workspace_id}/users",
                params={**params, "email": target_email},
                headers=owner_headers,
            )
            assert owner_remove.status_code == 200, owner_remove.text
        finally:
            _delete_account_by_email(admin_api, email=owner_email)
            _delete_account_by_email(admin_api, email=viewer_email)
