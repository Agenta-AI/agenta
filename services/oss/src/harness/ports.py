"""Ports for the agent service: the Environment seam and the Harness seam.

These interfaces keep the service environment-agnostic and engine-agnostic. The shapes
are borrowed from the rivet ``sandbox-agent`` SDK (see
``docs/design/agent-workflows/harness-port-redesign/``) but stay ours, so rivet is one
adapter behind the seam and a non-rivet engine (the legacy in-process Pi path) fits the
same port.

Two seams:

- ``Environment`` — where the harness process runs. ``LocalEnvironment`` runs it as a
  subprocess on this host; a sandbox environment runs it elsewhere. This is the "runtime"
  axis renamed; ``exec`` survives only as the subprocess transport's mechanism.
- ``Harness`` — the agent engine. One ``invoke`` is one cold run. ``create_session``
  returns an :class:`AgentSession`, the rivet-shaped abstraction on top: under cold +
  replay it holds no warm daemon, so continuing a conversation replays the caller-held
  history into a fresh run.

The engine choice (legacy in-process Pi vs rivet over ACP) is not a Python class. It is an
env value the transport hands the TypeScript runner, so Python has two transports
(subprocess, HTTP), not three backend adapters.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Union


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------


@dataclass
class HarnessCapabilities:
    """What a harness can do, probed by the runtime (rivet ``AgentCapabilities``).

    The runner reports these in the result; the service uses them for observability and
    for input shaping (for example, do not send image blocks to a harness without
    ``images``). The branching that used to key off the harness name (``if pi``) now keys
    off these flags in the TypeScript runner, where the live answer is.
    """

    text_messages: bool = True
    images: bool = False
    file_attachments: bool = False
    mcp_tools: bool = False
    tool_calls: bool = False
    reasoning: bool = False
    plan_mode: bool = False
    permissions: bool = False
    usage: bool = False
    streaming_deltas: bool = False
    session_lifecycle: bool = False

    @classmethod
    def from_wire(
        cls, data: Optional[Dict[str, Any]]
    ) -> Optional["HarnessCapabilities"]:
        """Parse the camelCase capability object the runner returns. ``None`` passes through."""
        if not isinstance(data, dict):
            return None
        return cls(
            text_messages=bool(data.get("textMessages", True)),
            images=bool(data.get("images", False)),
            file_attachments=bool(data.get("fileAttachments", False)),
            mcp_tools=bool(data.get("mcpTools", False)),
            tool_calls=bool(data.get("toolCalls", False)),
            reasoning=bool(data.get("reasoning", False)),
            plan_mode=bool(data.get("planMode", False)),
            permissions=bool(data.get("permissions", False)),
            usage=bool(data.get("usage", False)),
            streaming_deltas=bool(data.get("streamingDeltas", False)),
            session_lifecycle=bool(data.get("sessionLifecycle", False)),
        )


# ---------------------------------------------------------------------------
# Turn input: content blocks and messages
# ---------------------------------------------------------------------------


@dataclass
class ContentBlock:
    """One piece of a message, mirroring the ACP content-block kinds.

    ``text`` is the only kind the playground sends today; ``image`` and ``resource`` are
    plumbed so an image-capable harness can take them once the playground does. A bare
    string content is normalized to a single ``text`` block on the wire.
    """

    type: str  # "text" | "image" | "resource"
    text: Optional[str] = None
    # image / resource payloads (base64 data or a uri), used when type != "text".
    data: Optional[str] = None
    mime_type: Optional[str] = None
    uri: Optional[str] = None

    def to_wire(self) -> Dict[str, Any]:
        block: Dict[str, Any] = {"type": self.type}
        if self.text is not None:
            block["text"] = self.text
        if self.data is not None:
            block["data"] = self.data
        if self.mime_type is not None:
            block["mimeType"] = self.mime_type
        if self.uri is not None:
            block["uri"] = self.uri
        return block

    @classmethod
    def from_raw(cls, raw: Any) -> "ContentBlock":
        """Coerce a loose block (string or dict) into a ContentBlock."""
        if isinstance(raw, ContentBlock):
            return raw
        if isinstance(raw, str):
            return cls(type="text", text=raw)
        if isinstance(raw, dict):
            return cls(
                type=str(raw.get("type", "text")),
                text=raw.get("text"),
                data=raw.get("data"),
                mime_type=raw.get("mimeType") or raw.get("mime_type"),
                uri=raw.get("uri"),
            )
        return cls(type="text", text=str(raw))


# A message's content is either a plain string or a list of content blocks.
MessageContent = Union[str, List[ContentBlock]]


@dataclass
class Message:
    """A chat message in the conversation. ``content`` is text or content blocks."""

    role: str
    content: MessageContent = ""

    def to_wire(self) -> Dict[str, Any]:
        if isinstance(self.content, str):
            content: Any = self.content
        else:
            # Tolerate both ContentBlock objects and the raw dicts a caller may pass.
            content = [
                block.to_wire() if isinstance(block, ContentBlock) else block
                for block in self.content
            ]
        return {"role": self.role, "content": content}

    @classmethod
    def from_raw(cls, raw: Any) -> Optional["Message"]:
        """Coerce a loose dict (the playground's message shape) into a Message.

        List content (ACP-style content blocks) is normalized into ``ContentBlock``
        objects so the typed-content invariant holds downstream.
        """
        if isinstance(raw, Message):
            return raw
        if not isinstance(raw, dict) or "role" not in raw:
            return None
        content = raw.get("content", "")
        if isinstance(content, list):
            content = [ContentBlock.from_raw(block) for block in content]
        return cls(role=str(raw["role"]), content=content)


# ---------------------------------------------------------------------------
# Run events: the structured stream
# ---------------------------------------------------------------------------


@dataclass
class AgentEvent:
    """One structured event from a run, mapped from an ACP ``session/update``.

    ``type`` is one of ``message``, ``thought``, ``tool_call``, ``tool_result``,
    ``usage``, ``error``, ``done``. ``data`` carries the rest verbatim. The runner returns
    these as a per-turn log; an ``on_event`` callback can also receive them live.
    """

    type: str
    data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_wire(cls, raw: Any) -> Optional["AgentEvent"]:
        if not isinstance(raw, dict) or not raw.get("type"):
            return None
        return cls(type=str(raw["type"]), data=raw)


# A live event sink. Synchronous: the transports invoke it as events arrive.
EventSink = Callable[[AgentEvent], None]


# ---------------------------------------------------------------------------
# Trace context and tool callback (cross-boundary plumbing, unchanged shapes)
# ---------------------------------------------------------------------------


@dataclass
class TraceContext:
    """Agenta trace context threaded into the harness run.

    Lets the harness nest its spans under the caller's workflow span (same ``trace_id``)
    and ship them to the same Agenta backend with the same auth, so the agent's whole run
    becomes part of the ``/invoke`` trace the way completion/chat nest their LLM spans.
    All fields optional; with none set the harness traces standalone (or not at all).
    """

    traceparent: Optional[str] = None
    baggage: Optional[str] = None
    endpoint: Optional[str] = None  # OTLP traces URL
    authorization: Optional[str] = None  # full Authorization header value
    capture_content: bool = True

    def to_wire(self) -> Dict[str, Any]:
        return {
            "traceparent": self.traceparent,
            "baggage": self.baggage,
            "endpoint": self.endpoint,
            "authorization": self.authorization,
            "captureContent": self.capture_content,
        }


@dataclass
class ToolCallback:
    """How the harness routes a tool call back through Agenta's ``/tools/call``.

    The backend resolves runnable tool references into specs and hands the harness this
    callback. The provider key and connection auth never enter the sandbox; they stay
    behind ``/tools/call``. Same mechanism that threads the OTLP credential.
    """

    endpoint: str  # full ``/tools/call`` URL
    authorization: Optional[str] = None  # full Authorization header value

    def to_wire(self) -> Dict[str, Any]:
        return {"endpoint": self.endpoint, "authorization": self.authorization}


# ---------------------------------------------------------------------------
# Session config, request, result
# ---------------------------------------------------------------------------

# Permission policy for harness tool use in a headless run. ``auto`` approves (tools are
# backend-resolved and trusted, no human to prompt); ``deny`` rejects.
PermissionPolicy = str  # "auto" | "deny"


@dataclass
class SessionConfig:
    """The agent config bundle for a session: everything but the turn itself.

    Mirrors the rivet session config. ``instructions`` becomes ``AGENTS.md``;
    ``harness``/``sandbox`` are the two orthogonal swap axes; ``secrets`` are provider keys
    injected as harness env, never written to the agent filesystem. Skills and hooks are
    carried as workspace artifacts (not modeled as verbs); they are not built in this pass.
    """

    instructions: Optional[str] = None  # AGENTS.md text
    model: Optional[str] = None
    harness: str = "pi"
    sandbox: str = "local"
    session_id: Optional[str] = None
    secrets: Dict[str, str] = field(default_factory=dict)
    builtin_tools: List[str] = field(default_factory=list)
    custom_tools: List[Dict[str, Any]] = field(default_factory=list)
    tool_callback: Optional[ToolCallback] = None
    permission_policy: PermissionPolicy = "auto"
    trace: Optional[TraceContext] = None


@dataclass
class AgentRequest:
    """One transport call: the session config plus the conversation so far.

    The runner picks the latest user turn and replays the prior turns as context (the
    cold + replay model). ``messages`` is the full conversation the caller holds.
    """

    config: SessionConfig
    messages: List[Message] = field(default_factory=list)


@dataclass
class AgentResult:
    """The agent's reply plus structured run metadata.

    ``output`` is the final assistant text (the playground renders this). ``messages`` and
    ``events`` are the structured forms. ``usage`` rolls token/cost onto the workflow span
    (the harness span tree ships in a separate OTLP batch, so the service stamps the totals
    itself). ``capabilities`` is what the harness was probed to support this run.
    """

    output: str = ""
    messages: List[Message] = field(default_factory=list)
    events: List[AgentEvent] = field(default_factory=list)
    usage: Optional[Dict[str, Any]] = None
    stop_reason: Optional[str] = None
    capabilities: Optional[HarnessCapabilities] = None
    session_id: Optional[str] = None
    model: Optional[str] = None
    trace_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Environment seam (where the harness process runs)
# ---------------------------------------------------------------------------


@dataclass
class ExecResult:
    """Result of running a command through an Environment."""

    code: int
    stdout: str
    stderr: str


class Environment(ABC):
    """Where and how the harness process runs.

    ``LocalEnvironment`` runs it as a subprocess on this host. ``exec`` is the subprocess
    transport's mechanism; the HTTP transport does not use it. ``start``/``dispose`` are
    lifecycle hooks (no-ops for a local process).
    """

    async def start(self) -> None:
        """Bring the environment up (no-op for a local process)."""
        return None

    async def dispose(self) -> None:
        """Tear the environment down (no-op for a local process)."""
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


# ---------------------------------------------------------------------------
# Harness seam (the agent engine) and the session abstraction
# ---------------------------------------------------------------------------


class Harness(ABC):
    """The agent engine behind one transport. Rivet and the legacy Pi path are adapters."""

    async def setup(self) -> None:
        """Prepare the harness for a run (no-op by default)."""
        return None

    async def shutdown(self) -> None:
        """Release harness resources (no-op by default)."""
        return None

    @abstractmethod
    async def invoke(
        self,
        request: AgentRequest,
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        """Run one cold turn and return the structured result."""

    async def destroy_session(self, session_id: Optional[str]) -> None:
        """Drop a session's resources. A no-op under cold + replay (nothing is kept warm)."""
        return None

    def create_session(self, config: SessionConfig) -> "AgentSession":
        """Open a session for this config. The session is the rivet-shaped abstraction."""
        return AgentSession(self, config)


class AgentSession:
    """A first-class session over a :class:`Harness`.

    ``create_session(config)`` then ``session.prompt(messages)``. Under cold + replay the
    session keeps no warm daemon: each ``prompt`` is a fresh ``invoke`` that replays the
    supplied history. The abstraction is real (and where a future server-side history
    store slots in); the cold lifecycle is an adapter detail.
    """

    def __init__(self, harness: Harness, config: SessionConfig) -> None:
        self._harness = harness
        self._config = config

    @property
    def id(self) -> Optional[str]:
        return self._config.session_id

    async def prompt(
        self,
        messages: Sequence[Message],
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        request = AgentRequest(config=self._config, messages=list(messages))
        result = await self._harness.invoke(request, on_event=on_event)
        # Carry the engine's session id forward so a follow-up prompt resumes it.
        if result.session_id:
            self._config.session_id = result.session_id
        return result

    async def destroy(self) -> None:
        await self._harness.destroy_session(self._config.session_id)
