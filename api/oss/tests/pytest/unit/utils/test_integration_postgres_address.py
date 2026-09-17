"""Where the integration layer looks for its database, and what it does when it is not there.

Both halves were D97. The loopback fallback kept the IN-NETWORK port when rewriting the host,
so a host-side run dialled `127.0.0.1:5432` — on a box running several stacks, whichever one
happened to bind that port, and against the stack this release was QA'd on, nothing at all.
And the layer SKIPPED what it could not reach, so 93 of 101 cases skipped and the process
exited 0, which a release gate reads as green.
"""

from __future__ import annotations

import pytest

from oss.tests.pytest.utils import postgres as helper

_IN_NETWORK = "postgresql+asyncpg://username:password@postgres:5432/agenta_ee_core"


@pytest.fixture(autouse=True)
def _forget_the_cached_answer():
    """`resolve_core_uri` is cached for the session; these cases change its inputs."""
    helper.resolve_core_uri.cache_clear()
    yield
    helper.resolve_core_uri.cache_clear()


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


def test_a_reachable_database_is_returned_and_installed(monkeypatch):
    monkeypatch.setattr(helper, "_connectable", lambda uri: "127.0.0.1" in uri)
    monkeypatch.setenv("POSTGRES_PORT", "5452")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _IN_NETWORK)

    resolved = helper.require_core_uri()

    assert resolved.endswith("@127.0.0.1:5452/agenta_ee_core")
    # Installed on the shared `env`, so an engine built later dials the same server.
    assert helper.env.postgres.uri_core == resolved
