"""Project create, rename and delete check a permission (both editions; EE with RBAC).

With the default catalog: owners and admins create and rename; only owners delete.
"""

import pytest

from oss.tests.pytest.utils.membership_accounts import (
    PERMISSION_DENIED,
    Team,
    api_key_for_project,
    create_account,
    delete_account,
    headers,
    owner_key,
    unique_email,
)


@pytest.fixture
def team(admin_api):
    team = Team(
        admin_api, members={"admin": "admin", "editor": "editor", "viewer": "viewer"}
    )
    yield team
    team.delete()


def _projects(admin_api, team, label):
    resp = admin_api("GET", "/projects/", headers=team.headers(label))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _key_in(admin_api, team, label, project_id):
    return headers(
        api_key_for_project(
            admin_api, project_id=project_id, user_id=team.user_ids[label]
        )
    )


def _create(admin_api, team, label, name):
    return admin_api(
        "POST", "/projects/", headers=team.headers(label), json={"name": name}
    )


def test_viewer_cannot_create_a_project(admin_api, team):
    before = len(_projects(admin_api, team, "owner"))

    resp = _create(admin_api, team, "viewer", "viewer-project")

    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == PERMISSION_DENIED
    assert len(_projects(admin_api, team, "owner")) == before


def test_admin_can_create_and_rename_a_project(admin_api, team):
    resp = _create(admin_api, team, "admin", "admin-project")
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["project_id"]
    assert resp.json()["user_role"] == "admin"

    # An API key stays in its own project (M2): rename with the admin's key of the
    # new project. The admin's key of the first project is refused there.
    resp = admin_api(
        "PATCH",
        f"/projects/{project_id}",
        headers=team.headers("admin"),
        json={"name": "admin-project-renamed"},
    )
    assert resp.status_code == 403, resp.text
    resp = admin_api(
        "PATCH",
        f"/projects/{project_id}",
        headers=_key_in(admin_api, team, "admin", project_id),
        json={"name": "admin-project-renamed"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["project_name"] == "admin-project-renamed"


def test_editor_cannot_rename_a_project(admin_api, team):
    resp = admin_api(
        "PATCH",
        f"/projects/{team.project_id}",
        headers=team.headers("editor"),
        json={"name": "renamed-by-editor"},
    )
    assert resp.status_code == 403, resp.text

    names = {
        p["project_id"]: p["project_name"] for p in _projects(admin_api, team, "owner")
    }
    assert names[team.project_id] != "renamed-by-editor"


def test_admin_cannot_delete_a_project(admin_api, team):
    resp = _create(admin_api, team, "owner", "to-keep")
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["project_id"]

    # The admin's key of that project, so the refusal is the role's, not the key's.
    resp = admin_api(
        "DELETE",
        f"/projects/{project_id}",
        headers=_key_in(admin_api, team, "admin", project_id),
    )
    assert resp.status_code == 403, resp.text


def test_owner_can_delete_a_project(admin_api, team):
    resp = _create(admin_api, team, "owner", "to-delete")
    assert resp.status_code == 201, resp.text
    project_id = resp.json()["project_id"]

    resp = admin_api(
        "DELETE",
        f"/projects/{project_id}",
        headers=_key_in(admin_api, team, "owner", project_id),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"detail": "Project deleted"}


def test_non_member_gets_404_on_update_and_delete(admin_api, team):
    email = unique_email("stranger")
    stranger = create_account(admin_api, email=email)
    try:
        stranger_headers = headers(owner_key(stranger))

        resp = admin_api(
            "PATCH",
            f"/projects/{team.project_id}",
            headers=stranger_headers,
            json={"name": "taken"},
        )
        assert resp.status_code == 404, resp.text

        resp = admin_api(
            "DELETE", f"/projects/{team.project_id}", headers=stranger_headers
        )
        assert resp.status_code == 404, resp.text
    finally:
        delete_account(admin_api, email=email)
