from typing import Dict, Optional

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Reference


class RetrievalInfo(BaseModel):
    references: Dict[str, Reference] = Field(default_factory=dict)
    key: Optional[str] = None
