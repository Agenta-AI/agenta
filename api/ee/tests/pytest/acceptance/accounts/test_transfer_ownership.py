"""
Acceptance tests for EE-only org-ownership transfer flows.

Both tests rely on the EE-only org-membership endpoint as a precondition,
so they live under ee/tests/pytest. The non-EE branches of
/admin/simple/accounts/transfer-ownership are covered in OSS.
"""

from uuid import uuid4


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


class TestTransferOwnership:
    def test_transfer_ownership_succeeds(self, admin_api):
        uid = uuid4().hex[:12]
        email_src = f"src-{uid}@test.agenta.ai"
        email_tgt = f"tgt-{uid}@test.agenta.ai"

        src = _create_account(admin_api, email=email_src)
        tgt = _create_account(admin_api, email=email_tgt)

        org_id = list(src["organizations"].values())[0]["id"]
        tgt_user_id = tgt["user"]["id"]

        # Target must be a member of the org before ownership can be transferred.
        membership_resp = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/memberships/",
            json={
                "membership": {
                    "organization_ref": {"id": org_id},
                    "user_ref": {"id": tgt_user_id},
                    "role": "member",
                }
            },
        )
        assert membership_resp.status_code == 200, membership_resp.text

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
        tgt = _create_account(admin_api, email=email_tgt)

        org_id = list(src["organizations"].values())[0]["id"]
        tgt_user_id = tgt["user"]["id"]

        # Target must be a member of the org before ownership can be transferred.
        membership_resp = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/memberships/",
            json={
                "membership": {
                    "organization_ref": {"id": org_id},
                    "user_ref": {"id": tgt_user_id},
                    "role": "member",
                }
            },
        )
        assert membership_resp.status_code == 200, membership_resp.text

        # Transfer the org from source -> target
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

        # The target user's org must still exist - verify by trying to delete it
        # explicitly; a 200 means it was found and removed, not a 404.
        delete_org_resp = admin_api(
            "DELETE",
            f"/admin/simple/accounts/organizations/{org_id}",
        )
        assert delete_org_resp.status_code == 200, (
            f"Organization {org_id} was not found after source user deleted - "
            "Bug 2 regression: created_by_id FK caused cascade delete of transferred org"
        )

        _delete_account_by_email(admin_api, email=email_tgt)
