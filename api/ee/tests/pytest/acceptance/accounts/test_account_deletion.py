"""
Acceptance tests for self-serve account deletion (EE-only).

`DELETE /profile` deletes the calling user, the organizations they own, their
auth login, and their billing/marketing records. It requires an interactive
SuperTokens session: API keys are rejected so a leaked integration key cannot
delete the owning account. The tests therefore sign in for real to get a
session, and separately assert that an API key is refused.
"""

from uuid import uuid4

import requests

from utils.constants import BASE_TIMEOUT

_PASSWORD = "DefaultPass1!"


def _create_account(ag_env, *, email, with_api_key=False):
    """Create an account (with an email:password identity) via the admin API.

    Returns the admin payload: `user`, `organizations`, and, when requested,
    `api_keys.key`.
    """
    options = {"seed_defaults": True, "create_identities": True}
    if with_api_key:
        options["create_api_keys"] = True
        options["return_api_keys"] = True

    resp = requests.post(
        f"{ag_env['api_url']}/admin/simple/accounts/",
        headers={"Authorization": f"Access {ag_env['auth_key']}"},
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "user_identities": [
                        {
                            "method": "email:password",
                            "subject": email,
                            "password": _PASSWORD,
                        }
                    ],
                    "options": options,
                }
            }
        },
        timeout=BASE_TIMEOUT,
    )
    assert resp.status_code == 200, resp.text
    return next(iter(resp.json()["accounts"].values()))


def _signin(api_url, *, email):
    """Sign in via SuperTokens and return an interactive-session bearer token."""
    resp = requests.post(
        f"{api_url}/auth/signin",
        headers={"rid": "emailpassword", "Content-Type": "application/json"},
        json={
            "formFields": [
                {"id": "email", "value": email},
                {"id": "password", "value": _PASSWORD},
            ]
        },
        timeout=BASE_TIMEOUT,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("status") == "OK", resp.text
    token = resp.headers.get("st-access-token")
    assert token, f"no st-access-token header in sign-in response: {dict(resp.headers)}"
    return f"Bearer {token}"


class TestSelfServeAccountDeletion:
    def test_delete_own_account_succeeds(self, ag_env):
        email = f"del-{uuid4().hex[:12]}@test.agenta.ai"
        _create_account(ag_env, email=email)
        bearer = _signin(ag_env["api_url"], email=email)
        api_url = ag_env["api_url"]

        # The session authenticates before deletion.
        before = requests.get(
            f"{api_url}/profile",
            headers={"Authorization": bearer},
            timeout=BASE_TIMEOUT,
        )
        assert before.status_code == 200, before.text

        deleted = requests.delete(
            f"{api_url}/profile",
            headers={"Authorization": bearer},
            timeout=BASE_TIMEOUT,
        )
        assert deleted.status_code == 200, deleted.text

        # The email is freed: the user and their org are gone, so the admin API
        # can recreate an account on the same email without a conflict.
        recreated = _create_account(ag_env, email=email)
        assert recreated["user"]["email"] == email

    def test_delete_own_account_blocked_when_org_has_members(self, ag_env, admin_api):
        uid = uuid4().hex[:12]
        owner_email = f"owner-{uid}@test.agenta.ai"
        member_email = f"member-{uid}@test.agenta.ai"

        owner = _create_account(ag_env, email=owner_email)
        member = _create_account(ag_env, email=member_email)
        owner_bearer = _signin(ag_env["api_url"], email=owner_email)
        api_url = ag_env["api_url"]

        org_id = list(owner["organizations"].values())[0]["id"]
        member_user_id = member["user"]["id"]

        membership_resp = admin_api(
            "POST",
            "/admin/simple/accounts/organizations/memberships/",
            json={
                "membership": {
                    "organization_ref": {"id": org_id},
                    "user_ref": {"id": member_user_id},
                    "role": "viewer",
                }
            },
        )
        assert membership_resp.status_code == 200, membership_resp.text

        blocked = requests.delete(
            f"{api_url}/profile",
            headers={"Authorization": owner_bearer},
            timeout=BASE_TIMEOUT,
        )
        assert blocked.status_code == 409, blocked.text

        # The owner is untouched after the blocked deletion.
        after = requests.get(
            f"{api_url}/profile",
            headers={"Authorization": owner_bearer},
            timeout=BASE_TIMEOUT,
        )
        assert after.status_code == 200, after.text

    def test_delete_account_rejects_api_key(self, ag_env):
        """A leaked API key must not be able to delete the owning account."""
        email = f"apikey-{uuid4().hex[:12]}@test.agenta.ai"
        account = _create_account(ag_env, email=email, with_api_key=True)
        api_key = f"ApiKey {account['api_keys']['key']}"
        api_url = ag_env["api_url"]

        rejected = requests.delete(
            f"{api_url}/profile",
            headers={"Authorization": api_key},
            timeout=BASE_TIMEOUT,
        )
        assert rejected.status_code == 403, rejected.text

        # The account is still there: the API key still reads the profile.
        after = requests.get(
            f"{api_url}/profile",
            headers={"Authorization": api_key},
            timeout=BASE_TIMEOUT,
        )
        assert after.status_code == 200, after.text
