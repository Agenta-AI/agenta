"""An artifact that becomes an agent through a later commit gets its owner (M3,
CONTRACT 7), against a running API.

The first agent revision of an artifact gives it a project-visible access row owned by
the person whose request committed it, whatever commit path wrote that revision: here
the simple workflow edit and the application commit. An API key's commit leaves the
agent ownerless.
"""

from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_access_row,
    mock_parameters,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_agent_owner_by_commit"),
]

AGENT_DATA = {
    "uri": "agenta:builtin:agent:v0",
    "parameters": mock_parameters("reply"),
}


def _plain_workflow(caller):
    """A workflow that is not an agent yet: no access row."""

    response = caller(
        "POST",
        "/simple/workflows/",
        json={
            "workflow": {
                "slug": f"m3-plain-{uuid4().hex[:12]}",
                "name": "not an agent yet",
                "data": {"uri": "agenta:builtin:chat:v0"},
            }
        },
    )
    assert response.status_code == 200, response.text
    workflow = response.json()["workflow"]
    assert not (workflow.get("flags") or {}).get("is_agent")
    return workflow


def _edit_to_agent(caller, workflow_id):
    response = caller(
        "PUT",
        f"/simple/workflows/{workflow_id}",
        json={"workflow": {"id": workflow_id, "data": AGENT_DATA}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["workflow"]["flags"]["is_agent"] is True


def test_simple_edit_to_an_agent_gives_the_person_ownership(sharing_cast):
    alice = sharing_cast["alice"]
    workflow = _plain_workflow(alice)
    assert agent_access_row(sharing_cast.project_id, workflow["id"]) is None

    _edit_to_agent(alice, workflow["id"])

    assert agent_access_row(sharing_cast.project_id, workflow["id"]) == {
        "visibility": "project",
        "owner_user_id": alice.user_id,
    }


def test_simple_edit_by_an_api_key_leaves_the_agent_ownerless(sharing_cast):
    alice_key = sharing_cast.alice_key
    workflow = _plain_workflow(alice_key)

    _edit_to_agent(alice_key, workflow["id"])

    assert agent_access_row(sharing_cast.project_id, workflow["id"]) is None


def test_application_commit_to_an_agent_gives_the_person_ownership(sharing_cast):
    alice = sharing_cast["alice"]
    workflow = _plain_workflow(alice)

    response = alice(
        "POST",
        "/applications/revisions/commit",
        json={
            "application_revision": {
                "slug": f"m3-app-{uuid4().hex[:12]}",
                "application_id": workflow["id"],
                "application_variant_id": workflow["variant_id"],
                "data": AGENT_DATA,
            }
        },
    )
    assert response.status_code == 200, response.text

    assert agent_access_row(sharing_cast.project_id, workflow["id"]) == {
        "visibility": "project",
        "owner_user_id": alice.user_id,
    }
