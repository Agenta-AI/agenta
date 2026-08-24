"""ExecutionService: turn lifecycle around AgentExecutorInterface (contracts.md).

Owns admission -> running -> exactly one terminal commit, the active-turn
registry backing user cancellation, and the wall-clock budget. Runner,
composition, and persistence adapters stay out of this module behind protocols.

`admit()` performs every fallible pre-stream step (so HTTP routes can map
failures to stable error codes before a stream starts); `stream_admitted()`
drives the frames and commits the single terminal state. `stream_turn()` is the
convenience composition of both for direct callers (tests, scripts).
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass
from typing import Protocol

from ..agents.dtos import AgentRevision
from ..agents.types import RevisionNotFound
from ..exceptions import DomainError
from ..sessions.dtos import Session, TurnStatus
from ..sessions.types import SessionNotFound, TurnNotActive
from .dtos import (
    ExecutionCredential,
    ExecutionEvent,
    ExecutionMessage,
    ExecutionRequest,
)
from .interfaces import AgentExecutorInterface, ExecutionServiceInterface
from .types import (
    DEFAULT_TURN_TIMEOUT_S,
    CancelledTurn,
    RunnerUnavailable,
    TurnTimeout,
    input_hash,
)


class SessionsProtocol(Protocol):
    async def get_session(self, *, session_id: str) -> Session | None: ...

    async def begin_turn(
        self, *, session_id: str, client_turn_id: str, input: str, input_hash: str
    ): ...

    async def mark_turn_running(self, *, turn_id: str): ...

    async def load_completed_context(
        self, *, session_id: str, current_turn_id: str
    ) -> list: ...

    async def complete_turn(self, *, turn_id: str, assistant_message: str): ...

    async def fail_turn(self, *, turn_id: str, error: str): ...

    async def cancel_turn(self, *, turn_id: str): ...

    async def interrupt_incomplete_turns(self) -> int: ...


class AgentsReadProtocol(Protocol):
    async def get_revision(self, *, revision_id: str) -> AgentRevision | None: ...


class CredentialsProtocol(Protocol):
    async def get_for_execution(self, *, provider: str): ...


@dataclass
class _ActiveTurn:
    """One in-flight turn: registry entry keyed by its session id."""

    turn_id: str
    task: asyncio.Task
    reason: TurnStatus | None = None


@dataclass
class Admission:
    """Everything resolved before the first frame; safe to fail fast."""

    session_id: str
    turn_id: str
    budget: float
    stream: object


class ExecutionService(ExecutionServiceInterface):
    def __init__(
        self,
        *,
        sessions: SessionsProtocol,
        agents: AgentsReadProtocol,
        credentials: CredentialsProtocol,
        executor: AgentExecutorInterface,
        default_timeout_s: float = DEFAULT_TURN_TIMEOUT_S,
    ) -> None:
        self._sessions = sessions
        self._agents = agents
        self._credentials = credentials
        self._executor = executor
        self._default_timeout_s = default_timeout_s
        self._active: dict[str, _ActiveTurn] = {}

    async def admit(self, request: ExecutionRequest) -> Admission:
        session = await self._sessions.get_session(session_id=request.session_id)
        if session is None:
            raise SessionNotFound(f"session {request.session_id} does not exist")
        revision = await self._agents.get_revision(
            revision_id=session.agent_revision_id
        )
        if revision is None:
            raise RevisionNotFound(
                f"revision {session.agent_revision_id} does not exist"
            )
        credential = await self._credentials.get_for_execution(
            provider=revision.model.provider
        )
        turn = await self._sessions.begin_turn(
            session_id=session.id,
            client_turn_id=request.client_turn_id or f"turn_{uuid.uuid4().hex}",
            input=request.text,
            input_hash=input_hash(request.text),
        )
        context = await self._sessions.load_completed_context(
            session_id=session.id, current_turn_id=turn.id
        )
        messages = [
            ExecutionMessage(role=message.role.value, content=message.content["text"])
            for message in context
        ]
        await self._sessions.mark_turn_running(turn_id=turn.id)
        task = asyncio.current_task()
        if task is not None:
            self._active[session.id] = _ActiveTurn(turn_id=turn.id, task=task)
        stream = self._executor.stream(
            revision=revision,
            messages=messages,
            credential=ExecutionCredential(
                provider=revision.model.provider,
                api_key=credential.api_key,
                base_url=credential.base_url,
            ),
        )
        return Admission(
            session_id=session.id,
            turn_id=turn.id,
            budget=request.timeout_s or self._default_timeout_s,
            stream=stream,
        )

    async def stream_admitted(
        self, admission: Admission
    ) -> AsyncIterator[ExecutionEvent]:
        try:
            try:
                async with asyncio.timeout(admission.budget):
                    async with aclosing(admission.stream.events) as events:
                        async for event in events:
                            yield event
                    result = await admission.stream.result()
            except TimeoutError as exc:
                await self._commit_failure(
                    admission.turn_id,
                    "turn_timeout",
                    f"exceeded {admission.budget}s budget",
                )
                raise TurnTimeout(
                    f"turn {admission.turn_id} exceeded {admission.budget}s budget"
                ) from exc
            except asyncio.CancelledError as exc:
                # Explicit stop records cancelled; client disconnect and service
                # shutdown record interrupted (contracts.md).
                entry = self._active.get(admission.session_id)
                reason = entry.reason if entry is not None else None
                if entry is not None:
                    entry.reason = None
                if reason is TurnStatus.CANCELLED:
                    await self._best_effort(
                        self._sessions.cancel_turn(turn_id=admission.turn_id)
                    )
                    raise CancelledTurn(
                        f"turn {admission.turn_id} was cancelled"
                    ) from exc
                payload = json.dumps({"type": "interrupted", "message": str(exc)})
                await self._best_effort(
                    self._sessions.interrupt_turn(
                        turn_id=admission.turn_id, error=payload
                    )
                )
                raise CancelledTurn(
                    f"turn {admission.turn_id} was interrupted"
                ) from exc
            except DomainError as exc:
                await self._commit_failure(admission.turn_id, exc.code, str(exc))
                raise
            except Exception as exc:
                await self._commit_failure(
                    admission.turn_id, "runner_unavailable", str(exc)
                )
                raise RunnerUnavailable(
                    f"turn {admission.turn_id} failed against the runner: {exc}"
                ) from exc
            finally:
                entry = self._active.get(admission.session_id)
                self._active.pop(admission.session_id, None)
        except GeneratorExit:
            # Consumer teardown (stop or disconnect) closes the generator at its
            # yield point; the registry reason decides cancelled vs interrupted.
            reason = entry.reason if entry is not None else None
            if reason is TurnStatus.CANCELLED:
                await self._best_effort(
                    self._sessions.cancel_turn(turn_id=admission.turn_id)
                )
            else:
                payload = json.dumps({"type": "interrupted", "message": "disconnected"})
                await self._best_effort(
                    self._sessions.interrupt_turn(
                        turn_id=admission.turn_id, error=payload
                    )
                )
            raise
        await self._sessions.complete_turn(
            turn_id=admission.turn_id, assistant_message=result.assistant_text
        )

    async def stream_turn(  # type: ignore[override]
        self, request: ExecutionRequest
    ) -> AsyncIterator[ExecutionEvent]:
        admission = await self.admit(request)
        async for event in self.stream_admitted(admission):
            yield event

    async def stop_session(self, *, session_id: str) -> bool:
        """Cancel the session's single active task; explicit stop records cancelled.

        The terminal commit happens here, not in stream teardown, because
        generator close timing under a streaming response is not guaranteed.
        Returns False when the session has no registered active turn.
        """
        entry = self._active.get(session_id)
        if entry is None or entry.task.done():
            return False
        entry.reason = TurnStatus.CANCELLED
        await self._best_effort(self._sessions.cancel_turn(turn_id=entry.turn_id))
        entry.task.cancel()
        return True

    async def cancel_turn(self, *, turn_id: str) -> None:
        for entry in self._active.values():
            if entry.turn_id == turn_id and not entry.task.done():
                entry.reason = TurnStatus.CANCELLED
                entry.task.cancel()
                return
        # Not registered yet (or already finished iterating): fall back to the
        # direct row transition so a pending turn can still be cancelled.
        try:
            await self._sessions.cancel_turn(turn_id=turn_id)
        except TurnNotActive:
            pass

    def active_turn_ids(self) -> set[str]:
        return {entry.turn_id for entry in self._active.values()}

    def active_session_ids(self) -> set[str]:
        return set(self._active)

    async def recover_interrupted_turns(self) -> int:
        """Startup recovery for leftover pending/running rows."""
        return await self._sessions.interrupt_incomplete_turns()

    async def _commit_failure(
        self, turn_id: str, failure_type: str, message: str
    ) -> None:
        payload = json.dumps({"type": failure_type, "message": message})
        await self._best_effort(
            self._sessions.fail_turn(turn_id=turn_id, error=payload)
        )

    @staticmethod
    async def _best_effort(operation) -> None:
        """Terminal commits are once-only; a losing racer keeps its own state."""
        try:
            await operation
        except TurnNotActive:
            pass
