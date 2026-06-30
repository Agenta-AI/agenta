"""Golden-fixture contract test: Redis coordination plane (Python side).

Asserts that the Python implementation (api/oss/src/dbs/redis/sessions/contract.py)
agrees with the golden fixture (services/runner/tests/fixtures/sessions/redis_contract.json)
on every key name, TTL, displacement payload shape, Lua script, and cap constant.

The TypeScript implementation has a parallel vitest (services/runner/tests/unit/
session-redis-contract.test.ts) that asserts the same fixture. A drift between the
two implementations causes one test suite to fail; you cannot silently break the contract.

Run: cd api && py-run-tests
"""

import json
from pathlib import Path

import pytest

from oss.src.dbs.redis.sessions.contract import (
    ALIVE_TTL_SECONDS,
    ATTACHED_TTL_SECONDS,
    CONCURRENCY_CAP,
    DISPLACEMENT_REASON_STOLEN,
    HEARTBEAT_INTERVAL_SECONDS,
    HEARTBEAT_WRITE_THRESHOLD_SECONDS,
    OWNER_TTL_SECONDS,
    RELEASE_IF_OWNER_LUA,
    RUNNING_TTL_SECONDS,
    SESSION_ID_MAX_LEN,
    alive_key,
    attached_key,
    displaced_channel,
    make_displacement_payload,
    owner_key,
    running_key,
    validate_session_id,
)

_FIXTURE_PATH = (
    Path(__file__).parent.parent.parent.parent.parent.parent.parent
    / "services"
    / "runner"
    / "tests"
    / "fixtures"
    / "sessions"
    / "redis_contract.json"
)

_SESSION_EXAMPLE = "sess-123"
_WATCHER_EXAMPLE = "watcher-abc"


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(_FIXTURE_PATH.read_text())


# ---------------------------------------------------------------------------
# TTLs
# ---------------------------------------------------------------------------


def test_alive_ttl(fixture):
    assert ALIVE_TTL_SECONDS == fixture["ttls"]["alive"]


def test_running_ttl(fixture):
    assert RUNNING_TTL_SECONDS == fixture["ttls"]["running"]


def test_attached_ttl(fixture):
    assert ATTACHED_TTL_SECONDS == fixture["ttls"]["attached"]


def test_owner_ttl(fixture):
    assert OWNER_TTL_SECONDS == fixture["ttls"]["owner"]


def test_heartbeat_interval(fixture):
    assert HEARTBEAT_INTERVAL_SECONDS == fixture["ttls"]["heartbeat_interval"]


def test_heartbeat_write_threshold(fixture):
    assert (
        HEARTBEAT_WRITE_THRESHOLD_SECONDS
        == fixture["ttls"]["heartbeat_write_threshold"]
    )


# ---------------------------------------------------------------------------
# Key builders
# ---------------------------------------------------------------------------


def test_alive_key(fixture):
    assert alive_key(_SESSION_EXAMPLE) == fixture["keys"]["alive_example"]


def test_running_key(fixture):
    assert running_key(_SESSION_EXAMPLE) == fixture["keys"]["running_example"]


def test_attached_key(fixture):
    assert attached_key(_SESSION_EXAMPLE) == fixture["keys"]["attached_example"]


def test_owner_key(fixture):
    assert owner_key(_SESSION_EXAMPLE) == fixture["keys"]["owner_example"]


def test_displaced_channel(fixture):
    assert (
        displaced_channel(_SESSION_EXAMPLE)
        == fixture["keys"]["displaced_channel_example"]
    )


# ---------------------------------------------------------------------------
# Displacement payload
# ---------------------------------------------------------------------------


def test_displacement_reason_constant(fixture):
    assert DISPLACEMENT_REASON_STOLEN == fixture["displacement_payload"]["reason"]


def test_make_displacement_payload(fixture):
    payload = make_displacement_payload(by=_WATCHER_EXAMPLE)
    assert payload["reason"] == fixture["displacement_payload"]["reason"]
    assert payload["by"] == _WATCHER_EXAMPLE


# ---------------------------------------------------------------------------
# Lua script
# ---------------------------------------------------------------------------


def test_release_if_owner_lua(fixture):
    assert RELEASE_IF_OWNER_LUA == fixture["release_if_owner_lua"]


# ---------------------------------------------------------------------------
# Caps and validation
# ---------------------------------------------------------------------------


def test_concurrency_cap(fixture):
    assert CONCURRENCY_CAP == fixture["concurrency_cap"]


def test_session_id_max_len(fixture):
    assert SESSION_ID_MAX_LEN == fixture["session_id_max_len"]


@pytest.mark.parametrize(
    "session_id,expected",
    [
        ("sess-123", True),
        ("abc_DEF-123", True),
        ("a", True),
        ("", False),
        ("a" * 129, False),
        ("path/injection", False),
        ("has space", False),
        ("has@symbol", False),
    ],
)
def test_validate_session_id(session_id, expected):
    assert validate_session_id(session_id) == expected
