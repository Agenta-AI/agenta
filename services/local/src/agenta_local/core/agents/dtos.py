from typing import Any, Literal

from pydantic import BaseModel


class AgentModel(BaseModel):
    provider: str
    name: str
    parameters: dict[str, Any] = {}


class AgentExecution(BaseModel):
    harness: Literal["pi_core"] = "pi_core"
    sandbox: Literal["local"] = "local"


class AgentRevision(BaseModel):
    id: str
    version: int
    instructions: str
    model: AgentModel
    execution: AgentExecution = AgentExecution()
