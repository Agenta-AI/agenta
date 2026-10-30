"""The role shortcuts never open a private item (M3), against a running API.

The organization owner and a project admin pass the role check of step 3, and every
role may read sessions. A private session or agent still reads for them exactly like
an unknown id, with or without the RBAC entitlement.
"""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    fetch_sharing,
    invoke,
    listed_agents,
    listed_sessions,
    new_agent,
    new_session_id,
    read_stream,
    same_answer,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.xdist_group("sharing_shortcuts_closed"),
]


def test_org_owner_and_no_rbac_get_404(sharing_cast):
    alice = sharing_cast["alice"]
    agent = new_agent(alice, visibility="private")
    session_id = new_session_id()
    turn = invoke(alice, session_id=session_id, agent=agent)
    assert turn.status_code == 200, turn.text

    callers = ["owner", "dana", "bob", "carol"]
    for label in callers:
        caller = sharing_cast[label]
        unknown_id = new_session_id()
        assert same_answer(
            read_stream(caller, session_id),
            read_stream(caller, unknown_id),
            hidden_id=session_id,
            unknown_id=unknown_id,
        ), label
        assert session_id not in listed_sessions(caller), label
        sharing = fetch_sharing(caller, session_id)
        assert (sharing.status_code, sharing.json()) == (404, NOT_FOUND_BODY), label

        assert caller("GET", f"/workflows/{agent['id']}").json()["count"] == 0, label
        assert agent["id"] not in listed_agents(caller), label
        agent_sharing = caller("GET", f"/workflows/{agent['id']}/sharing")
        assert (agent_sharing.status_code, agent_sharing.json()) == (
            404,
            NOT_FOUND_BODY,
        ), label
