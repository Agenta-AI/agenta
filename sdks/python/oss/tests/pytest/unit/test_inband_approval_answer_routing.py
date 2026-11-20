"""A person's in-band approval answer is recorded on its interaction row before the run.

The runner takes an approval decision only from a ``responded`` row. A caller that answers
a card inside the messages (the public Vercel ``tool-approval-response`` input) leaves no row,
so the service sends the answer to the transition route first, with the caller's own
credential, and the API decides whether that credential may answer.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from starlette.requests import Request

from agenta.sdk.decorators.routing import (
    MAX_INBAND_APPROVAL_ANSWERS,
    apply_invoke_prelude,
    record_inband_approval_answers,
)
from agenta.sdk.models.workflows import WorkflowInvokeRequest


def _request(headers=None) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invoke",
            "headers": raw,
            "query_string": b"",
        }
    )
    # What the auth middleware leaves behind: the EXCHANGED credential, never sent here.
    request.state.auth = {"credentials": "Secret exchanged-run-credential"}
    return request


class _Client:
    def __init__(self, responses, captured):
        self.responses = list(responses)
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        self.captured.append({"url": url, **kwargs})
        response = self.responses.pop(0) if self.responses else 200
        if isinstance(response, Exception):
            raise response
        return SimpleNamespace(status_code=response)


def _platform():
    connection = MagicMock()
    connection.base_url.return_value = "https://platform.example/api"
    connection.timeout = 3
    return connection


def _resume(*answers, meta=None, history=()):
    """A resume whose current turn carries these approval envelopes."""
    return WorkflowInvokeRequest(
        session_id="session-1",
        meta=meta,
        data={
            "inputs": {
                "messages": [
                    *history,
                    {"role": "user", "content": "send the email"},
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_result",
                                "toolCallId": tool_call_id,
                                "output": output,
                            }
                            for tool_call_id, output in answers
                        ],
                    },
                ]
            }
        },
    )


async def _record(req, request, responses=(), client_kwargs=None):
    captured = []

    def _client(**kwargs):
        if client_kwargs is not None:
            client_kwargs.update(kwargs)
        return _Client(responses, captured)

    with (
        patch(
            "agenta.sdk.decorators.routing.PlatformConnection",
            return_value=_platform(),
        ),
        patch(
            "agenta.sdk.decorators.routing.httpx.AsyncClient",
            side_effect=_client,
        ),
    ):
        await record_inband_approval_answers(req, request)
    return captured


@pytest.mark.asyncio
async def test_an_api_key_answer_is_recorded_as_responded_with_the_original_credential():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
    )

    assert len(captured) == 1
    call = captured[0]
    assert (
        call["url"] == "https://platform.example/api/sessions/interactions/transition"
    )
    # The caller's own credential, not the one the middleware exchanged it for.
    assert call["headers"]["Authorization"] == "ApiKey person-key"
    assert call["json"] == {
        "session_id": "session-1",
        "token": "tok-1",
        "status": "responded",
        "resolution": {"verdict": "approved", "tool_call_id": "tc-1"},
    }


@pytest.mark.asyncio
async def test_a_denial_is_recorded_as_denied():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": False, "interactionToken": "tok-1"})),
    )

    assert captured[0]["json"]["resolution"] == {
        "verdict": "denied",
        "tool_call_id": "tc-1",
    }


@pytest.mark.asyncio
async def test_a_refused_answer_does_not_raise():
    # A run credential answering in-band: the API refuses it, the row stays pending, and
    # nothing raises, so the run starts and the gate shows the card again.
    captured = await _record(
        _request({"Authorization": "Secret run-credential"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
        responses=[403],
    )

    assert len(captured) == 1
    assert captured[0]["headers"]["Authorization"] == "Secret run-credential"


@pytest.mark.asyncio
async def test_an_unreachable_api_does_not_stop_the_run():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
        responses=[httpx.ConnectError("down")],
    )

    assert len(captured) == 1


@pytest.mark.asyncio
async def test_a_delivery_the_api_made_itself_is_not_recorded_again():
    # The respond route already stored the answer before it dispatched this resume.
    for meta in ({"control_command_id": "cmd-1"}, {"promoted_input_id": "in-1"}):
        captured = await _record(
            _request({"Authorization": "Secret run-credential"}),
            _resume(
                ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
                meta=meta,
            ),
        )
        assert captured == []


@pytest.mark.asyncio
async def test_only_answers_with_a_token_in_the_current_turn_are_recorded():
    earlier_turn = [
        {"role": "user", "content": "first"},
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_result",
                    "toolCallId": "tc-old",
                    "output": {"approved": True, "interactionToken": "tok-old"},
                }
            ],
        },
    ]
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(
            ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
            ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
            ("tc-2", {"approved": True}),
            ("tc-3", {"result": "a tool's own output"}),
            history=earlier_turn,
        ),
    )

    assert [call["json"]["token"] for call in captured] == ["tok-1"]


@pytest.mark.asyncio
async def test_no_credential_means_nothing_is_sent():
    captured = await _record(
        _request(),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
    )

    assert captured == []


@pytest.mark.asyncio
async def test_the_public_vercel_approval_response_part_is_recorded():
    # The documented input: a `tool-approval-response` part whose `approvalId` is the row's
    # token, as the old app and API key callers send it.
    req = _request(
        {"Authorization": "ApiKey person-key", "x-ag-messages-format": "vercel"}
    )
    request = WorkflowInvokeRequest(
        session_id="session-1",
        data={
            "inputs": {
                "messages": [
                    {
                        "id": "u1",
                        "role": "user",
                        "parts": [{"type": "text", "text": "send it"}],
                    },
                    {
                        "id": "a1",
                        "role": "assistant",
                        "parts": [
                            {
                                "type": "tool-approval-response",
                                "toolCallId": "tc-1",
                                "approvalId": "tok-1",
                                "approved": True,
                            }
                        ],
                    },
                ]
            }
        },
    )
    apply_invoke_prelude(req, request)

    captured = await _record(req, request)

    assert [call["json"]["token"] for call in captured] == ["tok-1"]
    assert captured[0]["json"]["resolution"] == {
        "verdict": "approved",
        "tool_call_id": "tc-1",
    }


@pytest.mark.asyncio
async def test_a_browser_session_cookie_is_sent_when_there_is_no_header():
    req = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/invoke",
            "headers": [(b"cookie", b"sAccessToken=person-session")],
            "query_string": b"project_id=project-1",
        }
    )
    client_kwargs = {}
    captured = await _record(
        req,
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
        client_kwargs=client_kwargs,
    )

    assert client_kwargs["cookies"] == {"sAccessToken": "person-session"}
    assert "Authorization" not in captured[0]["headers"]
    assert captured[0]["params"] == {"project_id": "project-1"}


@pytest.mark.asyncio
async def test_an_answered_vercel_tool_part_is_recorded():
    # The inline form: the AI SDK keeps the decision on the tool part itself.
    req = _request(
        {"Authorization": "ApiKey person-key", "x-ag-messages-format": "vercel"}
    )
    request = WorkflowInvokeRequest(
        session_id="session-1",
        data={
            "inputs": {
                "messages": [
                    {
                        "id": "u1",
                        "role": "user",
                        "parts": [{"type": "text", "text": "send it"}],
                    },
                    {
                        "id": "a1",
                        "role": "assistant",
                        "parts": [
                            {
                                "type": "tool-send_email",
                                "toolCallId": "tc-1",
                                "state": "approval-responded",
                                "input": {"to": "sam"},
                                "approval": {"id": "tok-1", "approved": False},
                            }
                        ],
                    },
                ]
            }
        },
    )
    apply_invoke_prelude(req, request)

    captured = await _record(req, request)

    assert [call["json"]["token"] for call in captured] == ["tok-1"]
    assert captured[0]["json"]["resolution"] == {
        "verdict": "denied",
        "tool_call_id": "tc-1",
    }


@pytest.mark.asyncio
async def test_a_chat_request_with_no_answer_sends_nothing_and_does_not_raise():
    # A chat workflow in a session: an assistant message with `content: null` and tool
    # calls is valid input and must reach the workflow untouched.
    request = WorkflowInvokeRequest(
        session_id="session-1",
        data={
            "inputs": {
                "messages": [
                    {"role": "user", "content": "weather?"},
                    {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{"id": "c1", "type": "function"}],
                    },
                    {"role": "tool", "tool_call_id": "c1", "content": "sunny"},
                ]
            }
        },
    )

    captured = await _record(_request({"Authorization": "ApiKey person-key"}), request)

    assert captured == []


@pytest.mark.asyncio
async def test_an_answer_with_no_tool_call_id_is_not_recorded():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume((None, {"approved": True, "interactionToken": "tok-1"})),
    )

    assert captured == []


@pytest.mark.asyncio
async def test_one_request_records_a_bounded_number_of_answers():
    answers = [
        (f"tc-{i}", {"approved": True, "interactionToken": f"tok-{i}"})
        for i in range(MAX_INBAND_APPROVAL_ANSWERS + 10)
    ]
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(*answers),
    )

    tokens = [call["json"]["token"] for call in captured]
    assert len(tokens) == MAX_INBAND_APPROVAL_ANSWERS
    # The newest answer is always inside the bound, so a resent turn whose settled answers
    # come first still records the one the person just gave.
    assert tokens[-1] == f"tok-{MAX_INBAND_APPROVAL_ANSWERS + 9}"
    assert "tok-0" not in tokens


@pytest.mark.asyncio
async def test_the_api_asking_to_slow_down_stops_the_recording():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(
            ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
            ("tc-2", {"approved": True, "interactionToken": "tok-2"}),
        ),
        responses=[429, 200],
    )

    assert len(captured) == 1
