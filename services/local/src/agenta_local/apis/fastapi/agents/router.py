"""Agent routes: list/create/read plus immutable revision commits."""

from fastapi import APIRouter, Request

from .models import AgentCreate, RevisionCreate

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _serialize(agent) -> dict:
    return agent.model_dump(mode="json")


@router.get("")
async def list_agents(request: Request) -> list[dict]:
    return [_serialize(agent) for agent in await request.app.state.agents.list_agents()]


@router.post("", status_code=201)
async def create_agent(request: Request, payload: AgentCreate) -> dict:
    return _serialize(
        await request.app.state.agents.create_agent(
            name=payload.name,
            instructions=payload.instructions,
            model_json=payload.model.model_dump_json(),
            execution_json=_execution_json(payload.execution),
        )
    )


@router.get("/{agent_id}")
async def get_agent(request: Request, agent_id: str) -> dict:
    agent = await request.app.state.agents.get_agent(agent_id=agent_id)
    if agent is None:
        from agenta_local.core.agents.types import AgentNotFound

        raise AgentNotFound(f"agent {agent_id} does not exist")
    return _serialize(agent)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(request: Request, agent_id: str) -> None:
    await request.app.state.agents.delete_agent(agent_id=agent_id)


@router.post("/{agent_id}/revisions", status_code=201)
async def commit_revision(
    request: Request, agent_id: str, payload: RevisionCreate
) -> dict:
    return _serialize(
        await request.app.state.agents.create_revision(
            agent_id=agent_id,
            instructions=payload.instructions,
            model_json=payload.model.model_dump_json(),
            execution_json=_execution_json(payload.execution),
        )
    )


def _execution_json(execution: dict) -> str:
    import json

    merged = {"harness": "pi_core", "sandbox": "local"}
    merged.update(execution)
    return json.dumps(merged)
