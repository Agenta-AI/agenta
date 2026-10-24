"""Omitted visibility (M3, CONTRACT 7), against a running API.

A request that names no visibility gets `private` when the owner rule gives the item
an owner (a person's browser session), else `project` (an API key). `/w` sends
`visibility=project` on the header call that creates a chat.
"""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    agent_access_row,
    create_header,
    fetch_sharing,
    listed_sessions,
    new_agent,
    new_session_id,
    stream_is_readable,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_default_visibility"),
]


def _policy(caller, session_id):
    response = fetch_sharing(caller, session_id)
    assert response.status_code == 200, response.text
    return response.json()["sharing"]["policy"]


def test_omitted_visibility_human_chat_private(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id = new_session_id()

    response = create_header(alice, session_id)
    assert response.status_code == 200, response.text

    assert _policy(alice, session_id) == {
        "visibility": "private",
        "owner_user_id": alice.user_id,
    }
    assert stream_is_readable(alice, session_id)
    assert not stream_is_readable(bob, session_id)
    assert session_id not in listed_sessions(bob)
    assert fetch_sharing(bob, session_id).json() == NOT_FOUND_BODY


def test_omitted_visibility_human_agent_private(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]

    agent = new_agent(alice)

    assert agent["access"] == {"visibility": "private", "owner_user_id": alice.user_id}
    assert agent_access_row(sharing_cast.project_id, agent["id"]) == {
        "visibility": "private",
        "owner_user_id": alice.user_id,
    }
    hidden = bob("GET", f"/workflows/{agent['id']}")
    assert hidden.status_code == 200, hidden.text
    assert hidden.json().get("count") == 0


def test_omitted_visibility_api_key_project(sharing_cast):
    alice_key, bob = sharing_cast.alice_key, sharing_cast["bob"]

    agent = new_agent(alice_key)
    assert agent["access"]["visibility"] == "project"
    assert agent["access"].get("owner_user_id") is None
    # An ownerless agent has no access row.
    assert agent_access_row(sharing_cast.project_id, agent["id"]) is None
    assert bob("GET", f"/workflows/{agent['id']}").json().get("count") == 1

    session_id = new_session_id()
    response = create_header(alice_key, session_id)
    assert response.status_code == 200, response.text
    policy = _policy(bob, session_id)
    assert policy["visibility"] == "project"
    assert policy.get("owner_user_id") is None
    assert session_id in listed_sessions(bob)


def test_header_create_with_project_visibility(sharing_cast):
    """The `/w` header call: project-visible, still owned by its creator."""

    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id = new_session_id()

    response = create_header(alice, session_id, visibility="project")
    assert response.status_code == 200, response.text

    assert _policy(alice, session_id) == {
        "visibility": "project",
        "owner_user_id": alice.user_id,
    }
    assert stream_is_readable(bob, session_id)
    assert session_id in listed_sessions(bob)

    # A later header call never changes the visibility of an existing session.
    response = create_header(alice, session_id, visibility="private", name="renamed")
    assert response.status_code == 200, response.text
    assert _policy(alice, session_id)["visibility"] == "project"
