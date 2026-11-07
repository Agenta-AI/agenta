"""`POST /admin/triggers/deliveries/settle`: the lock and the order of its steps."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.triggers import router as router_module
from oss.src.apis.fastapi.triggers.router import TriggersRouter


@pytest.fixture
def steps(monkeypatch):
    calls = []

    async def acquire(**kwargs):
        calls.append(("acquire", kwargs))
        return "owner-token"

    async def release(**kwargs):
        calls.append(("release", kwargs))
        return True

    monkeypatch.setattr(router_module, "acquire_lock", acquire)
    monkeypatch.setattr(router_module, "release_lock", release)
    return calls


def _router(calls, *, settle_error=None, send_error=None):
    async def settle_pass():
        calls.append(("settle", {}))
        if settle_error:
            raise settle_error

    async def send_pending(**_):
        calls.append(("send", {}))
        if send_error:
            raise send_error

    outcomes = MagicMock(settle_pass=settle_pass)
    notifications = MagicMock(send_pending=send_pending)
    return TriggersRouter(
        triggers_service=MagicMock(),
        outcomes_service=outcomes,
        notifications_service=notifications,
    )


LOCK = {"namespace": "triggers", "key": "settle-pass"}


async def test_the_route_settles_sends_and_releases(steps):
    result = await _router(steps).settle_deliveries()

    assert result == {"status": "success"}
    assert steps == [
        ("acquire", {**LOCK, "ttl": 600}),
        ("settle", {}),
        ("send", {}),
        ("release", {**LOCK, "owner": "owner-token"}),
    ]


async def test_the_send_step_runs_when_the_pass_raises(steps):
    result = await _router(steps, settle_error=RuntimeError()).settle_deliveries()

    assert result == {"status": "failure"}
    assert [name for name, _ in steps] == ["acquire", "settle", "send", "release"]


async def test_the_lock_is_released_when_the_send_step_raises(steps):
    with pytest.raises(HTTPException):
        await _router(steps, send_error=RuntimeError()).settle_deliveries()

    assert [name for name, _ in steps][-1] == "release"


async def test_a_held_lock_returns_at_once(monkeypatch):
    monkeypatch.setattr(router_module, "acquire_lock", AsyncMock(return_value=None))
    release = AsyncMock()
    monkeypatch.setattr(router_module, "release_lock", release)
    calls = []

    result = await _router(calls).settle_deliveries()

    assert result == {"status": "skipped"}
    assert calls == []
    release.assert_not_awaited()
