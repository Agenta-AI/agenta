"""Where the integration layer looks for its database, whose database it accepts, and what it
does when it finds neither.

D97 was the first two halves. The loopback fallback kept the IN-NETWORK port when rewriting the
host, so a host-side run dialled `127.0.0.1:5432` — on a box running several stacks, whichever
one happened to bind that port, and against the stack this release was QA'd on, nothing at all.
And the layer SKIPPED what it could not reach, so 93 of 101 cases skipped and the process exited
0, which a release gate reads as green.

D128 is the third. A published port that opens a connection proves a server is listening and
nothing more, and every EE stack on a box names its database `agenta_ee_core`, so a stale port
reached a real database with the expected name and the wrong owner and the seeding fixtures went
in. The cases below pin the identity check that closes it: the deployment is the one whose API
wrote the marker row, and any other answering database is a failure naming both sides.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from oss.tests.pytest.utils import postgres as helper

_IN_NETWORK = "postgresql+asyncpg://username:password@postgres:5432/agenta_ee_core"
_LOOPBACK = "postgresql+asyncpg://username:password@127.0.0.1:5452/agenta_ee_core"
_MARKER = UUID("01a0ad38-a128-7bd3-ba7e-eda5735f114e")
_API = "https://api.under.test/api"


# Bound at import, before any case replaces the module attributes: the cached objects are
# what hold the answers, so they are what has to be cleared even while a stub stands in front
# of one of them.
_CACHED = (
    helper.resolve_core_uri,
    helper.deployment_marker,
    helper.confirm_deployment_under_test,
)


@pytest.fixture(autouse=True)
def _forget_the_cached_answers():
    """These answers are cached for the session; every case here changes their inputs."""
    for cached in _CACHED:
        cached.cache_clear()
    yield
    for cached in _CACHED:
        cached.cache_clear()


@pytest.fixture
def marker_row(monkeypatch):
    """The marker as if the API under test had minted it, without a deployment to mint it."""
    monkeypatch.setattr(helper, "deployment_marker", lambda: (_API, _MARKER))


def _answers_with(carried: set[UUID]):
    async def _carries_user(dsn, identifier):  # noqa: ANN001 — stub for the real probe
        return identifier in carried

    return _carries_user


def test_the_loopback_address_uses_the_published_port(monkeypatch):
    monkeypatch.setenv("POSTGRES_PORT", "5452")

    assert (
        helper._on_loopback(_IN_NETWORK)
        == "postgresql+asyncpg://username:password@127.0.0.1:5452/agenta_ee_core"
    )


def test_a_stack_that_published_no_port_keeps_the_container_port(monkeypatch):
    """Every stack allocated before the per-worktree ports publishes on 5432, and this is
    the only case in which dialling it is the right answer."""
    monkeypatch.delenv("POSTGRES_PORT", raising=False)

    assert helper._on_loopback(_IN_NETWORK).endswith("@127.0.0.1:5432/agenta_ee_core")


def test_a_malformed_published_port_is_the_operators_to_see(monkeypatch):
    monkeypatch.setenv("POSTGRES_PORT", "not-a-port")

    with pytest.raises(AssertionError, match="POSTGRES_PORT"):
        helper.published_port()


def test_an_unreachable_database_fails_the_run(monkeypatch):
    """The whole point. A skip here reported a green run in which nothing executed."""
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)
    monkeypatch.setenv("POSTGRES_PORT", "5452")

    with pytest.raises(AssertionError) as refusal:
        helper.require_core_uri()

    message = str(refusal.value)
    # The sentence has to name what to change, because the reader of it is someone who
    # pointed a suite at the wrong stack.
    assert "POSTGRES_URI_CORE" in message
    assert "POSTGRES_PORT" in message
    # Both addresses it tried, so the reader can see which stack it went looking for.
    assert "postgres:5432" in message
    assert "127.0.0.1:5452" in message
    # And not the credentials, because this lands in a test log.
    assert "password" not in message


def test_a_reachable_database_is_returned_and_installed(monkeypatch, marker_row):
    monkeypatch.setattr(helper, "_connectable", lambda uri: "127.0.0.1" in uri)
    monkeypatch.setattr(helper, "_carries_user", _answers_with({_MARKER}))
    monkeypatch.setenv("POSTGRES_PORT", "5452")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _IN_NETWORK)

    resolved = helper.require_core_uri()

    assert resolved.endswith("@127.0.0.1:5452/agenta_ee_core")
    # Installed on the shared `env`, so an engine built later dials the same server.
    assert helper.env.postgres.uri_core == resolved


def test_another_deployments_database_fails_before_anything_is_seeded(
    monkeypatch, marker_row
):
    """D128. It answers, it is called `agenta_ee_core`, and it is not this deployment's."""
    monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
    monkeypatch.setattr(helper, "_carries_user", _answers_with(set()))
    monkeypatch.setenv("POSTGRES_PORT", "5447")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)

    with pytest.raises(AssertionError) as refusal:
        helper.require_core_uri()

    message = str(refusal.value)
    # Both sides, because the reader has to see which two things disagree.
    assert _API in message
    assert str(_MARKER) in message
    assert "127.0.0.1:5452" in message
    # And what to change, and never the credentials.
    assert "POSTGRES_PORT" in message
    assert "5447" in message
    assert "password" not in message


def test_a_database_the_marker_cannot_be_read_from_is_refused(monkeypatch, marker_row):
    """A database with no `users` table is somebody else's too, not an inconclusive answer."""

    async def _explodes(dsn, identifier):  # noqa: ANN001 — stub for the real probe
        raise RuntimeError('relation "users" does not exist')

    monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
    monkeypatch.setattr(helper, "_carries_user", _explodes)
    monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)

    with pytest.raises(AssertionError, match="RuntimeError"):
        helper.require_core_uri()


def test_a_suite_that_cannot_name_the_api_under_test_fails(monkeypatch):
    """Identity needs a deployment to ask. Not knowing which one is a failure, not a skip."""
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "any-key")

    with pytest.raises(AssertionError) as refusal:
        helper.api_under_test()

    message = str(refusal.value)
    assert "AGENTA_API_URL" in message
    assert "AGENTA_AUTH_KEY" in message
    assert "any-key" not in message


def test_the_marker_is_minted_by_the_api_under_test(monkeypatch):
    """The row has to be written through the API, never into a database this module dialled."""
    sent = {}

    class _Answer:
        status_code = 200

        @staticmethod
        def json():
            return {"accounts": {"user": {"user": {"id": str(_MARKER)}}}}

    def _post(url, **kwargs):
        sent["url"] = url
        sent["headers"] = kwargs["headers"]
        return _Answer()

    monkeypatch.setenv("AGENTA_API_URL", _API + "/")
    monkeypatch.setenv("AGENTA_AUTH_KEY", "the-key")
    monkeypatch.setattr(helper.httpx, "post", _post)

    api_url, identifier = helper.deployment_marker()

    assert api_url == _API
    assert identifier == _MARKER
    assert sent["url"] == f"{_API}/admin/simple/accounts/"
    assert sent["headers"]["Authorization"] == "Access the-key"
