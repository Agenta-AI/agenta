"""Composition-root factory wiring concrete adapters into ExecutionService."""

from agenta_local.core.agents.service import AgentsService
from agenta_local.core.execution.interfaces import AgentExecutorInterface
from agenta_local.core.execution.service import ExecutionService
from agenta_local.core.providers.service import ProvidersService
from agenta_local.core.sessions.service import SessionsService


def build_execution_service(
    *,
    sessions: SessionsService,
    agents: AgentsService,
    providers: ProvidersService,
    executor: AgentExecutorInterface,
) -> ExecutionService:
    return ExecutionService(
        sessions=sessions, agents=agents, credentials=providers, executor=executor
    )
