"""Unit tests for Tracing.store_agent (mirrors store_session/store_user).

Verifies the attribute is set on the span with the `agent` namespace and that a
falsy agent_id is a no-op.
"""

from unittest.mock import MagicMock

import pytest

from agenta.sdk.engines.tracing.tracing import Tracing


@pytest.fixture
def tracing():
    return Tracing(url="http://localhost:4318/v1/traces")


def test_store_agent_sets_id_attribute_on_given_span(tracing):
    span = MagicMock()

    tracing.store_agent(agent_id="agent-123", span=span)

    span.set_attribute.assert_called_once_with("id", "agent-123", namespace="agent")


def test_store_agent_is_noop_when_agent_id_falsy(tracing):
    span = MagicMock()

    tracing.store_agent(agent_id=None, span=span)
    tracing.store_agent(agent_id="", span=span)

    span.set_attribute.assert_not_called()
