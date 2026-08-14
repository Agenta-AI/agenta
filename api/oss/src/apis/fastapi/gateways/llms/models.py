"""LLM gateway management wire models (entities.md §6).

The house triple, matching `triggers/models.py`: create/edit requests wrap the core DTO
under a named field, queries add `Windowing`, responses carry `count` plus the entity.
"""

from typing import List, Optional

from pydantic import BaseModel, Field

from oss.src.core.gateways.llms.dtos import (
    LLMEndpoint,
    LLMEndpointCreate,
    LLMEndpointEdit,
    LLMEndpointQuery,
)
from oss.src.core.shared.dtos import Windowing


class LLMEndpointCreateRequest(BaseModel):
    endpoint: LLMEndpointCreate


class LLMEndpointEditRequest(BaseModel):
    endpoint: LLMEndpointEdit


class LLMEndpointQueryRequest(BaseModel):
    endpoint: Optional[LLMEndpointQuery] = None
    windowing: Optional[Windowing] = None


class LLMEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LLMEndpoint] = None


class LLMEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LLMEndpoint] = Field(default_factory=list)
