"""OpenAI Agents SDK runtime — vanilla (no Agenta integration).

Public surface:

- ``agent`` — the configured ``agents.Agent`` instance, ready to drive with
  ``Runner.run`` / ``Runner.run_streamed`` against an ``AgentDeps`` context.
- ``ALL_TOOLS`` — re-exported for tests that build their own Agent.
"""

from .adapters import ALL_TOOLS
from .agent import agent

__all__ = ["agent", "ALL_TOOLS"]
