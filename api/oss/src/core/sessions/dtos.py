from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.shared.dtos import Reference


class SessionQuery(BaseModel):
    """Root `/sessions/query` filter: reference-scoped, joined through the turns'
    references (WP1's GIN `.contains()`), not denormalized onto the stream row."""

    references: Optional[List[Reference]] = None
    # Include ended (killed) sessions so the durable list keeps resumable history — absence then
    # means genuinely hard-deleted, which the frontend uses to prune a locally-cached session.
    include_ended: bool = False
    # Include archived sessions — off by default (archive hides); on for the archived view.
    include_archived: bool = False
