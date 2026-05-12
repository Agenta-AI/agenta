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
            f"/admin/simple/accounts/users/{user_id}/identities/{identity_id}",
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
            f"/admin/simple/accounts/users/{user_id}/identities/{fake_identity_id}",
        )
        assert response.status_code == 404

        _delete_account_by_email(admin_api, email=email)


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


class TestSimpleOrganizations:
    # Create / delete round-trip moved to EE: on OSS the singleton
    # invariant collapses admin_create_organization onto a fixed slug
    # and the delete handler refuses to remove it. See
    # api/ee/tests/pytest/acceptance/accounts/test_simple_entities_ee.py.

    def test_delete_nonexistent_org_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/organizations/00000000-0000-0000-0000-000000000000",
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Workspaces
# ---------------------------------------------------------------------------


class TestSimpleWorkspaces:
    # Create / delete round-trip moved to EE: on OSS the singleton
    # workspace under the singleton org is itself a singleton and the
    # delete handler refuses to remove it. See
    # api/ee/tests/pytest/acceptance/accounts/test_simple_entities_ee.py.

    def test_delete_nonexistent_workspace_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/workspaces/00000000-0000-0000-0000-000000000000",
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
            f"/admin/simple/accounts/projects/{project_id}",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["projects"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_project_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/projects/00000000-0000-0000-0000-000000000000",
        )
        assert response.status_code == 404


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
            f"/admin/simple/accounts/api-keys/{api_key_id}",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["api_keys"]

        _delete_account_by_email(admin_api, email=email)

    def test_delete_nonexistent_api_key_returns_404(self, admin_api):
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/api-keys/00000000-0000-0000-0000-000000000000",
        )
        assert response.status_code == 404
