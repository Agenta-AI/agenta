"""Session-scoped mount DTOs.

A session mount IS a mount (same table, same storage) viewed through a session:
`session_id` is required here, where the standalone `Mount` leaves it optional.
The session API models are defined from these DTOs, not from the mount models.
"""

from oss.src.core.mounts.dtos import Mount, MountQuery


class SessionMount(Mount):
    session_id: str  # required for the session-scoped view


class SessionMountQuery(MountQuery):
    session_id: str  # required: a session-scoped query is always session-bound
