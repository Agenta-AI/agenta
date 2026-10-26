"""A commit must not store an agent connection the runtime cannot use (M5).

An organization connection is named by scope `organization`, its slug and namespace
`organization`; an older runtime refuses that namespace instead of reading the slug as a
project connection. An agent with no connection keeps the project default. A `self_managed`
connection commits with or without a slug, as on v0.125.0: the runner decides at run time.
"""

import pytest

from oss.src.core.workflows.service import _reject_unrunnable_agent_connection
from oss.src.core.workflows.types import InvalidAgentConnectionError


def _data(connection):
    llm = {"model": "gpt-5.5"}
    if connection is not None:
        llm["connection"] = connection
    return {"parameters": {"agent": {"llm": llm}}}


@pytest.mark.parametrize(
    "connection",
    [
        None,
        {"mode": "agenta"},
        {"mode": "agenta", "scope": "project"},
        {"mode": "agenta", "slug": "openai-sales", "scope": "project"},
        {
            "mode": "agenta",
            "slug": "openai-company",
            "scope": "organization",
            "namespace": "organization",
        },
        {"mode": "self_managed", "slug": "claude"},
        {"mode": "self_managed"},
    ],
)
def test_runnable_connections_commit(connection):
    _reject_unrunnable_agent_connection(_data(connection))


@pytest.mark.parametrize(
    "connection",
    [
        {"mode": "agenta", "scope": "organization", "namespace": "organization"},
        {"mode": "agenta", "slug": "openai-company", "scope": "organization"},
        {"mode": "agenta", "slug": "openai-company", "namespace": "organization"},
    ],
    ids=["no-slug", "no-namespace", "no-scope"],
)
def test_an_incomplete_organization_connection_is_refused(connection):
    with pytest.raises(InvalidAgentConnectionError) as excinfo:
        _reject_unrunnable_agent_connection(_data(connection))
    assert excinfo.value.to_detail()["details"]["reason"] == (
        "organization_connection_incomplete"
    )


@pytest.mark.parametrize(
    "connection",
    [{"mode": "self_managed"}, {"mode": "self_managed", "slug": "claude"}],
    ids=["no-slug", "slug"],
)
@pytest.mark.parametrize(
    "deployment_env",
    [{}, {"AGENTA_RUNNER_REQUIRE_NAMED_SELF_MANAGED_CONNECTION": "true"}],
    ids=["no-env", "old-cloud-env"],
)
def test_self_managed_saves_as_on_v0125_with_any_env(
    connection, deployment_env, monkeypatch
):
    """A save never checks whether the runner holds a login (owner decision, 2026-10-26).
    The variable an earlier M5 draft read is gone; setting it changes nothing."""
    from oss.src.utils.env import env

    for name, value in deployment_env.items():
        monkeypatch.setenv(name, value)
    assert not hasattr(env.runner, "require_named_self_managed_connection")
    _reject_unrunnable_agent_connection(_data(connection))
