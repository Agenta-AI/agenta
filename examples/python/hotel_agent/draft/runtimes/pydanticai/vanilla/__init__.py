"""Pydantic-AI runtime — vanilla (no Agenta integration).

Public surface:

- ``agent`` — the configured ``pydantic_ai.Agent`` instance, ready to ``run`` /
  ``run_stream_events`` against an ``AgentDeps``.
- ``register_tools`` — re-exported for tests that build their own Agent.
"""

from .agent import agent

__all__ = ["agent"]
