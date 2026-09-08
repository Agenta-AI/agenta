"""``resolve_session_context`` against a mocked Agenta backend.

The agent service reads the per-turn session facts itself, because the playground posts a
turn straight to the service and never through the API that stamps them. These tests pin the
three reads, the pairing of the session name with the first-turn flag, and the rule that a
read which fails costs the prompt a fact and never the turn.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import pytest

from agenta.sdk.agents.platform import PlatformConnection, session_context
from agenta.sdk.agents.platform import resolve_session_context

WORKFLOW_ID = "0199e0d0-0000-7000-8000-00000000abcd"


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = json.dumps(self._payload)

    def json(self) -> Any:
        return self._payload


def _routed_client(routes: Dict[str, Any], calls: List[Dict[str, Any]]):
    """A fake `httpx.AsyncClient` that answers per URL suffix.

    A route value is a `_FakeResponse` to return, or an exception to raise. A URL with no
    route is a test bug, so it raises `AssertionError` rather than answering by default.
    """

    def _answer(url: str):
        for suffix, outcome in routes.items():
            if url.endswith(suffix):
                if isinstance(outcome, BaseException):
                    raise outcome
                return outcome
        raise AssertionError(f"unrouted URL: {url}")

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None, headers=None):
            calls.append(
                {"method": "GET", "url": url, "params": params, "headers": headers}
            )
            return _answer(url)

        async def post(self, url, json=None, headers=None):
            calls.append(
                {"method": "POST", "url": url, "json": json, "headers": headers}
            )
            return _answer(url)

    return _Client


@pytest.fixture
def routed(monkeypatch):
    def _install(routes: Dict[str, Any]) -> List[Dict[str, Any]]:
        calls: List[Dict[str, Any]] = []
        monkeypatch.setattr(
            session_context.httpx,
            "AsyncClient",
            _routed_client(routes, calls),
        )
        return calls

    return _install


def _workflow(name: Optional[str]) -> _FakeResponse:
    return _FakeResponse(200, {"count": 1, "workflow": {"name": name}})


def _stream(name: Optional[str]) -> _FakeResponse:
    return _FakeResponse(200, {"stream": {"id": "s1", "name": name}})


def _turns(count: int) -> _FakeResponse:
    return _FakeResponse(200, {"count": count, "turns": [{}] * count})


async def test_an_unconfigured_backend_resolves_nothing(routed):
    """No base URL means no reads at all, and no prompt section."""
    routed({})
    assert (
        await resolve_session_context(session_id="s", workflow_id=WORKFLOW_ID) is None
    )


async def test_the_three_facts_are_read_from_the_backend(connection, routed):
    calls = routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _turns(1),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.agent_name == "Changelog writer"
    assert context.session_name == "Sapphire Ledger"
    assert context.first_turn is False

    by_url = {call["url"]: call for call in calls}
    stream_call = by_url["https://api.x/api/sessions/streams/"]
    assert stream_call["params"] == {"session_id": "session-1"}
    turns_call = by_url["https://api.x/api/sessions/turns/query"]
    assert turns_call["json"] == {
        "query": {"session_id": "session-1"},
        "windowing": {"limit": 1},
    }
    # Every read carries the caller's credential; the run never widens its own scope.
    assert all(call["headers"]["Authorization"] == "Access tok" for call in calls)


async def test_a_session_with_no_turn_row_yet_is_the_first_turn(connection, routed):
    """The runner appends a turn row as the turn executes, so an empty list means first."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _stream(None),
            "/sessions/turns/query": _turns(0),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is True


async def test_a_run_with_no_session_id_asserts_the_first_turn_without_reading(
    connection, routed
):
    """That run opens a fresh session, so it is first and unnamed. No read can say otherwise."""
    calls = routed({f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer")})

    context = await resolve_session_context(
        session_id=None, workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.first_turn is True
    assert context.session_name is None
    assert [call["url"] for call in calls] == [
        f"https://api.x/api/workflows/{WORKFLOW_ID}"
    ]


async def test_a_draft_run_reports_no_agent_name(connection, routed):
    """A run with no workflow artifact has no name to report, and reads none."""
    calls = routed(
        {
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _turns(2),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=None, connection=connection
    )

    assert context.agent_name is None
    assert context.session_name == "Sapphire Ledger"
    assert not [call for call in calls if "/workflows/" in call["url"]]


@pytest.mark.parametrize(
    "routes",
    [
        {
            "/sessions/streams/": _FakeResponse(403, {}),
            "/sessions/turns/query": _turns(3),
        },
        {
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _FakeResponse(500, {}),
        },
        {
            "/sessions/streams/": RuntimeError("backend down"),
            "/sessions/turns/query": _turns(3),
        },
    ],
)
async def test_a_half_read_session_reports_neither_fact(connection, routed, routes):
    """The name and the turn position are one fact pair.

    An unread name beside ``first_turn=False`` renders "This session has no name yet",
    which tells a named session to rename itself. Both go UNKNOWN together.
    """
    routed({f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"), **routes})

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is None
    # The agent name survives: it comes from a different read.
    assert context.agent_name == "Changelog writer"


async def test_an_unreadable_workflow_costs_only_the_agent_name(connection, routed):
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _FakeResponse(404, {}),
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _turns(1),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.agent_name is None
    assert context.session_name == "Sapphire Ledger"
    assert context.first_turn is False


async def test_nothing_readable_resolves_to_no_context(connection, routed):
    """No fact at all means no prompt section, not a section of unknowns."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _FakeResponse(500, {}),
            "/sessions/streams/": _FakeResponse(500, {}),
            "/sessions/turns/query": _FakeResponse(500, {}),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context is None


async def test_a_blank_name_reads_as_unnamed(connection, routed):
    """A cleared title is stored as an empty string; the renderer must see UNNAMED, not "" ."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("   "),
            "/sessions/streams/": _stream(""),
            "/sessions/turns/query": _turns(4),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.agent_name is None
    assert context.session_name is None
    assert context.first_turn is False


async def test_an_unexpected_body_shape_reads_as_unknown(connection, routed):
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _FakeResponse(200, ["not", "a", "dict"]),
            "/sessions/streams/": _FakeResponse(200, {"stream": None}),
            "/sessions/turns/query": _FakeResponse(200, {"turns": "many"}),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context is None


async def test_an_unset_connection_is_built_from_the_ambient_config():
    """The service passes no connection; the SDK's own resolution must still apply."""
    assert isinstance(PlatformConnection(), PlatformConnection)
    assert await resolve_session_context(session_id="s", workflow_id=None) is None
