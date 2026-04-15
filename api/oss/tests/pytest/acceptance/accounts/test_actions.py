"""
Acceptance tests for admin RPC actions:
  - POST /admin/simple/accounts/reset-password
  - POST /admin/simple/accounts/transfer-ownership

Also covers the Bug 2 regression: after transfer-ownership the source
user can be deleted without destroying the target user's organization.
"""

from uuid import uuid4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_account(admin_api, *, email):
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "user_identities": [
                        {
                            "method": "email:password",
                            "subject": email,
                            "password": "DefaultPass1!",
                        }
                    ],
                    "options": {"seed_defaults": True, "create_identities": True},
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


# ---------------------------------------------------------------------------
# reset-password
# ---------------------------------------------------------------------------


class TestResetPassword:
    def test_reset_password_for_existing_identity(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"reset-{uid}@test.agenta.ai"
        _create_account(admin_api, email=email)

        response = admin_api(
            "POST",
            "/admin/simple/accounts/reset-password",
            json={
                "user_identities": [
                    {
                        "method": "email:password",
                        "subject": email,
                        "password": "NewValidPass1!",
                    }
                ]
            },
        )
        assert response.status_code == 204

        _delete_account_by_email(admin_api, email=email)

    def test_reset_password_for_unknown_identity_returns_404(self, admin_api):
        response = admin_api(
            "POST",
            "/admin/simple/accounts/reset-password",
            json={
                "user_identities": [
                    {
                        "method": "email:password",
                        "subject": f"ghost-{uuid4().hex}@test.agenta.ai",
                        "password": "NewValidPass1!",
                    }
                ]
            },
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# transfer-ownership
# ---------------------------------------------------------------------------


class TestTransferOwnership:
    def test_transfer_ownership_succeeds(self, admin_api):
        uid = uuid4().hex[:12]
        email_src = f"src-{uid}@test.agenta.ai"
        email_tgt = f"tgt-{uid}@test.agenta.ai"

        src = _create_account(admin_api, email=email_src)
        _create_account(admin_api, email=email_tgt)

        org_id = list(src["organizations"].values())[0]["id"]

        response = admin_api(
            "POST",
            "/admin/simple/accounts/transfer-ownership",
            json={
                "organizations": {"org": {"id": org_id}},
                "users": {
                    "source": {"email": email_src},
                    "target": {"email": email_tgt},
                },
            },
        )
        # 204 = all transferred cleanly; 200 = partial (some errors)
        assert response.status_code in (200, 204)
        if response.status_code == 200:
            body = response.json()
            assert org_id in body.get("transferred", [])

        _delete_account_by_email(admin_api, email=email_src)
        _delete_account_by_email(admin_api, email=email_tgt)

    def test_transfer_then_delete_source_preserves_target_org(self, admin_api):
        """
        Regression for Bug 2: after ownership is transferred, deleting the
        source user must NOT cascade-delete the organization now owned by target.

        Before the fix, admin_transfer_org_ownership_batch left created_by_id
        pointing at the source user, so admin_delete_user_with_cascade would find
        the org via that FK and wipe it.
        """
        uid = uuid4().hex[:12]
        email_src = f"src2-{uid}@test.agenta.ai"
        email_tgt = f"tgt2-{uid}@test.agenta.ai"

        src = _create_account(admin_api, email=email_src)
        _create_account(admin_api, email=email_tgt)

        org_id = list(src["organizations"].values())[0]["id"]

        # Transfer the org from source → target
        transfer_resp = admin_api(
            "POST",
            "/admin/simple/accounts/transfer-ownership",
            json={
                "organizations": {"org": {"id": org_id}},
                "users": {
                    "source": {"email": email_src},
                    "target": {"email": email_tgt},
                },
            },
        )
        assert transfer_resp.status_code in (200, 204)

        # Delete the source user (was owner + creator of org)
        _delete_account_by_email(admin_api, email=email_src)

        # The target user's org must still exist — verify by trying to delete it
        # explicitly; a 200 means it was found and removed, not a 404.
        delete_org_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/organizations/{org_id}/",
        )
        assert delete_org_resp.status_code == 200, (
            f"Organization {org_id} was not found after source user deleted — "
            "Bug 2 regression: created_by_id FK caused cascade delete of transferred org"
        )

        _delete_account_by_email(admin_api, email=email_tgt)

    def test_transfer_from_nonexistent_source_returns_error(self, admin_api):
        uid = uuid4().hex[:12]
        email_tgt = f"tgt3-{uid}@test.agenta.ai"
        _create_account(admin_api, email=email_tgt)

        response = admin_api(
            "POST",
            "/admin/simple/accounts/transfer-ownership",
            json={
                "users": {
                    "source": {"email": f"ghost-{uid}@test.agenta.ai"},
                    "target": {"email": email_tgt},
                },
            },
        )
        assert response.status_code in (200, 404)
        if response.status_code == 200:
            body = response.json()
            assert body.get("errors"), "Expected error entries for unknown source"

        _delete_account_by_email(admin_api, email=email_tgt)
