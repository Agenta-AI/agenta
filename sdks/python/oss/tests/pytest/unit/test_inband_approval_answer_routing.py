"""A person's in-band approval answer is recorded on its interaction row before the run,
and the run continues the turn that paused.

The runner takes an approval decision only from a ``responded`` row. A caller that answers
a card inside the messages (the public Vercel ``tool-approval-response`` input) leaves no row,
so the service sends the answer to the respond route first, the route that the app uses,
with the caller's own credential, and the API decides whether that credential may answer.
The API stores a continuation of the paused execution and leaves it to this request, which
then runs under its execution id, command id and session turn id.
"""

from unittest.mock import MagicMock, patch

import httpx
import pytest
from starlette.requests import Request

from agenta.sdk.decorators.routing import (
    MAX_INBAND_APPROVAL_ANSWERS,
    admit_session_input,
    apply_invoke_prelude,
    record_inband_approval_answers,
)
from agenta.sdk.models.workflows import WorkflowInvokeRequest

API = "https://platform.example/api"


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


def _admission(execution_id="exec-1"):
    """What the respond route answers when it stored a continuation for the caller."""
    return {
        "interaction": {},
        "command": {"id": f"cmd-{execution_id}", "state": "pending"},
        "execution": {
            "id": f"cont-{execution_id}",
            "state": "pending_delivery",
            "session_turn_id": "turn-start",
        },
    }


class _Response:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body if body is not None else {}

    def json(self):
        return self._body


class _Client:
    """The interactions query answers one row per token, paused on `rows[token]`
    (`exec-1` by default). Each respond call takes the next of `responses`."""

    def __init__(self, responses, captured, rows):
        self.responses = list(responses)
        self.captured = captured
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        self.captured.append({"url": url, **kwargs})
        if url.endswith("/sessions/interactions/query"):
            return _Response(
                200,
                {
                    "interactions": [
                        {"id": f"id-{token}", "token": token, "turn_id": execution}
                        for token, execution in self.rows.items()
                    ]
                },
            )
        response = self.responses.pop(0) if self.responses else 202
        if isinstance(response, Exception):
            raise response
        if isinstance(response, _Response):
            return response
        execution = url.split("/id-")[1].split("/")[0] if "/id-" in url else ""
        return _Response(
            response,
            _admission(self.rows.get(execution, "exec-1"))
            if response < 400
            else {"detail": "refused"},
        )


def _platform():
    connection = MagicMock()
    connection.base_url.return_value = API
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


def _tokens(request):
    found = []
    for message in request.data.inputs["messages"]:
        content = message.get("content")
        for block in content if isinstance(content, list) else []:
            token = (block.get("output") or {}).get("interactionToken")
            if isinstance(token, str):
                found.append(token)
    return found


async def _record(req, request, responses=(), client_kwargs=None, rows=None):
    captured = []
    if rows is None:
        rows = {token: "exec-1" for token in _tokens(request)}

    def _client(**kwargs):
        if client_kwargs is not None:
            client_kwargs.update(kwargs)
        return _Client(responses, captured, rows)

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


def _responds(captured):
    return [call for call in captured if call["url"].endswith("/respond")]


def _answered(captured):
    """(interaction id, answer) of every respond call, in order."""
    return [
        (item["interaction_id"], item["answer"])
        for call in _responds(captured)
        for item in call["json"]["answers"]
    ]


@pytest.mark.asyncio
async def test_an_api_key_answer_continues_the_paused_turn_with_the_original_credential():
    request = _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"}))
    captured = await _record(_request({"Authorization": "ApiKey person-key"}), request)

    query, respond = captured
    assert query["url"] == f"{API}/sessions/interactions/query"
    assert query["json"] == {
        "query": {"session_id": "session-1", "kind": "user_approval"}
    }
    assert respond["url"] == f"{API}/sessions/interactions/id-tok-1/respond"
    # The caller's own credential, not the one the middleware exchanged it for.
    assert respond["headers"]["Authorization"] == "ApiKey person-key"
    assert respond["headers"]["Idempotency-Key"].startswith("inband-approval:exec-1:")
    assert respond["json"] == {
        "answers": [
            {
                "interaction_id": "id-tok-1",
                "answer": {"approved": True, "tool_call_id": "tc-1"},
            }
        ],
        "expected_execution_id": "exec-1",
        "delivery": "caller",
    }
    # The run is the continuation the API stored: the execution after the paused one,
    # in the turn that paused, so the turn's end reaches whoever waits on that turn.
    assert request.meta == {
        "run_id": "cont-exec-1",
        "control_command_id": "cmd-exec-1",
        "session_turn_id": "turn-start",
    }


@pytest.mark.asyncio
async def test_a_retried_answer_sends_the_same_idempotency_key():
    first = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
    )
    second = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
    )

    assert (
        _responds(first)[0]["headers"]["Idempotency-Key"]
        == _responds(second)[0]["headers"]["Idempotency-Key"]
    )


@pytest.mark.asyncio
async def test_a_denial_is_recorded_as_denied():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": False, "interactionToken": "tok-1"})),
    )

    assert _answered(captured) == [
        ("id-tok-1", {"approved": False, "tool_call_id": "tc-1"})
    ]


@pytest.mark.asyncio
async def test_a_refused_answer_does_not_raise_and_runs_as_before():
    # A run credential answering in-band: the API refuses it, the row stays pending, and
    # nothing raises, so the run starts and the gate shows the card again.
    request = _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"}))
    captured = await _record(
        _request({"Authorization": "Secret run-credential"}),
        request,
        responses=[403],
    )

    assert len(_responds(captured)) == 1
    assert _responds(captured)[0]["headers"]["Authorization"] == (
        "Secret run-credential"
    )
    assert request.meta is None


@pytest.mark.asyncio
async def test_an_answer_that_leaves_another_gate_waiting_runs_as_before():
    # The turn paused on two gates and the request answers one: the API stores the
    # answer and no continuation yet.
    request = _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"}))
    waiting = _Response(
        202,
        {
            "interaction": {},
            "command": None,
            "execution": {"id": "exec-1", "state": "awaiting_interactions"},
        },
    )
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}), request, responses=[waiting]
    )

    assert len(_responds(captured)) == 1
    assert request.meta is None


@pytest.mark.asyncio
async def test_an_unreachable_api_does_not_stop_the_run():
    request = _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"}))
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        request,
        responses=[httpx.ConnectError("down")],
    )

    assert len(_responds(captured)) == 1
    assert request.meta is None


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
async def test_a_continuation_skips_the_busy_admission():
    # The paused turn makes the session busy; its continuation must not queue behind it.
    request = _resume(
        ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
        meta={"run_id": "cont-1", "control_command_id": "cmd-1"},
    )
    request.on_busy = "queue"

    with patch("agenta.sdk.decorators.routing.PlatformConnection") as connection:
        assert await admit_session_input(_request(), request, "ApiKey key") is None
    connection.assert_not_called()


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

    assert [interaction for interaction, _ in _answered(captured)] == ["id-tok-1"]


@pytest.mark.asyncio
async def test_an_unknown_token_is_not_answered():
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        _resume(("tc-1", {"approved": True, "interactionToken": "tok-1"})),
        rows={},
    )

    assert _responds(captured) == []


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

    captured = await _record(req, request, rows={"tok-1": "exec-1"})

    assert _answered(captured) == [
        ("id-tok-1", {"approved": True, "tool_call_id": "tc-1"})
    ]


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
    for call in captured:
        assert "Authorization" not in call["headers"]
        assert call["params"] == {"project_id": "project-1"}


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

    captured = await _record(req, request, rows={"tok-1": "exec-1"})

    assert _answered(captured) == [
        ("id-tok-1", {"approved": False, "tool_call_id": "tc-1"})
    ]


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

    ids = [interaction for interaction, _ in _answered(captured)]
    assert len(ids) == MAX_INBAND_APPROVAL_ANSWERS
    # The newest answer is always inside the bound, so a resent turn whose settled answers
    # come first still records the one the person just gave.
    assert ids[-1] == f"id-tok-{MAX_INBAND_APPROVAL_ANSWERS + 9}"
    assert "id-tok-0" not in ids


@pytest.mark.asyncio
async def test_the_api_asking_to_slow_down_stops_the_recording():
    request = _resume(
        ("tc-1", {"approved": True, "interactionToken": "tok-1"}),
        ("tc-2", {"approved": True, "interactionToken": "tok-2"}),
    )
    captured = await _record(
        _request({"Authorization": "ApiKey person-key"}),
        request,
        responses=[429, 202],
        rows={"tok-1": "exec-1", "tok-2": "exec-2"},
    )

    assert len(_responds(captured)) == 1
    assert request.meta is None
