"""Adapters: concrete implementations of the agent runtime ports.

- Backend adapters: ``RivetBackend`` (rivet over ACP), ``InProcessPiBackend`` (in-process Pi,
  the reference backend), ``LocalBackend`` (standalone SDK runs; not yet implemented).
- Harness adapters: ``PiHarness``, ``ClaudeHarness``, ``AgentaHarness`` (+ ``make_harness``).

Shared plumbing for the runner-backed adapters lives in ``agents/utils``.
"""

from .harnesses import AgentaHarness, ClaudeHarness, PiHarness, make_harness
from .in_process import InProcessPiBackend
from .local import LocalBackend
from .rivet import RivetBackend

__all__ = [
    "RivetBackend",
    "InProcessPiBackend",
    "LocalBackend",
    "PiHarness",
    "ClaudeHarness",
    "AgentaHarness",
    "make_harness",
]
