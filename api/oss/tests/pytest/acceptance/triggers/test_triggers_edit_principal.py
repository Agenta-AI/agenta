"""Acceptance: a schedule save makes the editor the executing principal.

Spec section 3.8: every save through `PUT /triggers/schedules/{id}` writes the editor as
the principal, even a save that changes only the name. Pause and resume keep it.
Subscriptions need a Composio connection; their unit tests cover the same rule.

Requires a running API.
"""

import pytest

from oss.tests.pytest.acceptance.triggers.test_triggers_schedules import (
    _create_workflow,
    _schedule_payload,
)
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


def _create_schedule(api, workflow_slug):
    response = api(
        "POST",
        "/triggers/schedules/",
        json=_schedule_payload(workflow_slug=workflow_slug),
    )
    assert response.status_code == 200, response.text
    return response.json()["schedule"]


def _rename(api, schedule, name):
    response = api(
        "PUT",
        f"/triggers/schedules/{schedule['id']}",
        json={
            "schedule": {
                "id": schedule["id"],
                "name": name,
                "description": schedule["description"],
                "data": schedule["data"],
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["schedule"]


def test_a_rename_by_another_member_makes_them_the_principal(admin_api, team):
    owner = _as(admin_api, team, "owner")
    editor = _as(admin_api, team, "editor")
    workflow_slug, _ = _create_workflow(owner)

    schedule = _create_schedule(owner, workflow_slug)
    owner_principal = schedule["principal"]
    editor_principal = _create_schedule(editor, workflow_slug)["principal"]
    assert editor_principal != owner_principal

    renamed = _rename(editor, schedule, "renamed by the editor")
    assert renamed["principal"] == editor_principal

    # Pause and resume by the owner keep the editor as the principal.
    stop = owner("POST", f"/triggers/schedules/{schedule['id']}/stop")
    assert stop.status_code == 200, stop.text
    assert stop.json()["schedule"]["principal"] == editor_principal
    start = owner("POST", f"/triggers/schedules/{schedule['id']}/start")
    assert start.status_code == 200, start.text
    assert start.json()["schedule"]["principal"] == editor_principal

    # The owner's next save makes the owner the principal again.
    renamed = _rename(owner, schedule, "renamed by the owner")
    assert renamed["principal"] == owner_principal
    fetched = owner("GET", f"/triggers/schedules/{schedule['id']}")
    assert fetched.json()["schedule"]["principal"] == owner_principal
