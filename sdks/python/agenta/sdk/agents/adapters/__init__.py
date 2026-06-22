"""Adapters: concrete implementations of the agent runtime ports.

- Backend adapters: ``SandboxAgentBackend`` (sandbox-agent over ACP), ``InProcessPiBackend`` (in-process Pi,
  the reference backend), ``LocalBackend`` (standalone SDK runs; not yet implemented).
- Harness adapters: ``PiHarness``, ``ClaudeHarness``, ``AgentaHarness`` (+ ``make_harness``).
- HTTP/browser protocol adapters live in subpackages, e.g. ``adapters.vercel``.

Shared plumbing for the runner-backed adapters lives in ``agents/utils``.
"""

from .harnesses import AgentaHarness, ClaudeHarness, PiHarness, make_harness
from .in_process import InProcessPiBackend
from .local import LocalBackend
from .sandbox_agent import SandboxAgentBackend

__all__ = [
    "SandboxAgentBackend",
    "InProcessPiBackend",
    "LocalBackend",
    "PiHarness",
    "ClaudeHarness",
    "AgentaHarness",
    "make_harness",
]
