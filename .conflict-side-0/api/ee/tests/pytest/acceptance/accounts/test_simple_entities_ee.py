"""
EE-only acceptance tests for /admin/simple/accounts/* entity endpoints
that depend on multi-tenant org/workspace creation.

On OSS the singleton invariant collapses these flows:
admin_create_organization always returns the singleton row, and the
delete handlers refuse to remove the singleton — so the create / delete
round-trip these tests perform only makes sense on EE.
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


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


class TestSimpleOrganizations:
    def test_create_and_delete_organization(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"org-owner-{uid}@test.agenta.ai"

        # Owner must exist before creating an organization
        user_resp = admin_api(
            "POST",
            "/admin/simple/accounts/users/",
            json={"user": {"email": email}},
        )
        assert user_resp.status_code == 200

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
            f"/admin/simple/accounts/organizations/{org_id}",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["organizations"]

        _delete_account_by_email(admin_api, email=email)

    def test_invalid_org_ref_returns_400(self, admin_api):
        """Referencing a non-existent owner slug should return 400, not 500."""
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
            f"/admin/simple/accounts/workspaces/{workspace_id}",
        )
        assert delete_resp.status_code == 200
        assert delete_resp.json()["deleted"]["workspaces"]

        _delete_account_by_email(admin_api, email=email)
