"""Workspace removal step 2 over HTTP: the classic app's routes answer the organization
where a workspace was, and workspace create and rename answer 410.

Legacy workspace ids and the cross-organization shape need rows the API no longer writes;
they are covered by `integration/memberships/test_workspace_switch_postgres.py` and the
unit tests of the auth middleware.
"""

import pytest

from oss.tests.pytest.utils.membership_accounts import Team, unique_email

_GONE = "Workspaces were removed. Projects belong to the organization."


@pytest.fixture
def team(admin_api):
    team = Team(admin_api, members={"m": "viewer"})
    yield team
    team.delete()


def test_new_signup_has_no_workspace_and_works(admin_api, team):
    org = team.organization_id
    # The admin graph answers the organization where the workspace was.
    assert team.workspace_id == org
    resp = admin_api("GET", "/projects/", headers=team.headers("owner"))
    assert resp.status_code == 200, resp.text
    assert {p["workspace_id"] for p in resp.json()} == {org}
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("owner"), json={"name": "second"}
    )
    assert resp.status_code in (200, 201), resp.text
    assert resp.json()["workspace_id"] == org
    resp = admin_api(
        "POST",
        f"/organizations/{org}/workspaces/{org}/invite",
        params={"project_id": team.project_id},
        headers=team.headers("owner"),
        json=[{"email": unique_email("invitee"), "roles": ["viewer"]}],
    )
    assert resp.status_code == 200, resp.text


def test_project_list_answers_the_organization(admin_api, team):
    resp = admin_api("GET", "/projects/current", headers=team.headers("m"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workspace_id"] == body["organization_id"] == team.organization_id
    resp = admin_api("GET", "/workspaces/", headers=team.headers("m"))
    assert resp.status_code == 200, resp.text
    assert team.organization_id in [w["id"] for w in resp.json()]
    resp = admin_api("GET", "/organizations/", headers=team.headers("m"))
    mine = [o for o in resp.json() if o["id"] == team.organization_id]
    assert mine and mine[0]["workspaces"] == [team.organization_id]


def test_workspace_create_and_rename_answer_410(admin_api, team):
    org = team.organization_id
    resp = admin_api(
        "POST",
        f"/organizations/{org}/workspaces/",
        headers=team.headers("owner"),
        json={"name": "new"},
    )
    assert (resp.status_code, resp.json()["detail"]) == (410, _GONE)
    resp = admin_api(
        "PUT",
        f"/organizations/{org}/workspaces/{org}",
        headers=team.headers("owner"),
        json={"name": "renamed"},
    )
    assert (resp.status_code, resp.json()["detail"]) == (410, _GONE)
    resp = admin_api("GET", f"/organizations/{org}", headers=team.headers("owner"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["default_workspace"]["name"] != "renamed"


def test_role_routes_with_the_organization_id_write_no_workspace_row(admin_api, team):
    org = team.organization_id
    resp = admin_api(
        "POST",
        f"/workspaces/{org}/roles/",
        params={"project_id": team.project_id},
        headers=team.headers("owner"),
        json={"email": team.emails["m"], "role": "editor", "organization_id": org},
    )
    assert resp.status_code == 200, resp.text
    resp = admin_api("GET", f"/organizations/{org}", headers=team.headers("owner"))
    details = resp.json()
    assert details["workspaces"] == [org]
    roles = {
        m["user"]["email"]: m["roles"][0]["role_name"]
        for m in details["default_workspace"]["members"]
        if m["roles"]
    }
    assert roles[team.emails["m"]] == "editor"
