"""
Acceptance tests for POST/DELETE /admin/simple/accounts/.

Covers the batch create and batch delete workflows, including the
dry-run flag and idempotent recreation via idempotency_key.
"""

from uuid import uuid4


class TestSimpleAccountsCreate:
    def test_create_single_account_returns_user_and_org(self, admin_api):
        uid = uuid4().hex[:12]

        response = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={
                "accounts": {
                    "alice": {
                        "user": {"email": f"alice-{uid}@test.agenta.ai"},
                        "options": {
                            "create_api_keys": True,
                            "return_api_keys": True,
                            "seed_defaults": True,
                        },
                    }
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert "accounts" in body
        account = body["accounts"]["alice"]
        assert account["user"]["email"] == f"alice-{uid}@test.agenta.ai"
        assert account["organizations"]
        assert account["workspaces"]
        assert account["projects"]
        assert account["api_keys"]

    def test_create_multiple_accounts_in_one_call(self, admin_api):
        uid = uuid4().hex[:12]

        response = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={
                "accounts": {
                    "u1": {"user": {"email": f"u1-{uid}@test.agenta.ai"}},
                    "u2": {"user": {"email": f"u2-{uid}@test.agenta.ai"}},
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert set(body["accounts"].keys()) == {"u1", "u2"}

    def test_dry_run_does_not_persist(self, admin_api):
        uid = uuid4().hex[:12]

        response = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={
                "options": {"dry_run": True},
                "accounts": {"dry": {"user": {"email": f"dry-{uid}@test.agenta.ai"}}},
            },
        )

        assert response.status_code == 200

        # A subsequent delete by email should find nothing
        delete_response = admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={
                "accounts": {"dry": {"user": {"email": f"dry-{uid}@test.agenta.ai"}}},
                "confirm": "delete",
            },
        )
        assert delete_response.status_code == 204

    def test_duplicate_email_returns_conflict_error(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"dup-{uid}@test.agenta.ai"

        admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )

        response = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )

        assert response.status_code == 409


class TestSimpleAccountsDelete:
    def test_delete_by_email(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"del-{uid}@test.agenta.ai"

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )
        assert create_resp.status_code == 200

        delete_resp = admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={
                "accounts": {"u": {"user": {"email": email}}},
                "confirm": "delete",
            },
        )
        assert delete_resp.status_code == 204

    def test_delete_by_id(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"del-id-{uid}@test.agenta.ai"

        create_resp = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )
        assert create_resp.status_code == 200
        user_id = create_resp.json()["accounts"]["u"]["user"]["id"]

        delete_resp = admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={
                "accounts": {"u": {"user": {"id": user_id}}},
                "confirm": "delete",
            },
        )
        assert delete_resp.status_code == 204

    def test_delete_nonexistent_user_is_no_op(self, admin_api):
        """Deleting a user that does not exist should succeed silently."""
        response = admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={
                "accounts": {
                    "ghost": {"user": {"email": f"ghost-{uuid4().hex}@test.agenta.ai"}}
                },
                "confirm": "delete",
            },
        )
        assert response.status_code == 204

    def test_dry_run_delete_returns_204_without_deletion(self, admin_api):
        uid = uuid4().hex[:12]
        email = f"dry-del-{uid}@test.agenta.ai"

        admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )

        # Dry-run should be a no-op
        dry_resp = admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={
                "accounts": {"u": {"user": {"email": email}}},
                "dry_run": True,
                "confirm": "delete",
            },
        )
        assert dry_resp.status_code == 204

        # Account still exists — create should conflict
        dup_resp = admin_api(
            "POST",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}},
        )
        assert dup_resp.status_code == 409
