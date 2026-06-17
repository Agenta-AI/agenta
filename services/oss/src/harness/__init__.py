"""Engine-agnostic agent runtime: the harness and environment seams, plus their adapters.

Nothing here is Agenta-specific. The Agenta workflow integration (the ``/invoke`` handler,
tool resolution, secrets, tracing) lives in ``oss.src.agent``. Two seams (see
``docs/design/agent-workflows/harness-port-redesign/``):

- ``Harness``: the agent engine. ``SubprocessHarness`` and ``HttpHarness`` (``transports.py``)
  reach the TypeScript runner over a subprocess or HTTP. The engine that runs behind them
  (rivet over ACP, or the legacy in-process Pi path) is an env value, not a class.
  ``create_session`` returns an :class:`AgentSession` (create / prompt / destroy).
- ``Environment``: where the harness process runs. ``LocalEnvironment`` runs it as a local
  subprocess; a sandbox environment is selected inside the rivet runner.
"""

from .environment import LocalEnvironment
from .ports import (
    AgentEvent,
    AgentRequest,
    AgentResult,
    AgentSession,
    ContentBlock,
    Environment,
    Harness,
    HarnessCapabilities,
    Message,
    SessionConfig,
    ToolCallback,
    TraceContext,
)
from .transports import HttpHarness, SubprocessHarness

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
