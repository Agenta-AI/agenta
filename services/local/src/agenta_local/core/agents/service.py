"""Agents domain service: input validation above the DAO seam."""

import json
from typing import NoReturn

from .dtos import Agent, AgentRevision
from .interfaces import AgentsDAOInterface
from .types import ImmutableRevision


def _clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("agent name must be non-empty")
    return cleaned


def _require_json_object(raw: str, field: str) -> None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field} must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{field} must encode a JSON object")  # noqa: TRY004 (input validation)


class AgentsService:
    def __init__(self, agents: AgentsDAOInterface) -> None:
        self._agents = agents

    async def create_agent(
        self,
        *,
        name: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> Agent:
        _require_json_object(model_json, "model_json")
        _require_json_object(execution_json, "execution_json")
        return await self._agents.create_agent(
            name=_clean_name(name),
            instructions=instructions,
            model_json=model_json,
            execution_json=execution_json,
        )

    async def get_agent(self, *, agent_id: str) -> Agent | None:
        return await self._agents.get_agent(agent_id=agent_id)

    async def list_agents(self) -> list[Agent]:
        return await self._agents.list_agents()

    async def rename_agent(self, *, agent_id: str, name: str) -> Agent:
        return await self._agents.rename_agent(
            agent_id=agent_id, name=_clean_name(name)
        )

    async def delete_agent(self, *, agent_id: str) -> None:
        await self._agents.delete_agent(agent_id=agent_id)

    async def set_current_revision(self, *, agent_id: str, revision_id: str) -> Agent:
        return await self._agents.set_current_revision(
            agent_id=agent_id, revision_id=revision_id
        )

    async def create_revision(
        self,
        *,
        agent_id: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> AgentRevision:
        _require_json_object(model_json, "model_json")
        _require_json_object(execution_json, "execution_json")
        return await self._agents.create_revision(
            agent_id=agent_id,
            instructions=instructions,
            model_json=model_json,
            execution_json=execution_json,
        )

    def update_revision(self, *, revision_id: str) -> NoReturn:
        """Revisions are immutable by contract; committing a new revision is the
        only way to change executable configuration."""
        raise ImmutableRevision(
            f"revision {revision_id} is immutable; commit a new revision instead"
        )

    async def get_revision(self, *, revision_id: str) -> AgentRevision | None:
        return await self._agents.get_revision(revision_id=revision_id)

    async def list_revisions(self, *, agent_id: str) -> list[AgentRevision]:
        return await self._agents.list_revisions(agent_id=agent_id)
