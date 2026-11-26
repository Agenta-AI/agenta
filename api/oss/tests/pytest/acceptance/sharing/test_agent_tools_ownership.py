"""An agent that `create_agent` makes in a run a person started belongs to that person,
with the visibility the call asked for, against a running API.

The call goes through `POST /tools/call` with the person's run credential, the
credential the runner holds for a turn the person started in the browser. The caller
and session fields are the ones the runner binds from run context; here the test sends
them, the way the runner does.
"""

import json
from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_access_row,
    listed_agents,
    new_agent,
    run_caller,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_agent_tools_ownership"),
]


def _create_agent(caller, *, caller_agent_id, **arguments):
    response = caller(
        "POST",
        "/tools/call",
        json={
            "data": {
                "id": f"acceptance-{uuid4().hex[:8]}",
                "function": {
                    "name": "tools.agenta.create_agent",
                    "arguments": {
                        "name": f"Invoice helper {uuid4().hex[:6]}",
                        "caller_agent_id": caller_agent_id,
                        "caller_session_id": f"acceptance-{uuid4().hex[:12]}",
                        **arguments,
                    },
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    call = response.json()["call"]
    content = json.loads(call["data"]["content"])
    assert call["status"]["code"] == "STATUS_CODE_OK", content
    return content


@pytest.mark.parametrize(
    "arguments, visibility",
    [({}, "private"), ({"visibility": "private"}, "private")],
    ids=["default", "private"],
)
def test_a_private_agent_belongs_to_the_person_and_only_they_see_it(
    sharing_cast, arguments, visibility
):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    caller_agent = new_agent(alice, visibility="project")

    created = _create_agent(
        run_caller(sharing_cast, "alice"),
        caller_agent_id=caller_agent["id"],
        **arguments,
    )

    agent_id = created["agent"]["id"]
    assert created["visibility"] == visibility
    assert agent_access_row(sharing_cast.project_id, agent_id) == {
        "visibility": "private",
        "owner_user_id": alice.user_id,
    }
    assert agent_id in listed_agents(alice)
    assert agent_id not in listed_agents(bob)


def test_a_project_agent_belongs_to_the_person_and_the_project_sees_it(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    caller_agent = new_agent(alice, visibility="project")

    created = _create_agent(
        run_caller(sharing_cast, "alice"),
        caller_agent_id=caller_agent["id"],
        visibility="project",
    )

    agent_id = created["agent"]["id"]
    assert created["visibility"] == "project"
    assert agent_access_row(sharing_cast.project_id, agent_id) == {
        "visibility": "project",
        "owner_user_id": alice.user_id,
    }
    assert agent_id in listed_agents(bob)
