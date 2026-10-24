"""EE: a new project seeds every organization member; a new owner is seeded into every
project on transfer."""

import pytest

from oss.tests.pytest.utils.membership_accounts import Team


@pytest.fixture
def team(admin_api):
    team = Team(
        admin_api,
        members={
            "admin": "admin",
            "editor": "editor",
            "viewer": "viewer",
            "annotator": "annotator",
        },
    )
    yield team
    team.delete()


def test_new_project_seeds_every_member(admin_api, team):
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("owner"), json={"name": "Seeded"}
    )
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["project_id"]

    expected = {
        "owner": "owner",
        "admin": "admin",
        "editor": "editor",
        "viewer": "viewer",
        "annotator": "annotator",
    }
    for label, role in expected.items():
        resp = admin_api("GET", "/projects/", headers=team.headers(label))
        assert resp.status_code == 200, resp.text
        listed = {p["project_id"]: p for p in resp.json()}
        assert project_id in listed, label
        assert listed[project_id]["user_role"] == role, label


def test_new_owner_can_edit_after_transfer(admin_api):
    team = Team(admin_api, members={})
    try:
        resp = admin_api(
            "POST", "/projects/", headers=team.headers("owner"), json={"name": "P2"}
        )
        assert resp.status_code == 201, resp.text
        p2 = resp.json()["project_id"]

        # Added after P2 exists, through the admin API (no seeding): no row in P2.
        team.add("successor", "admin")
        resp = admin_api(
            "PATCH",
            f"/projects/{p2}",
            headers=team.headers("successor"),
            json={"name": "P2-before"},
        )
        assert resp.status_code == 404, resp.text

        resp = admin_api(
            "POST",
            f"/organizations/{team.organization_id}/transfer/{team.user_ids['successor']}",
            headers=team.headers("owner"),
        )
        assert resp.status_code == 200, resp.text

        resp = admin_api(
            "PATCH",
            f"/projects/{p2}",
            headers=team.headers("successor"),
            json={"name": "P2-after"},
        )
        assert resp.status_code == 200, resp.text
    finally:
        team.delete()


def test_new_owner_can_edit_after_admin_transfer(admin_api):
    team = Team(admin_api, members={})
    try:
        resp = admin_api(
            "POST", "/projects/", headers=team.headers("owner"), json={"name": "P2"}
        )
        assert resp.status_code == 201, resp.text
        p2 = resp.json()["project_id"]

        # Added after P2 exists, through the admin API (no seeding): no row in P2.
        team.add("successor", "admin")
        resp = admin_api(
            "PATCH",
            f"/projects/{p2}",
            headers=team.headers("successor"),
            json={"name": "P2-before"},
        )
        assert resp.status_code == 404, resp.text

        resp = admin_api(
            "POST",
            "/admin/simple/accounts/transfer-ownership",
            json={
                "organizations": {"org": {"id": team.organization_id}},
                "users": {
                    "source": {"email": team.emails["owner"]},
                    "target": {"email": team.emails["successor"]},
                },
            },
        )
        assert resp.status_code in (200, 204), resp.text

        resp = admin_api(
            "PATCH",
            f"/projects/{p2}",
            headers=team.headers("successor"),
            json={"name": "P2-after"},
        )
        assert resp.status_code == 200, resp.text
    finally:
        team.delete()
