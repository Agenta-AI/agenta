from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from oss.src.core.interactions.dtos import (
    Interaction,
    InteractionCreate,
    InteractionQuery,
    InteractionTransition,
)
from oss.src.core.shared.dtos import Windowing


class InteractionCreateRequest(BaseModel):
    interaction: InteractionCreate


class InteractionTransitionRequest(BaseModel):
    transition: InteractionTransition


class InteractionQueryRequest(BaseModel):
    query: Optional[InteractionQuery] = None
    windowing: Optional[Windowing] = None


class InteractionResponse(BaseModel):
    count: int = 0
    interaction: Optional[Interaction] = None


class InteractionsResponse(BaseModel):
    count: int = 0
    interactions: List[Interaction] = Field(default_factory=list)


class InteractionRespondRequest(BaseModel):
    answer: Optional[Dict[str, Any]] = None
