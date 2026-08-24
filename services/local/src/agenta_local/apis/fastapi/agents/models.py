"""Agent route models (wire shapes only; no DBEs leak here)."""

from typing import Any

from pydantic import BaseModel


class ModelSpec(BaseModel):
    provider: str
    name: str
    parameters: dict[str, Any] = {}


class AgentCreate(BaseModel):
    name: str
    instructions: str
    model: ModelSpec
    execution: dict[str, Any] = {}


class RevisionCreate(BaseModel):
    instructions: str
    model: ModelSpec
    execution: dict[str, Any] = {}
