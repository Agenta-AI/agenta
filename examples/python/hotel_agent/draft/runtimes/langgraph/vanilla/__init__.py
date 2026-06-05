"""LangChain runtime — vanilla (no Agenta integration).

Public surface:

- ``agent`` — the compiled ``create_agent`` graph, ready to ``astream`` against
  an ``AgentDeps`` passed as ``context=``.
- ``build_input_messages`` — assembles the per-turn message list (system prompt
  + grounding + history + user message).
- ``ALL_TOOLS`` / ``SYSTEM_PROMPT`` — re-exported for tests and tooling.
"""

from .adapters import ALL_TOOLS
from .agent import SYSTEM_PROMPT, agent, build_grounding, build_input_messages

__all__ = [
    "agent",
    "build_input_messages",
    "build_grounding",
    "SYSTEM_PROMPT",
    "ALL_TOOLS",
]
