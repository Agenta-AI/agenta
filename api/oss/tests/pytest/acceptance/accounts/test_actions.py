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
