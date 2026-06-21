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

    def test_rename_organization(self, authed_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")
        new_name = f"renamed-{uuid4().hex[:8]}"

        response = authed_api(
            "PUT", f"/organizations/{created['id']}", json={"name": new_name}
        )
        assert response.status_code == 200, response.text
        assert response.json()["name"] == new_name

    def test_update_without_fields_returns_400(self, authed_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")

        response = authed_api("PUT", f"/organizations/{created['id']}", json={})
        assert response.status_code == 400, response.text

    def test_delete_organization(self, authed_api):
        created = _create_org(authed_api, f"org-{uuid4().hex[:8]}")

        response = authed_api("DELETE", f"/organizations/{created['id']}")
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

        response = authed_api(
            "POST", f"/organizations/{created['id']}/transfer/{target_user_id}"
        )
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
