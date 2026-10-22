"""The membership resolver, end to end through the API."""

import pytest

from oss.src.utils.common import is_ee
from oss.tests.pytest.utils.membership_accounts import Team


@pytest.fixture
def team(admin_api):
    team = Team(admin_api, members={"admin": "admin", "viewer": "viewer"})
    yield team
    team.delete()


def test_project_created_by_another_member_is_listed(admin_api, team):
    if is_ee():
        pytest.skip("OSS policy: every organization member is in every project")

    resp = admin_api(
        "POST", "/projects/", headers=team.headers("admin"), json={"name": "Q"}
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["project_id"]

    resp = admin_api("GET", "/projects/", headers=team.headers("viewer"))
    assert resp.status_code == 200, resp.text
    listed = {p["project_id"]: p for p in resp.json()}
    assert project_id in listed
    assert listed[project_id]["user_role"] == "viewer"


def test_viewer_member_is_denied_member_removal(admin_api, team):
    resp = admin_api(
        "DELETE",
        f"/workspaces/{team.workspace_id}/users",
        params={"email": team.emails["admin"]},
        headers=team.headers("viewer"),
    )
    assert resp.status_code == 403, resp.text


def test_role_change_takes_effect_at_once(admin_api, team):
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("viewer"), json={"name": "R1"}
    )
    assert resp.status_code == 403, resp.text

    resp = admin_api(
        "POST",
        f"/workspaces/{team.workspace_id}/roles/",
        headers=team.headers("owner"),
        json={
            "email": team.emails["viewer"],
            "organization_id": team.organization_id,
            "role": "admin",
        },
    )
    assert resp.status_code == 200, resp.text

    # No cache delay: the writer cleared the cached denial.
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("viewer"), json={"name": "R2"}
    )
    assert resp.status_code == 201, resp.text


def test_owner_cannot_be_demoted_through_the_role_endpoint(admin_api, team):
    resp = admin_api(
        "POST",
        f"/workspaces/{team.workspace_id}/roles/",
        headers=team.headers("owner"),
        json={
            "email": team.emails["owner"],
            "organization_id": team.organization_id,
            "role": "viewer",
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["message"].startswith("You do not have permission")
