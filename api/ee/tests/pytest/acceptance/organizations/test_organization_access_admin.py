"""Organization domains and SSO providers need an org owner or admin (EE).

Asserts:

  - a viewer member gets 403 on the provider and domain routes,
  - the owner can create a provider, and the provider starts invalid and
    inactive even when the request sets those flags.
"""

from uuid import uuid4


def _create_account(admin_api, *, email, plan=None):
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


def _add_organization_member(admin_api, *, organization_id, user_id, role):
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/organizations/memberships/",
        json={
            "membership": {
                "organization_ref": {"id": organization_id},
                "user_ref": {"id": user_id},
                "role": role,
            }
        },
    )
    assert resp.status_code == 200, resp.text


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


def _provider_payload(slug):
    return {
        "slug": slug,
        "name": "Test provider",
        "flags": {"is_active": True, "is_valid": True},
        "settings": {
            "issuer_url": "https://idp.test.agenta.ai",
            "client_id": "client-id",
            "client_secret": "client-secret",
        },
    }


class TestOrganizationAccessAdmin:
    def test_viewer_denied_owner_allowed(self, admin_api):
        uid = uuid4().hex[:12]
        # Provider slugs allow only lowercase letters and hyphens.
        slug = "".join(chr(ord("a") + int(c, 16)) for c in uid)
        owner_email = f"org-admin-owner-{uid}@test.agenta.ai"
        viewer_email = f"org-admin-viewer-{uid}@test.agenta.ai"

        owner = _create_account(admin_api, email=owner_email, plan="cloud_v0_business")
        viewer = _create_account(admin_api, email=viewer_email)

        organization_id = _first_id(owner["organizations"])
        project_id = _first_id(owner["projects"])
        params = {"project_id": project_id}

        try:
            _add_organization_member(
                admin_api,
                organization_id=organization_id,
                user_id=viewer["user"]["id"],
                role="viewer",
            )
            _add_project_member(
                admin_api,
                project_id=project_id,
                user_id=viewer["user"]["id"],
                role="viewer",
            )
            viewer_key = _create_api_key_for_project(
                admin_api, project_id=project_id, user_id=viewer["user"]["id"]
            )
            viewer_headers = {"Authorization": f"ApiKey {viewer_key}"}
            owner_headers = {
                "Authorization": f"ApiKey {owner['api_keys']['key']}",
            }

            viewer_create = admin_api(
                "POST",
                "/organizations/providers/",
                params=params,
                headers=viewer_headers,
                json=_provider_payload(f"viewer-{slug}"),
            )
            assert viewer_create.status_code == 403, viewer_create.text

            viewer_list = admin_api(
                "GET",
                "/organizations/providers/",
                params=params,
                headers=viewer_headers,
            )
            assert viewer_list.status_code == 403, viewer_list.text

            viewer_domain = admin_api(
                "POST",
                "/organizations/domains/",
                params=params,
                headers=viewer_headers,
                json={"domain": f"{uid}.test.agenta.ai"},
            )
            assert viewer_domain.status_code == 403, viewer_domain.text

            # Provider changes need a non-SSO login method on the organization.
            flags_resp = admin_api(
                "PATCH",
                f"/organizations/{organization_id}",
                params=params,
                headers=owner_headers,
                json={"flags": {"allow_email": True}},
            )
            assert flags_resp.status_code == 200, flags_resp.text

            owner_create = admin_api(
                "POST",
                "/organizations/providers/",
                params=params,
                headers=owner_headers,
                json=_provider_payload(f"owner-{slug}"),
            )
            assert owner_create.status_code in (200, 201), owner_create.text
            provider = owner_create.json()
            assert provider["organization_id"] == organization_id
            assert provider["flags"]["is_valid"] is False
            assert provider["flags"]["is_active"] is False

            # A client cannot turn on a provider that no test marked valid.
            owner_update = admin_api(
                "PATCH",
                f"/organizations/providers/{provider['id']}",
                params=params,
                headers=owner_headers,
                json={"flags": {"is_active": True, "is_valid": True}},
            )
            assert owner_update.status_code == 200, owner_update.text
            assert owner_update.json()["flags"]["is_valid"] is False
            assert owner_update.json()["flags"]["is_active"] is False
        finally:
            _delete_account_by_email(admin_api, email=viewer_email)
            _delete_account_by_email(admin_api, email=owner_email)
