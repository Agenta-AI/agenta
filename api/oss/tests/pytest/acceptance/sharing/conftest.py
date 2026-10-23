"""Fixtures for the sharing acceptance tests (M3), against a running API.

`sharing_team` makes one project with two people who can sign in: Alice, the owner,
and Bob, an editor. Each has a browser session (`Bearer`, signed in through the same
`/auth/signin` call the web app makes) and an API key of the project. The accounts
are deleted after the test.
"""

import secrets
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT


def _first_id(values):
    return next(iter(values.values()))["id"]


def _create_person(admin_api, *, email, password):
    response = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": False,
                        "create_identities": True,
                    },
                    "user_identities": [
                        {
                            "method": "email:password",
                            "subject": email,
                            "email": email,
                            "password": password,
                            "verified": True,
                        }
                    ],
                }
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["accounts"]["u"]


def _delete_person(admin_api, *, email):
    response = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert response.status_code == 204, response.text


def _add_member(admin_api, *, organization_id, project_id, user_id, role):
    for path, body in (
        (
            "/admin/simple/accounts/organizations/memberships/",
            {"organization_ref": {"id": organization_id}},
        ),
        (
            "/admin/simple/accounts/projects/memberships/",
            {"project_ref": {"id": project_id}},
        ),
    ):
        response = admin_api(
            "POST",
            path,
            json={"membership": {**body, "user_ref": {"id": user_id}, "role": role}},
        )
        assert response.status_code == 200, response.text


def _project_key(admin_api, *, project_id, user_id):
    response = admin_api(
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
    assert response.status_code == 200, response.text
    return (
        "ApiKey "
        + next(iter(response.json()["accounts"][0]["api_keys"].values()))["value"]
    )


def _bearer(api_url, *, email, password):
    response = requests.post(
        f"{api_url}/auth/signin",
        headers={"rid": "emailpassword", "st-auth-mode": "header"},
        json={
            "formFields": [
                {"id": "email", "value": email},
                {"id": "password", "value": password},
            ]
        },
        timeout=BASE_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    assert response.json().get("status") == "OK", response.text
    return f"Bearer {response.headers['st-access-token']}"


class Caller:
    """Requests as one credential in the team's project."""

    def __init__(self, *, api_url, credentials, project_id, user_id):
        self.api_url = api_url
        self.credentials = credentials
        self.project_id = project_id
        self.user_id = user_id

    def __call__(self, method, endpoint, **kwargs):
        params = dict(kwargs.pop("params", {}) or {})
        params.setdefault("project_id", self.project_id)
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Authorization", self.credentials)
        return requests.request(
            method=method,
            url=f"{self.api_url}{endpoint}",
            params=params,
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )


@pytest.fixture
def sharing_team(ag_env, admin_api):
    api_url = ag_env["api_url"]
    uid = uuid4().hex[:12]
    password = secrets.token_urlsafe(18)
    alice_email = f"m3-alice-{uid}@test.agenta.ai"
    bob_email = f"m3-bob-{uid}@test.agenta.ai"
    created = []
    try:
        alice = _create_person(admin_api, email=alice_email, password=password)
        created.append(alice_email)
        bob = _create_person(admin_api, email=bob_email, password=password)
        created.append(bob_email)
        organization_id = _first_id(alice["organizations"])
        project_id = _first_id(alice["projects"])
        alice_id = alice["user"]["id"]
        bob_id = bob["user"]["id"]
        _add_member(
            admin_api,
            organization_id=organization_id,
            project_id=project_id,
            user_id=bob_id,
            role="editor",
        )

        def caller(credentials, user_id):
            return Caller(
                api_url=api_url,
                credentials=credentials,
                project_id=project_id,
                user_id=user_id,
            )

        yield {
            "project_id": project_id,
            "alice": caller(
                _bearer(api_url, email=alice_email, password=password), alice_id
            ),
            "bob": caller(_bearer(api_url, email=bob_email, password=password), bob_id),
            "alice_key": caller(
                _project_key(admin_api, project_id=project_id, user_id=alice_id),
                alice_id,
            ),
            "bob_key": caller(
                _project_key(admin_api, project_id=project_id, user_id=bob_id), bob_id
            ),
        }
    finally:
        for email in reversed(created):
            _delete_person(admin_api, email=email)
