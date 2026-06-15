"""Ports for the agent service: the Harness seam and the Runtime (environment) seam.

These interfaces keep the service harness-agnostic and environment-agnostic. The MVP
ships one adapter for each (Pi over a local subprocess), but the boundaries are where
Codex/Claude Code (other harnesses) and Daytona (other environments) slot in later.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence


@dataclass
class ExecResult:
    """Result of running a command through a Runtime."""

    code: int
    stdout: str
    stderr: str


class Runtime(ABC):
    """Port for the run environment: where and how the harness process runs.

    The local adapter runs it as a subprocess on this host. A sandbox adapter (WP-3)
    runs it inside Daytona. ``pause`` and ``connect_volume`` are lifecycle hooks the
    design doc calls out; the local adapter no-ops them.
    """

    @abstractmethod
    async def start(self) -> None:
        """Bring the environment up (no-op for a local process)."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Tear the environment down (no-op for a local process)."""

    async def pause(self) -> None:
        """Pause the environment. Optional; no-op by default."""
        return None

    async def connect_volume(self, *args: Any, **kwargs: Any) -> None:
        """Attach a volume to the environment. Optional; no-op by default."""
        return None

    @abstractmethod
    async def exec(
        self,
        command: Sequence[str],
        input_bytes: bytes,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> ExecResult:
        """Run ``command`` in the environment, feeding ``input_bytes`` to stdin."""


@dataclass
class TraceContext:
    """Agenta trace context threaded into the harness run.

    Lets the harness nest its spans under the caller's workflow span (same
    ``trace_id``) and ship them to the same Agenta backend with the same auth, so
    the agent's whole run becomes part of the ``/invoke`` trace the way
    completion/chat nest their LLM spans. All fields optional; with none set the
    harness traces standalone (or not at all).
    """

    traceparent: Optional[str] = None
    baggage: Optional[str] = None
    endpoint: Optional[str] = None  # OTLP traces URL
    authorization: Optional[str] = None  # full Authorization header value
    capture_content: bool = True

    def to_wire(self) -> Dict[str, Any]:
        """Serialize to the camelCase shape the TS wrapper expects on the wire."""
        return {
            "traceparent": self.traceparent,
            "baggage": self.baggage,
            "endpoint": self.endpoint,
            "authorization": self.authorization,
            "captureContent": self.capture_content,
        }


@dataclass
class HarnessRequest:
    """One agent run: instructions, model, the user turn, and optional history."""

    agents_md: Optional[str] = None
    model: Optional[str] = None
    prompt: Optional[str] = None
    messages: List[Any] = field(default_factory=list)
    tools: List[str] = field(default_factory=list)
    trace: Optional[TraceContext] = None


@dataclass
class HarnessResult:
    """The agent's reply plus run metadata."""

    output: str
    session_id: Optional[str] = None
    model: Optional[str] = None


class Harness(ABC):
    """Port between our service and the agent engine. Pi is one implementation."""

    @abstractmethod
    async def setup(self) -> None:
        """Prepare the harness for a run."""

    @abstractmethod
    async def invoke(self, request: HarnessRequest) -> HarnessResult:
        """Run one turn and return the agent's reply."""

    @abstractmethod
    async def shutdown(self) -> None:
        """Release any harness resources."""
