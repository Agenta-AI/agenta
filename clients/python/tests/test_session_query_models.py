import asyncio
import json

import httpx

from agenta_client.client import AgentaApi, AsyncAgentaApi
from agenta_client.types import (
    Reference,
    SessionDelivery,
    SessionExcludeRequest,
    SessionMessagePreview,
    SessionPredicatesRequest,
    SessionStreamQueryFlags,
    SessionTrigger,
    SessionsResponse,
    Windowing,
)

EXPECTED_REQUEST = {
    "session": {
        "search": "refund",
        "liveness": {"is_alive": True},
        "origins": ["trigger"],
    },
    "session_ids": ["session-a"],
    "exclude": {
        "origins": ["manual"],
        "session_ids": ["session-pinned"],
    },
    "turn_references": [{"id": "agent-a"}],
    "include_ended": True,
    "include_archived": False,
    "include_total": True,
    "expand": ["last_message", "trigger"],
    "windowing": {"limit": 30, "order": "descending"},
}

RESPONSE = {
    "count": 2,
    "total": 9,
    "sessions": [
        {
            "id": "row-a",
            "project_id": "project-a",
            "session_id": "session-a",
            "origin": "trigger",
            "trigger": {
                "id": "trigger-a",
                "kind": "schedule",
                "name": "Nightly digest",
            },
            "delivery": {"id": "delivery-a"},
            "last_message": {
                "text": "Digest delivered.",
                "source": "agent",
                "timestamp": "2026-08-10T12:03:14Z",
            },
        },
        {
            "project_id": "project-a",
            "session_id": "session-unknown-origin",
        },
    ],
    "windowing": {
        "next": "row-a",
        "newest": "2026-08-10T12:03:14Z",
        "limit": 30,
        "order": "descending",
    },
}


def _query_arguments() -> dict[str, object]:
    return {
        "session": SessionPredicatesRequest(
            search="refund",
            liveness=SessionStreamQueryFlags(is_alive=True),
            origins=["trigger"],
        ),
        "session_ids": ["session-a"],
        "exclude": SessionExcludeRequest(
            session_ids=["session-pinned"],
            origins=["manual"],
        ),
        "turn_references": [Reference(id="agent-a")],
        "include_ended": True,
        "include_archived": False,
        "include_total": True,
        "expand": ["last_message", "trigger"],
        "windowing": Windowing(limit=30, order="descending"),
    }


def _assert_response(response: SessionsResponse) -> None:
    session = response.sessions[0]
    assert response.total == 9
    assert session.origin == "trigger"
    assert isinstance(session.trigger, SessionTrigger)
    assert session.trigger.kind == "schedule"
    assert session.trigger.name == "Nightly digest"
    assert isinstance(session.delivery, SessionDelivery)
    assert session.delivery.id == "delivery-a"
    assert isinstance(session.last_message, SessionMessagePreview)
    assert session.last_message.text == "Digest delivered."
    assert response.windowing is not None
    assert response.windowing.next == "row-a"
    assert response.windowing.order == "descending"

    unknown_origin = response.sessions[1]
    assert unknown_origin.origin is None
    assert unknown_origin.delivery is None


def test_sync_query_sessions_emits_canonical_json() -> None:
    requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=RESPONSE)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        client = AgentaApi(
            base_url="https://api.example.test",
            api_key="ApiKey test",
            httpx_client=http_client,
        )
        response = client.sessions.query_sessions(**_query_arguments())

    assert requests == [EXPECTED_REQUEST]
    _assert_response(response)


def test_async_query_sessions_emits_canonical_json() -> None:
    requests: list[dict[str, object]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=RESPONSE)

    async def run() -> SessionsResponse:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as http_client:
            client = AsyncAgentaApi(
                base_url="https://api.example.test",
                api_key="ApiKey test",
                httpx_client=http_client,
            )
            return await client.sessions.query_sessions(**_query_arguments())

    response = asyncio.run(run())

    assert requests == [EXPECTED_REQUEST]
    _assert_response(response)


def test_sessions_response_parses_omitted_unknown_origin() -> None:
    response = SessionsResponse.model_validate(RESPONSE)

    _assert_response(response)
