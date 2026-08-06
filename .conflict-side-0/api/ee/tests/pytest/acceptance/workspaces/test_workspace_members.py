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


def _member_emails(org_details):
    return {
        member["user"]["email"]
        for member in org_details["default_workspace"].get("members", [])
    }


class TestWorkspaceMembers:
    def test_remove_pending_workspace_invitation(self, admin_api):
        uid = uuid4().hex[:12]
        owner_email = f"owner-{uid}@test.agenta.ai"
        invite_email = f"pending-{uid}@agenta.ai"

        account = _create_account(admin_api, email=owner_email)
        organization_id = _first_id(account["organizations"])
        workspace_id = _first_id(account["workspaces"])
        project_id = _first_id(account["projects"])
        headers = {"Authorization": f"ApiKey {_api_key(account)}"}

        try:
            invite_resp = admin_api(
                "POST",
                f"/organizations/{organization_id}/workspaces/{workspace_id}/invite",
                params={"project_id": project_id},
                headers=headers,
                json=[{"email": invite_email, "roles": ["viewer"]}],
            )
            assert invite_resp.status_code == 200, invite_resp.text

            org_resp = admin_api(
                "GET",
                f"/organizations/{organization_id}",
                params={"project_id": project_id},
                headers=headers,
            )
            assert org_resp.status_code == 200, org_resp.text
            assert invite_email in _member_emails(org_resp.json())

            remove_resp = admin_api(
                "DELETE",
                f"/workspaces/{workspace_id}/users",
                params={
                    "project_id": project_id,
                    "organization_id": organization_id,
                    "email": invite_email,
                },
                headers=headers,
            )
            assert remove_resp.status_code == 200, remove_resp.text
            assert remove_resp.json() is True

            refreshed_resp = admin_api(
                "GET",
                f"/organizations/{organization_id}",
                params={"project_id": project_id},
                headers=headers,
            )
            assert refreshed_resp.status_code == 200, refreshed_resp.text
            assert invite_email not in _member_emails(refreshed_resp.json())
        finally:
            _delete_account_by_email(admin_api, email=owner_email)
