"""Agent runtime: ports and adapters for the agent service.

The Python service is "our agent implementation". It owns two seams (see
``docs/design/agent-workflows/harness-port-redesign/``):

- ``Harness``: the agent engine. ``SubprocessHarness`` and ``HttpHarness`` (in
  ``harness.py``) are the two transports to the TypeScript runner; the engine (legacy
  in-process Pi vs rivet over ACP) is an env value, not a class. ``create_session``
  returns an :class:`AgentSession`, the rivet-shaped session abstraction.
- ``Environment``: where the harness process runs. ``LocalEnvironment`` runs it as a local
  subprocess; a sandbox environment is selected inside the rivet runner.
"""

from .environment import LocalEnvironment
from .harness import HttpHarness, SubprocessHarness
from .ports import (
    AgentEvent,
    AgentRequest,
    AgentResult,
    AgentSession,
    ContentBlock,
    Environment,
    HarnessCapabilities,
    Harness,
    Message,
    SessionConfig,
    ToolCallback,
    TraceContext,
)

__all__ = [
    "AgentEvent",
    "AgentRequest",
    "AgentResult",
    "AgentSession",
    "ContentBlock",
    "Environment",
    "Harness",
    "HarnessCapabilities",
    "HttpHarness",
    "LocalEnvironment",
    "Message",
    "SessionConfig",
    "SubprocessHarness",
    "ToolCallback",
    "TraceContext",
]
