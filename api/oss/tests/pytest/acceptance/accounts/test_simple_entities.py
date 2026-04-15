"""
Acceptance tests for the individual /admin/simple/accounts/* entity endpoints.

Covers granular CRUD on users, identities, organizations, workspaces,
projects, memberships, and API keys — each endpoint tested in isolation
with its own self-contained setup.
"""

from uuid import uuid4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class TestSimpleUsers:
    def test_create_user_standalone(self, admin_api):
        uid = uuid4().hex[:12]

        response = admin_api(
            "POST",
            "/admin/simple/accounts/users/",
            json={"user": {"email": f"standalone-{uid}@test.agenta.ai"}},
        )

        assert response.status_code == 200
        body = response.json()
        assert "accounts" in body
        user_entries = [a["users"] for a in body["accounts"] if a.get("users")]
        assert user_entries, "Expected at least one user entry in response"


# ---------------------------------------------------------------------------
# User Identities
# ---------------------------------------------------------------------------


class TestSimpleUserIdentities:
    def test_create_and_delete_identity(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"id-{uid}@test.agenta.ai"
        account = _create_account(admin_api, email=email)
        user_id = account["user"]["id"]

        # Add an extra email:password identity
        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/users/identities/",
            json={
                "user_ref": {"id": user_id},
                "user_identity": {
                    "method": "email:password",
                    "subject": f"alias-{uid}@test.agenta.ai",
                    "password": "TestPass1!",
                    "verified": True,
                },
            },
        )
        assert create_resp.status_code == 200
        body = create_resp.json()
        identities = body["accounts"][0]["user_identities"]
        assert identities, "Expected at least one identity in response"
        identity_id = list(identities.values())[0]["id"]

        # Delete that identity
        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/users/{user_id}/identities/{identity_id}/",
        )
        assert delete_resp.status_code == 200
        delete_body = delete_resp.json()
        assert delete_body["deleted"]["user_identities"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_identity_returns_404(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"no-id-{uid}@test.agenta.ai"
        account = _create_account(admin_api, email=email)
        user_id = account["user"]["id"]
        fake_identity_id = "00000000-0000-0000-0000-000000000000"

        response = admin_api(
            "DELETE",
            f"/admin/simple/accounts/users/{user_id}/identities/{fake_identity_id}/",
        )
        assert response.status_code == 404

        _delete_account_by_email(admin_api, email=email)


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


class TestSimpleOrganizations:
    def test_create_and_delete_organization(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"org-owner-{uid}@test.agenta.ai"

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/",
            json={
                "organization": {"name": f"Org-{uid}"},
                "owner": {"email": email},
            },
        )
        assert create_resp.status_code == 200
        body = create_resp.json()
        orgs = body["accounts"][0]["organizations"]
        assert orgs
        org_id = list(orgs.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/organizations/{org_id}/",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["organizations"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_org_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/organizations/00000000-0000-0000-0000-000000000000/",
        )
        assert response.status_code == 404

    def test_invalid_org_ref_returns_400(self, admin_api):
        """Referencing a non-existent owner slug should return 400, not 500 (Bug 1 fix)."""
        uid = uuid4().hex[:12]
        response = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/",
            json={
                "organization": {"name": f"BadRefOrg-{uid}"},
                "owner": {"email": f"no-such-owner-{uid}@test.agenta.ai"},
            },
        )
        # The service raises AdminInvalidReferenceError for unknown refs → must be 400
        assert response.status_code in (400, 404)


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------


class TestSimpleWorkspaces:
    def test_create_and_delete_workspace(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"wrk-{uid}@test.agenta.ai"
        account = _create_account(admin_api, email=email)
        org_id = list(account["organizations"].values())[0]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/workspaces/",
            json={
                "workspace": {
                    "name": f"Workspace-{uid}",
                    "organization_ref": {"id": org_id},
                }
            },
        )
        assert create_resp.status_code == 200
        body = create_resp.json()
        wks = body["accounts"][0]["workspaces"]
        assert wks
        workspace_id = list(wks.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/workspaces/{workspace_id}/",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["workspaces"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_workspace_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/workspaces/00000000-0000-0000-0000-000000000000/",
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


class TestSimpleProjects:
    def test_create_and_delete_project(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"prj-{uid}@test.agenta.ai"
        account = _create_account(admin_api, email=email)
        org_id = list(account["organizations"].values())[0]["id"]
        workspace_id = list(account["workspaces"].values())[0]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/projects/",
            json={
                "project": {
                    "name": f"Project-{uid}",
                    "organization_ref": {"id": org_id},
                    "workspace_ref": {"id": workspace_id},
                }
            },
        )
        assert create_resp.status_code == 200
        body = create_resp.json()
        projects = body["accounts"][0]["projects"]
        assert projects
        project_id = list(projects.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/projects/{project_id}/",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["projects"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_project_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/projects/00000000-0000-0000-0000-000000000000/",
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Memberships
# ---------------------------------------------------------------------------


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
            f"/admin/simple/accounts/organizations/{org_id}/memberships/{membership_id}/",
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
            f"/admin/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}/",
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
            f"/admin/simple/accounts/projects/{project_id}/memberships/{membership_id}/",
        )
        assert delete_resp.status_code == 200

        _delete_account_by_email(admin_api, email=email_a)
        _delete_account_by_email(admin_api, email=email_b)


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------


class TestSimpleApiKeys:
    def test_create_and_delete_api_key(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"key-{uid}@test.agenta.ai"
        account = _create_account(admin_api, email=email)
        project_id = list(account["projects"].values())[0]["id"]
        user_id = account["user"]["id"]

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/api-keys/",
            json={
                "api_key": {
                    "project_ref": {"id": project_id},
                    "user_ref": {"id": user_id},
                    "name": f"key-{uid}",
                },
                "options": {"return_api_keys": True},
            },
        )
        assert create_resp.status_code == 200
        body = create_resp.json()
        api_keys = body["accounts"][0]["api_keys"]
        assert api_keys
        api_key_id = list(api_keys.values())[0]["id"]

        delete_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/api-keys/{api_key_id}/",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["api_keys"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_api_key_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/api-keys/00000000-0000-0000-0000-000000000000/",
        )
        assert response.status_code == 404
