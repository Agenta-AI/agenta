from typing import Optional

from oss.src.core.mounts.dtos import MountQuery


def merge_mount_query(
    *,
    session_id: Optional[str] = None,
    include_archived: bool = False,
    body_query: Optional[MountQuery] = None,
) -> MountQuery:
    """Merge query-param filters with an optional body query."""
    base = body_query or MountQuery()

    if session_id is not None:
        base.session_id = session_id

    if include_archived:
        base.include_archived = include_archived

    return base
