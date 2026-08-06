"""Cross-edition RBAC enforcement (OSS).

RBAC now enforces in OSS (it used to be allow-all). These tests assert the
behavior flip on a management endpoint:

  - the org owner (owner role) is ALLOWED to invite/remove workspace members,
  - a viewer member is DENIED (403) the same action.

The EE suite mirrors this with an entitled business account; see
ee/tests/pytest/acceptance/accounts/test_rbac_enforcement_ee.py.
"""

from uuid import uuid4


def _create_account(admin_api, *, email):
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": True,
                    },
                }
            }
        },
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
    """Mint an API key for `user_id` scoped to `project_id`.

    API keys are project-scoped: the key fixes `request.state.project_id`. To
    test enforcement of a member against the OWNER's project, the member needs a
    key in that project (their own default-project key would scope elsewhere).
    """
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


class TestRbacEnforcementOss:
    def test_owner_allowed_viewer_denied_member_removal(self, admin_api):
        uid = uuid4().hex[:12]
        owner_email = f"rbac-owner-{uid}@test.agenta.ai"
        viewer_email = f"rbac-viewer-{uid}@test.agenta.ai"
        target_email = f"rbac-target-{uid}@agenta.ai"

        owner = _create_account(admin_api, email=owner_email)
        viewer = _create_account(admin_api, email=viewer_email)

        organization_id = _first_id(owner["organizations"])
        workspace_id = _first_id(owner["workspaces"])
        project_id = _first_id(owner["projects"])
        viewer_user_id = viewer["user"]["id"]

        owner_headers = {"Authorization": f"ApiKey {_api_key(owner)}"}

        try:
            # Make the second user a VIEWER in the owner's project, then mint an
            # API key for them scoped to that project so enforcement runs there.
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

            params = {
                "project_id": project_id,
                "organization_id": organization_id,
            }

            # Owner invites a pending user — ALLOWED (owner has ADD_USER_TO_WORKSPACE).
            invite_resp = admin_api(
                "POST",
                f"/organizations/{organization_id}/workspaces/{workspace_id}/invite",
                params={"project_id": project_id},
                headers=owner_headers,
                json=[{"email": target_email, "roles": ["viewer"]}],
            )
            assert invite_resp.status_code == 200, invite_resp.text

            # Viewer tries to remove that member — DENIED (needs ADMIN role).
            viewer_remove = admin_api(
                "DELETE",
                f"/workspaces/{workspace_id}/users",
                params={**params, "email": target_email},
                headers=viewer_headers,
            )
            assert viewer_remove.status_code == 403, viewer_remove.text

            # Owner removes the member — ALLOWED.
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

    def test_viewer_denied_invite(self, admin_api):
        uid = uuid4().hex[:12]
        owner_email = f"rbac2-owner-{uid}@test.agenta.ai"
        viewer_email = f"rbac2-viewer-{uid}@test.agenta.ai"
        target_email = f"rbac2-target-{uid}@agenta.ai"

        owner = _create_account(admin_api, email=owner_email)
        viewer = _create_account(admin_api, email=viewer_email)

        organization_id = _first_id(owner["organizations"])
        workspace_id = _first_id(owner["workspaces"])
        project_id = _first_id(owner["projects"])
        viewer_user_id = viewer["user"]["id"]

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

            # Viewer tries to invite — DENIED (needs ADD_USER_TO_WORKSPACE).
            viewer_invite = admin_api(
                "POST",
                f"/organizations/{organization_id}/workspaces/{workspace_id}/invite",
                params={"project_id": project_id},
                headers=viewer_headers,
                json=[{"email": target_email, "roles": ["viewer"]}],
            )
            assert viewer_invite.status_code == 403, viewer_invite.text
        finally:
            _delete_account_by_email(admin_api, email=owner_email)
            _delete_account_by_email(admin_api, email=viewer_email)
