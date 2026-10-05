import os

import pytest

from oss.src.utils.env import env


def pytest_collection_modifyitems(config, items):
    """Auto-mark unit tests under an `events/` dir as `real_events`.

    Those tests exercise the real publish/quota machinery (patching it
    locally), so they must opt out of the autouse event-publishing stub.
    """
    events_segment = f"{os.sep}events{os.sep}"
    for item in items:
        path = str(getattr(item, "fspath", ""))
        if events_segment in path:
            item.add_marker("real_events")


@pytest.fixture(autouse=True)
def _disable_caching(monkeypatch):
    """Unit tests must not touch Redis for response caching.

    `get_cache`/`set_cache`/`invalidate_cache` all short-circuit when
    `caching.enabled` is False. With no live Redis in the unit env each cache
    op otherwise blocks ~5s on a connection timeout (e.g. a single commit does
    GET+SET+FLUSH = ~15s). Flip the flag off so the cache layer no-ops.
    """
    monkeypatch.setattr(env.agenta.api.caching, "enabled", False, raising=False)


@pytest.fixture(autouse=True)
def _stub_event_publishing(request, monkeypatch):
    """Unit tests must not touch Redis/DB for event telemetry.

    Two real-I/O hops sit behind `_safe_publish`, each blocking ~5s on a
    connection timeout in the unit env:
      - `_check_l1_events_quota` (EE soft-check → Redis, then DB subscription
        fetch). An entitlements concern, not what these tests exercise.
      - `publish_event` (the Redis Stream `xadd`). Fire-and-forget telemetry.
    Stub both to the no-op/allow path. Patch `publish_event` at the source
    module and at the name already bound into events.utils.

    Tests that exercise the real publish/quota machinery opt out with
    `@pytest.mark.real_events`.
    """
    if request.node.get_closest_marker("real_events"):
        return

    async def _allow(**_kwargs):
        return True

    async def _noop_publish(**_kwargs):
        return True

    monkeypatch.setattr(
        "oss.src.core.events.utils._check_l1_events_quota",
        _allow,
        raising=False,
    )
    monkeypatch.setattr(
        "oss.src.core.events.streaming.publish_event",
        _noop_publish,
        raising=False,
    )
    monkeypatch.setattr(
        "oss.src.core.events.utils.publish_event",
        _noop_publish,
        raising=False,
    )
