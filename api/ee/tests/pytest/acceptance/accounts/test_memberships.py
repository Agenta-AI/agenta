"""
Acceptance tests for EE-only membership endpoints under /admin/simple/accounts/.

Organization, workspace, and project memberships are an EE feature; in OSS
the endpoints return 501.
"""

from uuid import uuid4


def _create_account(admin_api, *, email):
    """Create a minimal account and return the parsed body."""
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {"user": {"email": email}, "options": {"seed_defaults": True}}
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


class TestSimpleMemberships:
    def test_create_and_delete_org_membership(self, admin_api):
        uid = uuid4().hex[:12]
        email_a = f"mem-a-{uid}@test.agenta.ai"
        email_b = f"mem-b-{uid}@test.agenta.ai"
        account_a = _create_account(admin_api, email=email_a)
        account_b = _create_account(admin_api, email=email_b)
        org_id = list(account_a["organizations"].values())[0]["id"]
        user_b_id = account_b["user"]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/memberships/",
            json={
                "membership": {
                    "organization_ref": {"id": org_id},
                    "user_ref": {"id": user_b_id},
                    "role": "member",
                }
            },
        )
        assert create_resp.status_code == 200
        memberships = create_resp.json()["accounts"][0]["organization_memberships"]
        assert memberships
        membership_id = list(memberships.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/organizations/{org_id}/memberships/{membership_id}",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["organization_memberships"]

        _delete_account_by_email(admin_api, email=email_a)
        _delete_account_by_email(admin_api, email=email_b)

    def test_create_and_delete_workspace_membership(self, admin_api):
        uid = uuid4().hex[:12]
        email_a = f"wm-a-{uid}@test.agenta.ai"
        email_b = f"wm-b-{uid}@test.agenta.ai"
        account_a = _create_account(admin_api, email=email_a)
        account_b = _create_account(admin_api, email=email_b)
        workspace_id = list(account_a["workspaces"].values())[0]["id"]
        user_b_id = account_b["user"]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/workspaces/memberships/",
            json={
                "membership": {
                    "workspace_ref": {"id": workspace_id},
                    "user_ref": {"id": user_b_id},
                    "role": "viewer",
                }
            },
        )
        assert create_resp.status_code == 200
        memberships = create_resp.json()["accounts"][0]["workspace_memberships"]
        assert memberships
        membership_id = list(memberships.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}",
        )
        assert delete_resp.status_code == 200

        _delete_account_by_email(admin_api, email=email_a)
        _delete_account_by_email(admin_api, email=email_b)

    def test_create_and_delete_project_membership(self, admin_api):
        uid = uuid4().hex[:12]
        email_a = f"pm-a-{uid}@test.agenta.ai"
        email_b = f"pm-b-{uid}@test.agenta.ai"
        account_a = _create_account(admin_api, email=email_a)
        account_b = _create_account(admin_api, email=email_b)
        project_id = list(account_a["projects"].values())[0]["id"]
        user_b_id = account_b["user"]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/projects/memberships/",
            json={
                "membership": {
                    "project_ref": {"id": project_id},
                    "user_ref": {"id": user_b_id},
                    "role": "viewer",
                }
            },
        )
        assert create_resp.status_code == 200
        memberships = create_resp.json()["accounts"][0]["project_memberships"]
        assert memberships
        membership_id = list(memberships.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/projects/{project_id}/memberships/{membership_id}",
        )
        assert delete_resp.status_code == 200

        _delete_account_by_email(admin_api, email=email_a)
        _delete_account_by_email(admin_api, email=email_b)
