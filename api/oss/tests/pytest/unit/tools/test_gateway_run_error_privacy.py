"""What ``gateway.run`` may tell the MODEL when a connection is unavailable.

A connection is private routing. The model never names one: `run_tool` takes no connection
argument, the runner reads the connection from the agent's own configuration, and search
results carry integrations and tool keys only. So a connection slug or id in an error message
is the one place that identity could reach the model, and it reaches it on an ordinary failure
path — a connection revoked or deleted between resolve and run.

The domain exceptions carry the identifier on purpose, for the server log. These tests pin the
boundary: the detail is logged, the model gets a generic envelope, and no identifier crosses.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.tools.router import ToolsRouter
from oss.src.core.tools.dtos import (
    ToolCall,
    ToolCallContext,
    ToolCallData,
    ToolCallFunction,
)
from oss.src.core.tools.exceptions import (
    ConnectionInactiveError,
    ConnectionInvalidError,
    ConnectionNotFoundError,
)

# The values a leak would expose. Each is checked against the whole model-facing payload.
CONNECTION_SLUG = "github-work"
CONNECTION_ID = "ca_V82rwkwQBvEY"


class FakeToolsService:
    """Raises one connection exception from ``run_gateway_tool``."""

    def __init__(self, raises):
        self._raises = raises

    async def run_gateway_tool(self, **_kwargs):
        raise self._raises


def _router(tools_service):
    return ToolsRouter(
        tools_service=tools_service,
        workflows_service=SimpleNamespace(),
    )


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4())),
        headers={},
    )


def _body():
    return ToolCall(
        data=ToolCallData(
            id="call_1",
            function=ToolCallFunction(
                name="gateway.run",
                arguments={"owner": "agenta", "repo": "agenta"},
            ),
        ),
        context=ToolCallContext(
            provider="composio",
            integration="github",
            connection=CONNECTION_SLUG,
            tool="GET_ISSUE",
        ),
    )


def _model_facing_text(response) -> str:
    """Everything this response would put in front of the model, as one string.

    Deliberately the WHOLE payload rather than the message alone: a later change that moved
    the detail into `next_step`, or into the error `details` map, would still be a leak, and
    a test that reads one field would not see it.
    """
    return json.dumps(
        {
            "content": response.call.data.content,
            "status": response.call.status.message,
        },
        default=str,
    )


CONNECTION_FAILURES = [
    pytest.param(
        ConnectionNotFoundError(
            provider_key="composio",
            integration_key="github",
            connection_slug=CONNECTION_SLUG,
        ),
        id="not_found",
    ),
    pytest.param(
        ConnectionInactiveError(connection_id=CONNECTION_ID),
        id="inactive",
    ),
    pytest.param(
        ConnectionInvalidError(connection_slug=CONNECTION_SLUG),
        id="invalid",
    ),
]


@pytest.mark.parametrize("failure", CONNECTION_FAILURES)
async def test_no_connection_identifier_reaches_the_model(failure):
    response = await _router(FakeToolsService(failure))._call_gateway_run(
        request=_request(),
        body=_body(),
    )

    payload = _model_facing_text(response)
    assert CONNECTION_SLUG not in payload
    assert CONNECTION_ID not in payload
    # The exception's own message is what used to be forwarded verbatim.
    assert failure.message not in payload


@pytest.mark.parametrize("failure", CONNECTION_FAILURES)
async def test_the_model_is_told_what_it_can_act_on(failure):
    response = await _router(FakeToolsService(failure))._call_gateway_run(
        request=_request(),
        body=_body(),
    )

    # The content IS the error envelope: `_agent_error_result` dumps the AgentError as the
    # tool result content over a 200, because the runner hides a non-2xx body from the model.
    error = json.loads(response.call.data.content)
    # One code for all three: which of them it was is a server-side distinction, and the
    # model's move is the same either way.
    assert error["code"] == "connection_unavailable"
    assert error["message"] == (
        "The configured connection for this integration is unavailable."
    )
    assert error["retryable"] is False
    # Reconnecting is a person's job, so the next step must send the model to the person
    # rather than leave it retrying a call that cannot start succeeding.
    assert "reconnect this integration" in error["next_step"]


@pytest.mark.parametrize("failure", CONNECTION_FAILURES)
async def test_the_detail_is_kept_for_the_server_log(failure, caplog):
    with caplog.at_level("WARNING"):
        await _router(FakeToolsService(failure))._call_gateway_run(
            request=_request(),
            body=_body(),
        )

    # Redaction must not become deletion: an operator debugging a revoked connection needs
    # the identifier the model was denied, so the log keeps what the envelope drops.
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "[gateway.run] connection unavailable" in logged
