from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.shared.dtos import Reference


class SessionQuery(BaseModel):
    """Root `/sessions/query` filter: reference-scoped, joined through the turns'
    references (WP1's GIN `.contains()`), not denormalized onto the stream row."""

    references: Optional[List[Reference]] = None
