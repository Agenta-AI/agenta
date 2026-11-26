"""Routes that take a workspace id accept the organization id (workspace removal step 1).

API keys of the owner's default project: M2 checks the workspace's default project on
these routes, so the organization id must map to the same project.
"""

from urllib.parse import parse_qs, urlparse

import pytest

from oss.tests.pytest.utils.membership_accounts import (
    Team,
    create_account,
    delete_account,
    owner_key,
    unique_email,
    headers,
)


@pytest.fixture
def team(admin_api):
    team = Team(admin_api, members={"m": "viewer"})
    yield team
    team.delete()


def _projects(admin_api, key):
    resp = admin_api("GET", "/projects/", headers=headers(key))
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_role_routes_accept_the_organization_id(admin_api, team):
    org = team.organization_id
    params = {"project_id": team.project_id}
    resp = admin_api(
        "POST",
        f"/workspaces/{org}/roles/",
        params=params,
        headers=team.headers("owner"),
        json={"email": team.emails["m"], "role": "admin", "organization_id": org},
    )
    assert resp.status_code == 200, resp.text
    mine = [
        p
        for p in _projects(admin_api, team.keys["m"])
        if p["project_id"] == team.project_id
    ]
    assert mine and mine[0]["user_role"] == "admin"

    resp = admin_api(
        "DELETE",
        f"/workspaces/{org}/users/",
        params={**params, "email": team.emails["m"], "organization_id": org},
        headers=team.headers("owner"),
    )
    assert resp.status_code == 200, resp.text
    resp = admin_api("GET", "/projects/", headers=team.headers("m"))
    assert resp.status_code in (401, 403) or not [
        p for p in resp.json() if p["project_id"] == team.project_id
    ]


def test_invite_and_resend_accept_the_organization_id(admin_api, team):
    org = team.organization_id
    email = unique_email("invitee")
    path = f"/organizations/{org}/workspaces/{org}/invite"
    resp = admin_api(
        "POST",
        path,
        params={"project_id": team.project_id},
        headers=team.headers("owner"),
        json=[{"email": email, "roles": ["member"]}],
    )
    assert resp.status_code == 200, resp.text
    resp = admin_api(
        "POST",
        f"{path}/resend",
        params={"project_id": team.project_id},
        headers=team.headers("owner"),
        json={"email": email},
    )
    assert resp.status_code == 200, resp.text


def test_invite_refuses_another_organization(admin_api, team):
    other = Team(admin_api, members={})
    try:
        resp = admin_api(
            "POST",
            f"/organizations/{team.organization_id}/workspaces/{other.organization_id}/invite",
            params={"project_id": team.project_id},
            headers=team.headers("owner"),
            json=[{"email": unique_email("invitee"), "roles": ["member"]}],
        )
        assert resp.status_code == 404, resp.text
    finally:
        other.delete()


def test_access_scope_workspace_accepts_the_organization_id(admin_api, team):
    for scope_id, allowed in (
        (team.organization_id, True),
        (team.workspace_id, True),
        (team.project_id, False),
    ):
        resp = admin_api(
            "GET",
            "/access/permissions/check",
            params={
                "action": "run_service",
                "resource_type": "service",
                "scope_type": "workspace",
                "scope_id": scope_id,
            },
            headers=team.headers("owner"),
        )
        assert (resp.status_code == 200) is allowed, (scope_id, resp.text)


def test_accept_invitation_refuses_another_organization(admin_api, team):
    other = Team(admin_api, members={})
    email = unique_email("invitee")
    invitee = create_account(admin_api, email=email)
    try:
        resp = admin_api(
            "POST",
            f"/organizations/{team.organization_id}/workspaces/{team.workspace_id}/invite",
            params={"project_id": team.project_id},
            headers=team.headers("owner"),
            json=[{"email": email, "roles": ["member"]}],
        )
        assert resp.status_code == 200, resp.text
        link = parse_qs(urlparse(resp.json()["url"]).query)
        token = link["token"][0]
        invitee_headers = headers(owner_key(invitee))

        def _accept(workspace_id):
            return admin_api(
                "POST",
                f"/organizations/{team.organization_id}/workspaces/{workspace_id}/invite/accept",
                params={"project_id": team.project_id},
                headers=invitee_headers,
                json={"token": token, "email": email},
            )

        for wrong in (other.organization_id, other.workspace_id):
            resp = _accept(wrong)
            assert resp.status_code == 400, resp.text
        orgs = admin_api("GET", "/organizations/", headers=invitee_headers).json()
        assert team.organization_id not in [o["id"] for o in orgs]

        resp = _accept(team.organization_id)
        assert resp.status_code == 200, resp.text
        orgs = admin_api("GET", "/organizations/", headers=invitee_headers).json()
        assert team.organization_id in [o["id"] for o in orgs]
    finally:
        delete_account(admin_api, email=email)
        other.delete()


def test_project_list_is_unchanged(admin_api, team):
    items = _projects(admin_api, team.keys["owner"])
    mine = [p for p in items if p["project_id"] == team.project_id]
    assert mine[0]["workspace_id"] == team.workspace_id
    assert mine[0]["workspace_name"]
