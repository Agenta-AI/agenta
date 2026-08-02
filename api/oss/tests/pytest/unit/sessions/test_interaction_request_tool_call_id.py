"""The durable interaction row must carry the harness's tool-call id.

A row's ``token`` is the permission gate's id, not the id of the call the agent parked on. Both
ride the live event stream, which is why the playground can answer a gate correctly; a caller
working from the stored row alone (an inbox, a webhook, a CLI) has only the row, so the tool-call
id has to be stored on it. See issue #5593.
"""

from uuid import uuid4

from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionCreate,
    SessionInteractionData,
    SessionInteractionKind,
    SessionInteractionRequest,
)
from oss.src.dbs.postgres.sessions.interactions.mappings import (
    map_interaction_dto_to_dbe_create,
)


def test_create_persists_the_tool_call_id_alongside_the_gate_token():
    project_id = uuid4()
    dbe = map_interaction_dto_to_dbe_create(
        project_id=project_id,
        user_id=None,
        interaction=SessionInteractionCreate(
            project_id=project_id,
            session_id="sess-1",
            turn_id="turn-1",
            token="gate-token",
            kind=SessionInteractionKind.user_approval,
            data=SessionInteractionData(
                request=SessionInteractionRequest(
                    tool="Write",
                    args={"file_path": "/tmp/x"},
                    tool_call_id="toolu_01abc",
                )
            ),
        ),
    )

    assert dbe.token == "gate-token"
    assert dbe.data["request"] == {
        "tool": "Write",
        "args": {"file_path": "/tmp/x"},
        "tool_call_id": "toolu_01abc",
    }


def test_a_row_written_before_the_field_existed_still_parses():
    # Rows already in the table carry only tool + args. They must keep loading, and must not
    # invent a tool-call id.
    data = SessionInteractionData.model_validate(
        {"request": {"tool": "Terminal", "args": {"command": "ls"}}}
    )

    assert data.request is not None
    assert data.request.tool == "Terminal"
    assert data.request.tool_call_id is None


def test_unknown_request_keys_survive_the_round_trip():
    # Other producers write their own request shapes here; naming three fields must not drop
    # everything else on a load-then-store cycle.
    data = SessionInteractionData.model_validate(
        {"request": {"tool": "test_run", "args": {}, "custom": {"a": 1}}}
    )

    assert data.model_dump(mode="json", exclude_none=True)["request"]["custom"] == {
        "a": 1
    }
