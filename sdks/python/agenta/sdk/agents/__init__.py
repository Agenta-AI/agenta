"""Agenta agent runtime: run a coding harness (Pi, Claude, ...) as a swappable port.

Layers (Agenta's hexagonal vocabulary):

- ``dtos.py`` — data contracts (``AgentConfig``, ``SessionConfig``, ``Message``, ...).
- ``interfaces.py`` — the ports (ABCs): ``Backend``, ``Environment``, ``Sandbox``,
  ``Session``, ``Harness``.
- ``adapters/`` — implementations: ``RivetBackend`` / ``InProcessPiBackend`` / ``LocalBackend``
  and ``PiHarness`` / ``ClaudeHarness``.
- ``utils/`` — shared plumbing (the ``/run`` wire and the transports to the TS runner).

Standalone usage::

    import agenta as ag
    from agenta.sdk.agents import Message

    cfg = ag.ConfigManager.get_from_registry(app_slug="my-agent")
    agent = ag.AgentConfig.from_params(cfg)
    harness = ag.PiHarness(ag.Environment(ag.RivetBackend()))
    result = await harness.prompt(ag.SessionConfig(agent=agent), [Message(role="user", content="hi")])
"""

from .adapters import (
    AgentaHarness,
    ClaudeHarness,
    InProcessPiBackend,
    LocalBackend,
    PiHarness,
    RivetBackend,
    make_harness,
)
from .dtos import (
    AgentaAgentConfig,
    AgentConfig,
    AgentEvent,
    AgentResult,
    ClaudeAgentConfig,
    ContentBlock,
    HarnessAgentConfig,
    HarnessCapabilities,
    HarnessType,
    Message,
    PermissionPolicy,
    PiAgentConfig,
    RunSelection,
    SessionConfig,
    ToolCallback,
    TraceContext,
    to_messages,
)
from .errors import UnsupportedHarnessError
from .interfaces import Backend, Environment, Harness, Sandbox, Session
from .streaming import AgentRun

__all__ = [
    # DTOs
    "AgentConfig",
    "RunSelection",
    "SessionConfig",
    "HarnessAgentConfig",
    "PiAgentConfig",
    "ClaudeAgentConfig",
    "AgentaAgentConfig",
    "HarnessType",
    "HarnessCapabilities",
    "ContentBlock",
    "Message",
    "to_messages",
    "AgentEvent",
    "AgentResult",
    "AgentRun",
    "TraceContext",
    "ToolCallback",
    "PermissionPolicy",
    # Interfaces (ports)
    "Backend",
    "Sandbox",
    "Session",
    "Environment",
    "Harness",
    # Errors
    "UnsupportedHarnessError",
    # Adapters
    "RivetBackend",
    "InProcessPiBackend",
    "LocalBackend",
    "PiHarness",
    "ClaudeHarness",
    "AgentaHarness",
    "make_harness",
]
