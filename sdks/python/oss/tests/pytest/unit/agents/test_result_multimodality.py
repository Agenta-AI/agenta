from __future__ import annotations

import pytest

from agenta.sdk.agents import AgentRunFailed
from agenta.sdk.agents.utils.wire import result_from_wire


def test_result_failure_has_stable_code_and_sanitized_message() -> None:
    with pytest.raises(AgentRunFailed) as excinfo:
        result_from_wire(
            {
                "ok": False,
                "error": "provider failed\n    at run (/app/runner.ts:12:3)",
            }
        )

    assert isinstance(excinfo.value, RuntimeError)
    assert excinfo.value.failure_code == "agent_run_failed"
    assert excinfo.value.message == "provider failed"
    assert "/app/runner.ts" not in str(excinfo.value)


def test_result_parses_attachment_delivery_event() -> None:
    raw_event = {
        "type": "attachment_delivery",
        "attachmentId": "01996b6c-7b6b-7000-8000-000000000001",
        "outcome": "workspace_only",
        "reasonCode": "model_modality_unknown",
        "workingPath": "attachments/01996b6c-7b6b-7000-8000-000000000001/photo.png",
    }

    result = result_from_wire({"ok": True, "events": [raw_event]})

    assert len(result.events) == 1
    assert result.events[0].type == "attachment_delivery"
    assert result.events[0].data == raw_event
