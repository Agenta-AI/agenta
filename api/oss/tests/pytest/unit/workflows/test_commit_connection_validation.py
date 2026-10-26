"""A commit must not store an agent connection the runtime cannot use (M5).

An organization connection is named by scope `organization`, its slug and namespace
`organization`; an older runtime refuses that namespace instead of reading the slug as a
project connection. Where the runners hold no operator login (the cloud), a `self_managed`
connection must name a subscription connection. An agent with no connection keeps the
project default.
"""

import pytest

from oss.src.core.workflows.service import _reject_unrunnable_agent_connection
from oss.src.core.workflows.types import InvalidAgentConnectionError
from oss.src.utils.env import env


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
    ],
)
def test_runnable_connections_commit(connection, monkeypatch):
    monkeypatch.setattr(env.runner, "require_named_self_managed_connection", True)
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


def test_self_managed_without_a_slug_is_refused_only_where_runners_hold_no_login(
    monkeypatch,
):
    data = _data({"mode": "self_managed"})
    monkeypatch.setattr(env.runner, "require_named_self_managed_connection", False)
    _reject_unrunnable_agent_connection(data)  # self-hosting keeps the operator login
    monkeypatch.setattr(env.runner, "require_named_self_managed_connection", True)
    with pytest.raises(InvalidAgentConnectionError) as excinfo:
        _reject_unrunnable_agent_connection(data)
    detail = excinfo.value.to_detail()
    assert detail["code"] == "invalid_agent_connection"
    assert detail["details"]["reason"] == "self_managed_without_slug"
