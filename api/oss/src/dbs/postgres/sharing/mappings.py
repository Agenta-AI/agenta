from typing import Optional
from uuid import UUID

from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    SessionGrant,
    SessionPolicyState,
    SessionRole,
    UserSessionGrant,
    Visibility,
)
from oss.src.dbs.postgres.sharing.dbes import AgentAccessDBE


def map_agent_access_dbe_to_dto(row) -> AccessPolicy:
    """`row` is an `AgentAccessDBE` or a result row with `visibility` and
    `owner_user_id`."""

    return AccessPolicy(
        visibility=Visibility(row.visibility),
        owner_user_id=row.owner_user_id,
    )


def map_joined_agent_access_to_dto(
    *,
    visibility: Optional[str],
    owner_user_id: Optional[UUID],
) -> AccessPolicy:
    """The `agent_access` columns of a LEFT JOIN: no row (NULL visibility) is the
    ownerless project policy."""

    if visibility is None:
        return OWNERLESS_PROJECT_POLICY
    return AccessPolicy(visibility=Visibility(visibility), owner_user_id=owner_user_id)


def map_agent_access_dto_to_dbe(
    *,
    project_id: UUID,
    artifact_id: UUID,
    policy: AccessPolicy,
    user_id: UUID,
):
    """The `agent_access` row of a new agent."""

    return AgentAccessDBE(
        project_id=project_id,
        artifact_id=artifact_id,
        visibility=policy.visibility.value,
        owner_user_id=policy.owner_user_id,
        created_by_id=user_id,
    )


def map_session_state_row_to_dto(row) -> SessionPolicyState:
    """A session policy read row (`stream_id`, `session_id`, `visibility`,
    `owner_user_id`, `channel_binding_id`, `references_agent`). A channel thread
    names the session when `channel_binding_id` is set."""

    return SessionPolicyState(
        stream_id=row.stream_id,
        session_id=row.session_id,
        policy=map_agent_access_dbe_to_dto(row),
        is_channel=row.channel_binding_id is not None,
        channel_binding_id=row.channel_binding_id,
        references_agent=bool(row.references_agent),
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
