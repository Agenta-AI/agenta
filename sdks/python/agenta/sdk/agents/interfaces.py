"""The ports of the agent runtime: the abstract contracts (Agenta calls these interfaces).

Three layers, lowest to highest:

- ``Backend`` is the engine. It declares which harnesses it can drive
  (``supported_harnesses``), owns sandbox + session lifecycle, and is pure plumbing: it
  takes an already-harness-shaped config and launches it. Adapters: ``SandboxAgentBackend``,
  ``LocalBackend``.
- ``Sandbox`` is where a session's process tree lives, plus the provisioning verb
  (``add_files``).
- ``Session`` is one conversation (``prompt``, ``destroy``).
- ``Environment`` sits above a backend and owns the sandbox policy.

The ``Harness`` port (with its ``PiHarness`` / ``ClaudeHarness`` adapters) sits above an
``Environment`` and validates against ``Backend.supported_harnesses``.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from typing import ClassVar, FrozenSet, Mapping, Optional, Sequence

from .dtos import (
    AgentResult,
    EventSink,
    HarnessAgentTemplate,
    HarnessType,
    Message,
    RunContext,
    SessionConfig,
    TraceContext,
)
from .errors import UnsupportedHarnessError
from .streaming import AgentStream


# ---------------------------------------------------------------------------
# Sandbox and Session
# ---------------------------------------------------------------------------


class Sandbox(ABC):
    """Where a session's process tree runs. Holds the provisioning verb and teardown.

    ``add_files`` lays files into the sandbox before the session prompts (AGENTS.md, a
    bundled extension, an uploaded login). Provisioning, used by the runtime, never exposed
    to the agent-config author.
    """

    async def add_files(self, files: Mapping[str, bytes]) -> None:
        """Write files into the sandbox. No-op by default (an adapter may need nothing)."""
        return None

    async def destroy(self) -> None:
        """Tear the sandbox down. No-op by default."""
        return None


class Session(ABC):
    """One conversation over a harness running in a sandbox."""

    @property
    @abstractmethod
    def id(self) -> Optional[str]:
        """The engine's session id, carried forward so a follow-up turn can resume it."""

    @abstractmethod
    async def prompt(
        self,
        messages: Sequence[Message],
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        """Run one turn and return the structured result (the one-shot path)."""

    @abstractmethod
    def stream(self, messages: Sequence[Message]) -> AgentStream:
        """Run one turn, yielding events live across the boundary.

        Returns an :class:`~agenta.sdk.agents.streaming.AgentStream`: an async-iterable of
        ``Event`` that also carries the terminal ``AgentResult`` once consumed. This is
        the live counterpart of :meth:`prompt`.
        """

    async def destroy(self) -> None:
        """Drop the session's resources. A no-op under cold + replay."""
        return None


# ---------------------------------------------------------------------------
# Backend (the engine)
# ---------------------------------------------------------------------------


class Backend(ABC):
    """The engine. Declares supported harnesses; owns sandbox + session lifecycle.

    Each concrete backend is its own thing and hard-codes what makes it that engine (its
    engine id, its supported harnesses). They do not share a base beyond this ABC.
    """

    #: The single source of truth for what this engine can run.
    supported_harnesses: ClassVar[FrozenSet[HarnessType]] = frozenset()

    def supports(self, harness: HarnessType) -> bool:
        return harness in self.supported_harnesses

    async def setup(self) -> None:
        """Bring the backend up. No-op by default."""
        return None

    async def shutdown(self) -> None:
        """Release backend resources. No-op by default."""
        return None

    @abstractmethod
    async def create_sandbox(self) -> Sandbox:
        """Create a sandbox this backend can run a session in."""

    @abstractmethod
    async def create_session(
        self,
        sandbox: Sandbox,
        config: HarnessAgentTemplate,
        *,
        harness: HarnessType,
        secrets: Optional[Mapping[str, str]] = None,
        trace: Optional[TraceContext] = None,
        run_context: Optional[RunContext] = None,
        session_id: Optional[str] = None,
    ) -> Session:
        """Open a session in ``sandbox`` for an already-harness-shaped ``config``."""


# ---------------------------------------------------------------------------
# Environment (sandbox policy over a backend)
# ---------------------------------------------------------------------------


class Environment:
    """A layer above a backend that owns the sandbox policy.

    Default ``sandbox_per_session=True`` gives each session a fresh sandbox (the cold model,
    strong isolation). Pass ``False`` to keep one sandbox and run many sessions in it; share
    a single ``Environment`` across harnesses to share that sandbox.
    """

    def __init__(self, backend: Backend, *, sandbox_per_session: bool = True) -> None:
        self._backend = backend
        self._sandbox_per_session = sandbox_per_session
        self._shared: Optional[Sandbox] = None
        self._shared_lock = asyncio.Lock()

    @property
    def backend(self) -> Backend:
        return self._backend

    async def setup(self) -> None:
        await self._backend.setup()

    async def shutdown(self) -> None:
        if self._shared is not None:
            await self._shared.destroy()
            self._shared = None
        await self._backend.shutdown()

    async def _sandbox(self) -> Sandbox:
        if self._sandbox_per_session:
            return await self._backend.create_sandbox()
        if self._shared is None:
            async with self._shared_lock:
                if self._shared is None:
                    self._shared = await self._backend.create_sandbox()
        return self._shared

    async def create_session(
        self,
        config: HarnessAgentTemplate,
        *,
        harness: HarnessType,
        session_config: SessionConfig,
        provisioning: Optional[Mapping[str, bytes]] = None,
    ) -> Session:
        """Provision a sandbox per policy, then open a session in it."""
        sandbox = await self._sandbox()
        if provisioning:
            await sandbox.add_files(provisioning)
        return await self._backend.create_session(
            sandbox,
            config,
            harness=harness,
            secrets=session_config.secrets,
            trace=session_config.trace,
            run_context=session_config.run_context,
            session_id=session_config.session_id,
        )


# ---------------------------------------------------------------------------
# Harness (the port; adapters live in adapters/harnesses.py)
# ---------------------------------------------------------------------------


class Harness(ABC):
    """A harness-type-specific wrapper over an :class:`Environment`.

    Holds the mapping from the neutral :class:`~agenta.sdk.agents.dtos.SessionConfig` to this
    harness's config, and validates at construction that the environment's backend can drive
    it (raising :class:`UnsupportedHarnessError` otherwise). The backend stays pure plumbing;
    the per-harness knowledge lives here.
    """

    harness_type: ClassVar[HarnessType]

    def __init__(self, environment: Environment) -> None:
        if not environment.backend.supports(self.harness_type):
            raise UnsupportedHarnessError(self.harness_type, environment.backend)
        self._env = environment

    @property
    def environment(self) -> Environment:
        return self._env

    async def setup(self) -> None:
        await self._env.setup()

    async def cleanup(self) -> None:
        await self._env.shutdown()

    @abstractmethod
    def _to_harness_config(self, config: SessionConfig) -> HarnessAgentTemplate:
        """Map the neutral config into this harness's own config (the mapping logic)."""

    def _provisioning(self, config: SessionConfig) -> Mapping[str, bytes]:
        """Files this harness needs laid into the sandbox before the run.

        The instructions filename is harness-aware, mirroring the runner's workspace
        materialization (``services/agent/.../workspace.ts``): Claude runs through
        ``claude-agent-sdk``, whose memory loader auto-loads ``CLAUDE.md`` only and never reads
        ``AGENTS.md``, so the claude harness's instructions must land in ``CLAUDE.md``. Pi (and
        any other harness) reads ``AGENTS.md``.
        """
        files: dict[str, bytes] = {}
        instructions = config.agent.instructions
        if instructions and instructions.strip():
            filename = (
                "CLAUDE.md" if self.harness_type is HarnessType.CLAUDE else "AGENTS.md"
            )
            files[filename] = instructions.encode("utf-8")
        return files

    async def create_session(self, config: SessionConfig) -> Session:
        return await self._env.create_session(
            self._to_harness_config(config),
            harness=self.harness_type,
            session_config=config,
            provisioning=self._provisioning(config),
        )

    async def prompt(
        self,
        config: SessionConfig,
        messages: Sequence[Message],
        *,
        on_event: Optional[EventSink] = None,
    ) -> AgentResult:
        """Convenience: open a session, run one turn, and destroy it (the cold path)."""
        session = await self.create_session(config)
        try:
            result = await session.prompt(messages, on_event=on_event)
            if result.session_id:
                config.session_id = result.session_id
            return result
        finally:
            await session.destroy()

    async def stream(
        self,
        config: SessionConfig,
        messages: Sequence[Message],
    ) -> AgentStream:
        """Convenience: open a cold session and stream one turn (the live counterpart of
        :meth:`prompt`).

        The session id is carried onto ``config`` when the terminal result arrives, and the
        session is destroyed when the stream ends — by drain, ``break``, or cancellation —
        via the run's cleanup hook.
        """
        session = await self.create_session(config)

        def _absorb(result: AgentResult) -> None:
            if result.session_id:
                config.session_id = result.session_id

        return session.stream(messages).on_result(_absorb).on_cleanup(session.destroy)
