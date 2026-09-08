"""``resolve_session_context`` against a mocked Agenta backend.

The agent service reads the per-turn session facts itself, because the playground posts a
turn straight to the service and never through the API that stamps them. These tests pin the
three reads, the pairing of the session name with the first-turn flag, and the rule that a
read which fails costs the prompt a fact and never the turn.
"""

from __future__ import annotations

import asyncio
import json
import math
import time
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


# --------------------------------------------------------------------------- #
# The total deadline
# --------------------------------------------------------------------------- #


def _slow_client(delay: float):
    """A client whose reads never finish inside a short budget."""

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(delay)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(delay)
            return _FakeResponse(200, {})

    return _Client


async def test_a_slow_backend_costs_the_budget_and_no_more(connection, monkeypatch):
    """The budget bounds TOTAL elapsed time, not one operation.

    A per-operation timeout does not bound this: a backend that trickles bytes resets it on
    every chunk while the turn waits. These facts are optional, so a slow backend must cost
    the user a prompt section rather than a wait.
    """
    monkeypatch.setattr(session_context.httpx, "AsyncClient", _slow_client(30.0))

    started = time.monotonic()
    context = await resolve_session_context(
        session_id="session-1",
        workflow_id=WORKFLOW_ID,
        connection=connection,
        timeout=0.1,
    )
    elapsed = time.monotonic() - started

    assert context is None
    assert elapsed < 1.0


async def test_the_budget_cancels_the_outstanding_reads(connection, monkeypatch):
    """An expired budget must not leave reads running against the backend.

    All three, not "at least one": both children of the nested gather have to go too, and a
    test that accepts one cancellation passes on a version that leaks the other two.
    """
    started: List[str] = []
    cancelled: List[str] = []

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def _hang(self, what: str):
            started.append(what)
            try:
                await asyncio.sleep(30.0)
            except asyncio.CancelledError:
                cancelled.append(what)
                raise
            return _FakeResponse(200, {})

        async def get(self, url, params=None, headers=None):
            return await self._hang("workflow" if "/workflows/" in url else "stream")

        async def post(self, url, json=None, headers=None):
            return await self._hang("turns")

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    assert (
        await resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=0.1,
        )
        is None
    )
    assert sorted(started) == ["stream", "turns", "workflow"]
    assert sorted(cancelled) == ["stream", "turns", "workflow"]


async def test_a_client_that_raises_on_construction_costs_only_the_facts(
    connection, monkeypatch
):
    """Client construction and teardown sit inside the boundary, not outside it."""

    def _explode(*args, **kwargs):
        raise RuntimeError("no transport")

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _explode)

    assert (
        await resolve_session_context(
            session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
        )
        is None
    )


async def test_an_outside_cancellation_is_not_swallowed(connection, monkeypatch):
    """The caller is going away, so this optional work goes with it."""
    monkeypatch.setattr(session_context.httpx, "AsyncClient", _slow_client(30.0))

    task = asyncio.ensure_future(
        resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=30.0,
        )
    )
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.parametrize(
    "raw, expected",
    [
        (None, session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("0.25", 0.25),
        ("nonsense", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("0", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("-3", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("inf", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("1e999", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
        ("nan", session_context.DEFAULT_SESSION_CONTEXT_TIMEOUT),
    ],
)
def test_the_budget_reads_its_env_override(monkeypatch, raw, expected):
    monkeypatch.delenv("AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT", raising=False)
    if raw is not None:
        monkeypatch.setenv("AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT", raw)
    assert session_context.session_context_timeout() == expected


# --------------------------------------------------------------------------- #
# Malformed session data is UNKNOWN, never "unnamed"
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "stream_body",
    [
        {"stream": []},
        {"stream": "a-session"},
        {"stream": {"name": 123}},
        {"stream": {"name": ["QA"]}},
        ["not", "an", "object"],
    ],
)
async def test_malformed_session_data_reports_unknown_not_unnamed(
    connection, routed, stream_body
):
    """The dangerous half of this module.

    Reading a shape we do not understand as "unnamed" would render "This session has no name
    yet. Name it with rename_session" at an already-named session, which is the bug this
    module exists to fix. Both halves of the pair go UNKNOWN instead.
    """
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _FakeResponse(200, stream_body),
            "/sessions/turns/query": _turns(3),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is None
    assert context.agent_name == "Changelog writer"


@pytest.mark.parametrize(
    "turns_body",
    [{"turns": "many"}, {"turns": {}}, {"count": 0}, ["not", "an", "object"]],
)
async def test_a_malformed_turns_answer_reports_unknown(connection, routed, turns_body):
    """An absent `turns` is not "no turns": the query always answers with the list it matched."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _FakeResponse(200, turns_body),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is None


@pytest.mark.parametrize("stream_body", [{"stream": None}, {"capabilities": {}}])
async def test_an_omitted_stream_is_a_legitimately_unnamed_session(
    connection, routed, stream_body
):
    """A session with no row yet has no name, however the backend spells that.

    This is the case the strictness above must NOT swallow: a real unnamed session still has
    to get its naming instruction.
    """
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _FakeResponse(200, stream_body),
            "/sessions/turns/query": _turns(0),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is True


async def test_an_explicitly_null_name_is_a_legitimately_unnamed_session(
    connection, routed
):
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _stream(None),
            "/sessions/turns/query": _turns(2),
        }
    )

    context = await resolve_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.session_name is None
    assert context.first_turn is False


@pytest.mark.parametrize(
    "workflow_body",
    [{"workflow": []}, {"workflow": {"name": 7}}, ["not", "an", "object"]],
)
async def test_a_malformed_workflow_answer_reports_no_agent_name(
    connection, routed, workflow_body
):
    """Malformed and absent read the same here: both render no name line, which is safe."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _FakeResponse(200, workflow_body),
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


async def test_an_infinite_budget_is_refused(monkeypatch):
    """An unbounded override would remove the one guarantee this module makes."""
    monkeypatch.setenv("AGENTA_AGENT_SESSION_CONTEXT_TIMEOUT", "inf")
    assert math.isfinite(session_context.session_context_timeout())


async def test_a_slow_teardown_cannot_run_past_the_grace(connection, monkeypatch):
    """`wait_for` awaits the cancelled coroutine's cleanup, which this must not inherit.

    The operation runs as its own task, so a teardown that outlives the grace is abandoned
    and the turn moves on rather than waiting for it.
    """
    monkeypatch.setattr(session_context, "CLEANUP_GRACE", 0.1)
    # budget 0.1 + grace 0.1 = 0.2, so bound it just above that. A one-second allowance
    # rejected the ten-second teardown too; this one also rejects a version that merely
    # waits several times longer than it promised.

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            await asyncio.sleep(10.0)
            return False

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(10.0)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(10.0)
            return _FakeResponse(200, {})

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    started = time.monotonic()
    context = await resolve_session_context(
        session_id="session-1",
        workflow_id=WORKFLOW_ID,
        connection=connection,
        timeout=0.1,
    )
    elapsed = time.monotonic() - started

    assert context is None
    assert elapsed < 0.5


async def test_a_failing_teardown_cannot_swallow_an_outside_cancel(
    connection, monkeypatch
):
    """The regression a bare `wait_for` introduces.

    Cleanup that raises REPLACES the in-flight CancelledError with an ordinary exception,
    which a broad except then absorbs, and the caller's cancel is silently lost. Running the
    operation as its own task keeps that failure off this frame.
    """

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            raise RuntimeError("teardown exploded")

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    task = asyncio.ensure_future(
        resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=30.0,
        )
    )
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert task.cancelled()


async def test_a_failing_teardown_after_the_budget_still_yields_no_facts(
    connection, monkeypatch
):
    """The same failure on the timeout path costs the prompt section, nothing more."""

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            raise RuntimeError("teardown exploded")

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    assert (
        await resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=0.1,
        )
        is None
    )


# --------------------------------------------------------------------------- #
# The detached cleanup, and the single deadline owner
# --------------------------------------------------------------------------- #


async def test_a_detached_cleanup_is_held_and_released(connection, monkeypatch):
    """An abandoned unwind needs a strong reference, or the loop can collect it mid-flight.

    A done callback is not a reference. Without one asyncio reports "Task was destroyed but
    it is pending!" and the client's connections are released at a time nobody chose.
    """
    monkeypatch.setattr(session_context, "CLEANUP_GRACE", 0.05)
    release = asyncio.Event()

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            await release.wait()
            return False

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    before = session_context.detached_count()
    assert (
        await resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=0.05,
        )
        is None
    )
    # The caller is done, and the unwind is still held rather than left to chance.
    assert session_context.detached_count() == before + 1

    release.set()
    for _ in range(200):
        await asyncio.sleep(0.01)
        if session_context.detached_count() == before:
            break
    # It lets go of itself once the teardown finishes, so the set does not grow forever.
    assert session_context.detached_count() == before


async def test_a_resolver_that_raises_before_awaiting_stays_inside_the_boundary():
    """`Callable[..., Awaitable[...]]` admits a factory that raises synchronously.

    Evaluating the call before entering the boundary lets such a resolver escape it and break
    the turn, which is the whole thing the boundary exists to prevent.
    """

    def explodes(*, session_id, workflow_id):
        raise RuntimeError("factory exploded before returning a coroutine")

    assert (
        await session_context.run_optional(
            lambda: explodes(session_id="s", workflow_id=None),
            budget=1.0,
            label="test",
        )
        is None
    )


async def test_the_unbounded_read_carries_no_deadline_of_its_own(connection, routed):
    """The handler supplies the only bound on its path, so this one must not add a second."""
    routed(
        {
            f"/workflows/{WORKFLOW_ID}": _workflow("Changelog writer"),
            "/sessions/streams/": _stream("Sapphire Ledger"),
            "/sessions/turns/query": _turns(1),
        }
    )

    context = await session_context.read_session_context(
        session_id="session-1", workflow_id=WORKFLOW_ID, connection=connection
    )

    assert context.agent_name == "Changelog writer"
    assert context.session_name == "Sapphire Ledger"


async def test_the_client_is_always_closed_on_the_abandonment_path(
    connection, monkeypatch
):
    """Abandoning the unwind must not mean skipping it.

    Cancelling the task raises into the `async with`, so the client's own close runs even
    when the caller has already been handed None. If that close then hangs there is nothing
    further to force: httpx exposes no way past `aclose`. The guarantee this pins is that
    the close is entered every time, and that the caller does not wait for it.
    """
    monkeypatch.setattr(session_context, "CLEANUP_GRACE", 0.05)
    closed = asyncio.Event()

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            closed.set()
            # Slower than the grace, so the caller abandons this unwind rather than wait.
            await asyncio.sleep(1.0)
            return False

        async def get(self, url, params=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

        async def post(self, url, json=None, headers=None):
            await asyncio.sleep(30.0)
            return _FakeResponse(200, {})

    monkeypatch.setattr(session_context.httpx, "AsyncClient", _Client)

    started = time.monotonic()
    assert (
        await resolve_session_context(
            session_id="session-1",
            workflow_id=WORKFLOW_ID,
            connection=connection,
            timeout=0.05,
        )
        is None
    )
    elapsed = time.monotonic() - started

    assert closed.is_set(), "the client's close never ran"
    # Entered, not awaited: the caller returned long before the 1 s teardown finished.
    assert elapsed < 0.5
