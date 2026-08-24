"""Core seam between local services and concrete executors. No SDK types here."""

from abc import ABC, abstractmethod

from ..agents.dtos import AgentRevision
from .dtos import ExecutionCredential, ExecutionMessage, ExecutionStream


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
