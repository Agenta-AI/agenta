"""Acceptance: an evaluation run save makes the editor the executing principal.

Spec section 3.8: `PATCH /evaluations/runs/{run_id}` and `PATCH /evaluations/runs/`
write the editor as the run's principal. Close and open keep it.

Requires a running API.
"""

import pytest

from oss.tests.pytest.utils.membership_accounts import Team


@pytest.fixture
def team(admin_api):
    team = Team(admin_api, members={"editor": "editor"})
    yield team
    team.delete()


def _as(admin_api, team, label):
    def _request(method, endpoint, **kwargs):
        return admin_api(method, endpoint, headers=team.headers(label), **kwargs)

    return _request


def _create_run(api, name):
    response = api("POST", "/evaluations/runs/", json={"runs": [{"name": name}]})
    assert response.status_code == 200, response.text
    return response.json()["runs"][0]


def _principal(api, run_id):
    response = api("GET", f"/evaluations/runs/{run_id}")
    assert response.status_code == 200, response.text
    return response.json()["run"]["principal"]


def test_a_save_by_another_member_makes_them_the_principal(admin_api, team):
    owner = _as(admin_api, team, "owner")
    editor = _as(admin_api, team, "editor")

    run = _create_run(owner, "edit-principal")
    owner_principal = run["principal"]
    editor_principal = _create_run(editor, "edit-principal-probe")["principal"]
    assert editor_principal != owner_principal

    response = editor(
        "PATCH",
        f"/evaluations/runs/{run['id']}",
        json={"run": {"id": run["id"], "name": "renamed by the editor"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["run"]["principal"] == editor_principal

    # Close and open by the owner keep the editor as the principal.
    response = owner("POST", f"/evaluations/runs/{run['id']}/close")
    assert response.status_code == 200, response.text
    response = owner("POST", f"/evaluations/runs/{run['id']}/open")
    assert response.status_code == 200, response.text
    assert _principal(owner, run["id"]) == editor_principal

    # A batch save by the owner makes the owner the principal again.
    response = owner(
        "PATCH",
        "/evaluations/runs/",
        json={"runs": [{"id": run["id"], "name": "renamed by the owner"}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["runs"][0]["principal"] == owner_principal
    assert _principal(owner, run["id"]) == owner_principal


def test_a_step_save_that_changes_nothing_writes_the_editor(admin_api, team):
    owner = _as(admin_api, team, "owner")
    editor = _as(admin_api, team, "editor")
    step = {"key": "input", "type": "input", "origin": "custom", "references": {}}
    response = owner(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": "steps", "data": {"steps": [step]}}]},
    )
    assert response.status_code == 200, response.text
    run = response.json()["runs"][0]
    editor_principal = _create_run(editor, "steps-probe")["principal"]

    # A closed run refuses the save and keeps its principal.
    assert owner("POST", f"/evaluations/runs/{run['id']}/close").status_code == 200
    response = editor(
        "POST",
        f"/simple/evaluations/{run['id']}/steps/add",
        json={"steps": [step]},
    )
    assert response.status_code == 409, response.text
    assert _principal(owner, run["id"]) == run["principal"]

    assert owner("POST", f"/evaluations/runs/{run['id']}/open").status_code == 200
    response = editor(
        "POST",
        f"/simple/evaluations/{run['id']}/steps/add",
        json={"steps": [step]},
    )
    assert response.status_code == 200, response.text
    assert _principal(owner, run["id"]) == editor_principal
