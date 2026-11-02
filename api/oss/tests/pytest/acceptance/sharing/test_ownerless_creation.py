"""Items no person owns (M3, CONTRACT 7 rule 4), against a running API.

An API key is not a person, and a channel installation is not one even when its
sender is a linked member: what they create has no owner and is project-visible. A
requested `private` is dropped, never refused.
"""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_access_row,
    fetch_sharing,
    heartbeat,
    listed_agents,
    listed_sessions,
    new_agent,
    new_session_id,
    agent_references,
    stream_row,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_ownerless_creation"),
]


def _assert_ownerless_agent(cast, agent):
    assert agent["access"]["visibility"] == "project"
    assert agent["access"].get("owner_user_id") is None
    assert agent_access_row(cast.project_id, agent["id"]) is None
    bob = cast["bob"]
    assert agent["id"] in listed_agents(bob)
    sharing = bob("GET", f"/workflows/{agent['id']}/sharing")
    assert sharing.status_code == 200, sharing.text
    policy = sharing.json()["sharing"]["policy"]
    assert policy["visibility"] == "project"
    assert policy.get("owner_user_id") is None


def test_api_key_private_request_creates_ownerless(sharing_cast):
    agent = new_agent(sharing_cast.alice_key, visibility="private")
    _assert_ownerless_agent(sharing_cast, agent)


def test_slack_tool_call_creates_ownerless(sharing_cast):
    """A tool call of a channel turn runs with the installation's run credential, here
    with a linked sender (Alice). The agent and the session it creates are ownerless
    and project-visible, although the request asks for `private`."""

    installation = sharing_cast.installation.linked_caller

    agent = new_agent(installation, visibility="private")
    _assert_ownerless_agent(sharing_cast, agent)

    session_id = new_session_id()
    response = heartbeat(
        installation,
        session_id=session_id,
        turn_id=new_session_id(),
        references=agent_references(sharing_cast.installation.agent),
    )
    assert response.status_code == 200, response.text
    row = stream_row(sharing_cast.project_id, session_id)
    assert row["visibility"] == "project"
    assert row["owner_user_id"] is None
    bob = sharing_cast["bob"]
    assert session_id in listed_sessions(bob)
    sharing = fetch_sharing(bob, session_id)
    assert sharing.status_code == 200, sharing.text
    assert sharing.json()["sharing"]["policy"].get("owner_user_id") is None
