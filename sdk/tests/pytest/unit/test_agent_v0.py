"""
Unit tests for the agent_v0 handler (agenta:builtin:agent:v0).

agent_v0 exists as a canonical builtin URI and service surface, but the runtime
implementation is intentionally not implemented yet.
"""

import asyncio

import pytest

from agenta.sdk.workflows.errors import AgentV0Error
from agenta.sdk.workflows.handlers import agent_v0

_agent_v0 = agent_v0.__wrapped__


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class TestAgentV0Stub:
    def test_no_args_raises_agent_error(self):
        with pytest.raises(AgentV0Error):
            run(_agent_v0())

    def test_error_message_mentions_uri(self):
        with pytest.raises(AgentV0Error) as exc_info:
            run(_agent_v0())
        assert "agenta:builtin:agent:v0" in exc_info.value.message
