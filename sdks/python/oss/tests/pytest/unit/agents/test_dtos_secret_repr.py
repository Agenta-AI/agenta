"""PY-C5: secret-bearing fields must not render in repr, unlike every other secret field here."""

from __future__ import annotations

from agenta.sdk.agents.dtos import AgentTemplate, SessionConfig, TraceContext
from agenta.sdk.agents.wire_models import WireToolCallback


def test_session_config_secrets_masked_in_repr() -> None:
    config = SessionConfig(
        agent=AgentTemplate(), secrets={"OPENAI_API_KEY": "sk-supersecret"}
    )
    assert "sk-supersecret" not in repr(config)


def test_trace_context_authorization_masked_in_repr() -> None:
    trace = TraceContext(authorization="Bearer supersecrettoken")
    assert "supersecrettoken" not in repr(trace)


def test_wire_tool_callback_authorization_masked_in_repr() -> None:
    callback = WireToolCallback(
        endpoint="https://example.test/tools/call",
        authorization="Bearer supersecrettoken",
    )
    assert "supersecrettoken" not in repr(callback)
