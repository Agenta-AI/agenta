"""
Acceptance tests for the OSS organization endpoints
(create / rename / transfer / delete on /organizations/).

EE serves the same paths from its own router with RBAC and entitlement
gates; those are covered by the EE suites.
"""

from uuid import uuid4

import pytest


def _create_org(authed_api, name):
    response = authed_api("POST", "/organizations/", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _create_member_account(admin_api, *, email):
    response = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {"seed_defaults": False},
                }
            }
        },
    )
    assert response.status_code == 200, response.text
    return next(iter(response.json()["accounts"].values()))


def _owner_key_headers(authed_api, admin_api, organization_id):
    """An API key of the organization's default project for its owner.

    An organization-level write by an API key must come from that organization's
    default project. The account's own key belongs to its first organization, so a
    write on an organization created here needs a key of the new one.
    """
    projects = authed_api("GET", "/projects/")
    assert projects.status_code == 200, projects.text
    candidates = [
        p for p in projects.json() if p["organization_id"] == str(organization_id)
    ]
    assert candidates, projects.text
    project = next((p for p in candidates if p["is_default_project"]), candidates[0])

    details = authed_api("GET", f"/organizations/{organization_id}")
    assert details.status_code == 200, details.text

    response = admin_api(
        "POST",
        "/admin/simple/accounts/api-keys/",
        json={
            "options": {"return_api_keys": True},
            "api_key": {
                "project_ref": {"id": project["project_id"]},
                "user_ref": {"id": details.json()["owner_id"]},
            },
        },
    )
    assert response.status_code == 200, response.text
    account = response.json()["accounts"][0]
    key = next(iter(account["api_keys"].values()))["value"]
    return {"Authorization": f"ApiKey {key}"}


@pytest.mark.usefixtures("cls_account")
class TestOrganizationLifecycle:
    def test_create_organization(self, authed_api):
        name = f"org-{uuid4().hex[:8]}"

        body = _create_org(authed_api, name)

        assert body["id"]
        assert body["name"] == name

    def test_created_organization_is_listed(self, authed_api):
        name = f"org-{uuid4().hex[:8]}"
        created = _create_org(authed_api, name)

        response = authed_api("GET", "/organizations/")
        assert response.status_code == 200, response.text
        listed_ids = {organization["id"] for organization in response.json()}
        assert created["id"] in listed_ids

    def test_rename_organization(self, authed_api, admin_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")
        new_name = f"renamed-{uuid4().hex[:8]}"
        path = f"/organizations/{created['id']}"

        # A key of another organization's project is refused.
        refused = authed_api("PUT", path, json={"name": new_name})
        assert refused.status_code == 403, refused.text

        headers = _owner_key_headers(authed_api, admin_api, created["id"])
        response = admin_api("PUT", path, json={"name": new_name}, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["name"] == new_name

    def test_update_without_fields_returns_400(self, authed_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")

        response = authed_api("PUT", f"/organizations/{created['id']}", json={})
        assert response.status_code == 400, response.text

    def test_delete_organization(self, authed_api, admin_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")
        path = f"/organizations/{created['id']}"

        refused = authed_api("DELETE", path)
        assert refused.status_code == 403, refused.text

        headers = _owner_key_headers(authed_api, admin_api, created["id"])
        response = admin_api("DELETE", path, headers=headers)
        assert response.status_code == 200, response.text

        listing = authed_api("GET", "/organizations/")
        listed_ids = {organization["id"] for organization in listing.json()}
        assert created["id"] not in listed_ids

    def test_transfer_organization_ownership(self, authed_api, admin_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")
        email = f"transfer-target-{uuid4().hex[:8]}@test.agenta.ai"
        target = _create_member_account(admin_api, email=email)
        target_user_id = target["user"]["id"]

        membership = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/memberships/",
            json={
                "membership": {
                    "organization_ref": {"id": created["id"]},
                    "user_ref": {"id": target_user_id},
                    "role": "viewer",
                }
            },
        )
        assert membership.status_code == 200, membership.text

        path = f"/organizations/{created['id']}/transfer/{target_user_id}"
        refused = authed_api("POST", path)
        assert refused.status_code == 403, refused.text
        # The caller is the owner: the refusal is the key rule's, as for the other
        # organization writes.
        assert refused.json()["detail"] == (
            "You do not have permission to perform this action"
        )

        headers = _owner_key_headers(authed_api, admin_api, created["id"])
        response = admin_api("POST", path, headers=headers)
        assert response.status_code == 200, response.text
        assert response.json()["owner_id"] == target_user_id

    def test_transfer_to_non_member_is_rejected(self, authed_api, admin_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")
        email = f"non-member-{uuid4().hex[:8]}@test.agenta.ai"
        outsider = _create_member_account(admin_api, email=email)
        outsider_user_id = outsider["user"]["id"]

        response = authed_api(
            "POST", f"/organizations/{created['id']}/transfer/{outsider_user_id}"
        )
        assert response.status_code != 200 or "owner_id" not in response.json()
