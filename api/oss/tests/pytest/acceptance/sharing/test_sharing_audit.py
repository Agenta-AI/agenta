"""Sharing audit events (M3), against a running API.

Every sharing change publishes one event with the policy before and after it, after
the change committed. Events are stored by the events worker, in EE only (OSS sends
them to webhooks and stores none), so this test reads the stored event in EE.
"""

import json
import time

import pytest

from oss.src.utils.common import is_ee
from oss.tests.pytest.acceptance.sharing.support import (
    new_agent,
    poll,
    set_agent_visibility,
    tracing_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_audit"),
]


def _events(project_id, resource_id):
    rows = tracing_rows(
        "SELECT event_type, attributes::text AS attributes FROM events"
        " WHERE project_id = $1::uuid AND attributes->'resource'->>'id' = $2",
        str(project_id),
        str(resource_id),
    )
    return [(row["event_type"], json.loads(row["attributes"])) for row in rows]


def test_sharing_change_publishes_before_and_after(sharing_cast):
    if not is_ee():
        pytest.skip(
            "OSS stores no events: the events worker ingests only in EE "
            "(EventsWorker.process_batch), so there is no stored event to read."
        )

    alice = sharing_cast["alice"]
    agent = new_agent(alice, visibility="project")

    response = set_agent_visibility(alice, agent["id"], "private")
    assert response.status_code == 200, response.text
    # A no-op write publishes nothing.
    response = set_agent_visibility(alice, agent["id"], "private")
    assert response.status_code == 200, response.text

    assert poll(lambda: _events(sharing_cast.project_id, agent["id"]), timeout=30)
    time.sleep(3)  # a second (wrong) event would land in the same worker batch window
    events = _events(sharing_cast.project_id, agent["id"])
    assert [event_type for event_type, _ in events] == ["agents.sharing.changed"]
    attributes = events[0][1]
    assert attributes["resource"] == {"kind": "agent", "id": agent["id"]}
    assert attributes["before"] == {
        "visibility": "project",
        "owner_user_id": alice.user_id,
    }
    assert attributes["after"] == {
        "visibility": "private",
        "owner_user_id": alice.user_id,
    }
    assert attributes["principal"] == {"kind": "human", "id": alice.user_id}
    assert attributes["acting_user_id"] == alice.user_id
    assert attributes["credential"] == "bearer_session"
    assert "Bearer" not in json.dumps(attributes)
