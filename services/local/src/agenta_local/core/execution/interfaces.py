"""Core seam between local services and concrete executors. No SDK types here."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ..agents.dtos import AgentRevision
from .dtos import (
    ExecutionCredential,
    ExecutionEvent,
    ExecutionMessage,
    ExecutionRequest,
    ExecutionStream,
)


class AgentExecutorInterface(ABC):
    @abstractmethod
    def stream(
        self,
        *,
        revision: AgentRevision,
        messages: list[ExecutionMessage],
        credential: ExecutionCredential,
    ) -> ExecutionStream:
        raise NotImplementedError


class ExecutionServiceInterface(ABC):
    @abstractmethod
    def stream_turn(self, request: ExecutionRequest) -> AsyncIterator[ExecutionEvent]:
        """Run one turn end to end, yielding the wire frames; commits exactly one
        terminal turn state before the iterator exits."""
        raise NotImplementedError

    @abstractmethod
    async def cancel_turn(self, *, turn_id: str) -> None:
        """Cancel an active turn by id (no-op when already terminal)."""
        raise NotImplementedError

    @abstractmethod
    def active_turn_ids(self) -> set[str]:
        """Snapshot of currently registered in-flight turn ids."""
        raise NotImplementedError
