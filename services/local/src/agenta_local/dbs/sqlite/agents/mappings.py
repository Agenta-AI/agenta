"""Pure DBE -> DTO converters; naive-UTC timestamps leave the DB aware."""

import json
from datetime import UTC, datetime

from agenta_local.core.agents.dtos import (
    Agent,
    AgentExecution,
    AgentModel,
    AgentRevision,
)

from .dbes import AgentDBE, AgentRevisionDBE


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC)


def dbe_to_revision(dbe: AgentRevisionDBE) -> AgentRevision:
    return AgentRevision(
        id=dbe.id,
        version=dbe.version,
        instructions=dbe.instructions,
        model=AgentModel.model_validate(json.loads(dbe.model_json)),
        execution=AgentExecution.model_validate(json.loads(dbe.execution_json)),
    )


def dbe_to_agent(dbe: AgentDBE, *, current_revision: AgentRevisionDBE) -> Agent:
    return Agent(
        id=dbe.id,
        name=dbe.name,
        current_revision=dbe_to_revision(current_revision),
        created_at=_aware(dbe.created_at),
        updated_at=_aware(dbe.updated_at),
    )
