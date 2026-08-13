"""LLM gateway management wire models (entities.md §6).

The house triple, matching `triggers/models.py`: create/edit requests wrap the core DTO
under a named field, queries add `Windowing`, responses carry `count` plus the entity.
"""

from typing import List, Optional

from pydantic import BaseModel, Field

from oss.src.core.gateways.llms.dtos import (
    LlmEndpoint,
    LlmEndpointCreate,
    LlmEndpointEdit,
    LlmEndpointQuery,
)
from oss.src.core.shared.dtos import Windowing


class LlmEndpointCreateRequest(BaseModel):
    endpoint: LlmEndpointCreate


class LlmEndpointEditRequest(BaseModel):
    endpoint: LlmEndpointEdit


class LlmEndpointQueryRequest(BaseModel):
    endpoint: Optional[LlmEndpointQuery] = None
    windowing: Optional[Windowing] = None


class LlmEndpointResponse(BaseModel):
    count: int = 0
    endpoint: Optional[LlmEndpoint] = None


class LlmEndpointsResponse(BaseModel):
    count: int = 0
    endpoints: List[LlmEndpoint] = Field(default_factory=list)
