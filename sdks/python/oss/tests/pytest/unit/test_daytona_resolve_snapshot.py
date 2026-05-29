from unittest.mock import MagicMock

import httpx
import pytest

from agenta.sdk.engines.running.runners.daytona import DaytonaRunner


def _make_response(items):
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {"items": items}
    return response


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-key")
    monkeypatch.delenv("DAYTONA_API_URL", raising=False)
    monkeypatch.setenv("DAYTONA_SNAPSHOT", "snap")
    monkeypatch.setenv("DAYTONA_TARGET", "eu")
    r = DaytonaRunner()
    # Singleton bleed-through: ensure a clean cache between tests.
    r._snapshot_id_cache.cache.clear()
    return r


def test_resolve_snapshot_id_returns_matching_active_snapshot(runner, monkeypatch):
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append((url, params, headers))
        return _make_response(
            [
                {"id": "id-1", "name": "other", "state": "active", "regionIds": ["eu"]},
                {"id": "id-2", "name": "snap", "state": "active", "regionIds": ["eu"]},
                {"id": "id-3", "name": "snap", "state": "active", "regionIds": ["us"]},
            ]
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    assert runner._resolve_snapshot_id() == "id-2"
    assert len(calls) == 1
    assert calls[0][1] == {"limit": 100}
    assert calls[0][2] == {"Authorization": "Bearer test-key"}


def test_resolve_snapshot_id_uses_cache_on_second_call(runner, monkeypatch):
    call_count = {"n": 0}

    def fake_get(url, params=None, headers=None, timeout=None):
        call_count["n"] += 1
        return _make_response(
            [{"id": "id-1", "name": "snap", "state": "active", "regionIds": ["eu"]}]
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    assert runner._resolve_snapshot_id() == "id-1"
    assert runner._resolve_snapshot_id() == "id-1"
    assert call_count["n"] == 1


def test_resolve_snapshot_id_caches_per_target(runner, monkeypatch):
    responses_by_target = {
        "eu": [{"id": "eu-id", "name": "snap", "state": "active", "regionIds": ["eu"]}],
        "us": [{"id": "us-id", "name": "snap", "state": "active", "regionIds": ["us"]}],
    }
    seen_targets = []

    def fake_get(url, params=None, headers=None, timeout=None):
        # The endpoint isn't target-scoped; we filter client-side.
        # Return the union so per-target filtering is exercised.
        seen_targets.append(params)
        return _make_response(responses_by_target["eu"] + responses_by_target["us"])

    monkeypatch.setattr(httpx, "get", fake_get)

    monkeypatch.setenv("DAYTONA_TARGET", "eu")
    assert runner._resolve_snapshot_id() == "eu-id"
    monkeypatch.setenv("DAYTONA_TARGET", "us")
    assert runner._resolve_snapshot_id() == "us-id"
    # Two distinct cache keys → two HTTP calls.
    assert len(seen_targets) == 2


def test_resolve_snapshot_id_skips_inactive_snapshots(runner, monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return _make_response(
            [
                {
                    "id": "id-1",
                    "name": "snap",
                    "state": "building",
                    "regionIds": ["eu"],
                },
                {"id": "id-2", "name": "snap", "state": "active", "regionIds": ["eu"]},
            ]
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    assert runner._resolve_snapshot_id() == "id-2"


def test_resolve_snapshot_id_raises_when_no_match(runner, monkeypatch):
    def fake_get(url, params=None, headers=None, timeout=None):
        return _make_response(
            [{"id": "id-1", "name": "other", "state": "active", "regionIds": ["eu"]}]
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(RuntimeError, match="No active Daytona snapshot named 'snap'"):
        runner._resolve_snapshot_id()


def test_resolve_snapshot_id_raises_when_snapshot_unset(runner, monkeypatch):
    monkeypatch.delenv("DAYTONA_SNAPSHOT", raising=False)

    with pytest.raises(RuntimeError, match="No Daytona snapshot configured"):
        runner._resolve_snapshot_id()


def test_resolve_snapshot_id_force_refresh_bypasses_cache(runner, monkeypatch):
    ids = iter(["stale-id", "fresh-id"])

    def fake_get(url, params=None, headers=None, timeout=None):
        return _make_response(
            [
                {
                    "id": next(ids),
                    "name": "snap",
                    "state": "active",
                    "regionIds": ["eu"],
                }
            ]
        )

    monkeypatch.setattr(httpx, "get", fake_get)

    # First resolution caches the (now stale) ID.
    assert runner._resolve_snapshot_id() == "stale-id"
    # A cache hit would return the stale ID; force_refresh re-lists and overwrites.
    assert runner._resolve_snapshot_id(force_refresh=True) == "fresh-id"
    # The refreshed ID is now what's cached.
    assert runner._resolve_snapshot_id() == "fresh-id"
