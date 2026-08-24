"""ExecutionService: turn lifecycle around AgentExecutorInterface (contracts.md).

Owns admission -> running -> exactly one terminal commit, the active-turn
registry backing user cancellation, and the wall-clock budget. Runner,
composition, and persistence adapters stay out of this module behind protocols.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import aclosing
from typing import Protocol

from ..agents.dtos import AgentRevision
from ..agents.types import RevisionNotFound
from ..exceptions import DomainError
from ..sessions.dtos import Session
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
        self._active: dict[str, asyncio.Task] = {}

    async def stream_turn(  # type: ignore[override]
        self, request: ExecutionRequest
    ) -> AsyncIterator[ExecutionEvent]:
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
            self._active[turn.id] = task
        stream = self._executor.stream(
            revision=revision,
            messages=messages,
            credential=ExecutionCredential(
                provider=revision.model.provider,
                api_key=credential.api_key,
                base_url=credential.base_url,
            ),
        )
        budget = request.timeout_s or self._default_timeout_s
        try:
            try:
                async with asyncio.timeout(budget):
                    async with aclosing(stream.events) as events:
                        async for event in events:
                            yield event
                    result = await stream.result()
            except TimeoutError as exc:
                await self._commit_failure(
                    turn.id, "turn_timeout", f"exceeded {budget}s budget"
                )
                raise TurnTimeout(f"turn {turn.id} exceeded {budget}s budget") from exc
            except asyncio.CancelledError as exc:
                await self._best_effort(self._sessions.cancel_turn(turn_id=turn.id))
                raise CancelledTurn(f"turn {turn.id} was cancelled") from exc
            except DomainError as exc:
                await self._commit_failure(turn.id, exc.code, str(exc))
                raise
            except Exception as exc:
                await self._commit_failure(turn.id, "runner_unavailable", str(exc))
                raise RunnerUnavailable(
                    f"turn {turn.id} failed against the runner: {exc}"
                ) from exc
        finally:
            self._active.pop(turn.id, None)
        await self._sessions.complete_turn(
            turn_id=turn.id, assistant_message=result.assistant_text
        )

    async def cancel_turn(self, *, turn_id: str) -> None:
        task = self._active.get(turn_id)
        if task is not None and not task.done():
            task.cancel()
            return
        # Not registered yet (or already finished iterating): fall back to the
        # direct row transition so a pending turn can still be cancelled.
        try:
            await self._sessions.cancel_turn(turn_id=turn_id)
        except TurnNotActive:
            pass

    def active_turn_ids(self) -> set[str]:
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
