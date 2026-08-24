"""Core seam for agent persistence. Typed DTOs in, domain failures out."""

from abc import ABC, abstractmethod

from .dtos import Agent, AgentRevision


class AgentsDAOInterface(ABC):
    @abstractmethod
    async def create_agent(
        self,
        *,
        name: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> Agent:
        """Insert the agent plus its first immutable revision (version 1) and point
        current_revision_id at it, all in one transaction."""
        raise NotImplementedError

    @abstractmethod
    async def get_agent(self, *, agent_id: str) -> Agent | None:
        raise NotImplementedError

    @abstractmethod
    async def list_agents(self) -> list[Agent]:
        """Agent summaries ordered by updated_at DESC, id ASC."""
        raise NotImplementedError

    @abstractmethod
    async def rename_agent(self, *, agent_id: str, name: str) -> Agent:
        """Change metadata only; never creates a revision."""
        raise NotImplementedError

    @abstractmethod
    async def delete_agent(self, *, agent_id: str) -> None:
        """Remove the agent and its revisions; blocked while sessions reference them."""
        raise NotImplementedError

    @abstractmethod
    async def set_current_revision(self, *, agent_id: str, revision_id: str) -> Agent:
        raise NotImplementedError

    @abstractmethod
    async def create_revision(
        self,
        *,
        agent_id: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> AgentRevision:
        """Allocate version = max(version)+1 under the write transaction and make it
        the agent's current revision."""
        raise NotImplementedError

    @abstractmethod
    async def get_revision(self, *, revision_id: str) -> AgentRevision | None:
        raise NotImplementedError

    @abstractmethod
    async def list_revisions(self, *, agent_id: str) -> list[AgentRevision]:
        """Revisions ordered by version DESC (latest first)."""
        raise NotImplementedError
