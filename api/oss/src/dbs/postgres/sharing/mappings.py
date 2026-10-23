from oss.src.core.sharing.dtos import (
    AccessPolicy,
    SessionGrant,
    SessionRole,
    UserSessionGrant,
    Visibility,
)


def map_agent_access_dbe_to_dto(row) -> AccessPolicy:
    """`row` is an `AgentAccessDBE` or a result row with `visibility` and
    `owner_user_id`."""

    return AccessPolicy(
        visibility=Visibility(row.visibility),
        owner_user_id=row.owner_user_id,
    )


def map_session_grant_dbe_to_dto(row) -> SessionGrant:
    """`row` is a `SessionGrantDBE` or a result row with its columns."""

    return SessionGrant(
        stream_id=row.stream_id,
        user_id=row.user_id,
        role=SessionRole(row.role),
        created_at=row.created_at,
        created_by_id=row.created_by_id,
    )


def map_user_session_grant_to_dto(row) -> UserSessionGrant:
    """`row` is a result row with `stream_id` and the session's `owner_user_id`."""

    return UserSessionGrant(stream_id=row.stream_id, owner_user_id=row.owner_user_id)
