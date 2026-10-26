"""Postgres implementation of `SharingDAOInterface`.

Readers run on `engine.session()`, one statement each. Writers run in
`engine.transaction()`, on their own connection, and take one row lock first:

- agent writes lock `workflow_artifacts (project_id, id) FOR UPDATE`, then write
  `agent_access` and `channel_agents`;
- session writes lock one `session_streams` row `FOR UPDATE`, then write the row and
  `session_grants`.

No path takes these locks in another order. Under the lock a writer compares the stored
policy with the caller's `expected` and raises `SharingConflict(current)` on a mismatch,
which rolls the transaction back.
"""

from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from oss.src.core.sharing.dtos import (
    AccessPolicy,
    AgentPolicyWriteResult,
    SessionGrant,
    SessionGrantInput,
    SessionPolicyState,
    SessionSharingChange,
    SessionSharingWriteResult,
    SessionTombstone,
    UserSessionGrant,
    Visibility,
)
from oss.src.core.sharing.interfaces import SharingDAOInterface
from oss.src.core.sharing.types import SharedItemNotFound, SharingConflict
from oss.src.core.workflows.dtos import AGENT_REFERENCE_KEYS
from oss.src.dbs.postgres.sharing.mappings import (
    map_agent_access_dbe_to_dto,
    map_session_grant_dbe_to_dto,
    map_session_state_row_to_dto,
    map_user_session_grant_to_dto,
)


# -- agents -----------------------------------------------------------------------------

_FETCH_AGENT_POLICY_SQL = """
SELECT visibility, owner_user_id
FROM agent_access
WHERE project_id = :project_id AND artifact_id = :artifact_id
"""

_LOCK_ARTIFACT_SQL = """
SELECT id
FROM workflow_artifacts
WHERE project_id = :project_id AND id = :artifact_id
FOR UPDATE
"""

# `_LOCK_ARTIFACT_SQL` for a policy write: the artifact must be an agent (one of its
# revisions carries `flags.is_agent`, the backfill's rule). A prompt or an evaluator
# has no sharing, so it reads as unknown.
_LOCK_AGENT_ARTIFACT_SQL = """
SELECT a.id
FROM workflow_artifacts a
WHERE a.project_id = :project_id AND a.id = :artifact_id
  AND EXISTS (
      SELECT 1
      FROM workflow_revisions r
      WHERE r.project_id = a.project_id
        AND r.artifact_id = a.id
        AND r.flags @> '{"is_agent": true}'::jsonb
  )
FOR UPDATE OF a
"""

_UPSERT_AGENT_POLICY_SQL = """
INSERT INTO agent_access
    (project_id, artifact_id, visibility, owner_user_id, created_by_id)
VALUES (:project_id, :artifact_id, :visibility, :owner_user_id, :user_id)
ON CONFLICT (project_id, artifact_id) DO UPDATE
SET visibility = EXCLUDED.visibility,
    owner_user_id = EXCLUDED.owner_user_id,
    updated_at = now(),
    updated_by_id = :user_id
"""


# -- sessions ---------------------------------------------------------------------------

_SESSION_STATE_COLUMNS = """
    s.id AS stream_id,
    s.session_id,
    s.visibility,
    s.owner_user_id,
    (
        SELECT c.agent_id FROM channel_threads c
        WHERE c.project_id = s.project_id AND c.session_id = s.session_id
        ORDER BY c.created_at DESC
        LIMIT 1
    ) AS channel_binding_id,
    EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(s.references) = 'array'
                 THEN s.references ELSE '[]'::jsonb END
        ) AS e
        WHERE e ->> 'key' = ANY(CAST(:agent_keys AS text[]))
    ) AS references_agent
"""

# Whatever `deleted_at` and `archived_at` hold: a killed session (`deleted_at`) is still
# listed and resumable, and an archived one is restorable. Both keep their policy.
_FETCH_SESSION_STATE_SQL = f"""
SELECT {_SESSION_STATE_COLUMNS}
FROM session_streams s
WHERE s.project_id = :project_id AND s.session_id = :session_id
"""

# The row, or (when there is none) the session's tombstone, in ONE statement: a session
# with no row costs the same one read as before the tombstone existed. The key row makes
# the statement answer one row in every case; `stream_id` is NULL when there is no row.
_FETCH_SESSION_STATE_OR_TOMBSTONE_SQL = f"""
SELECT {_SESSION_STATE_COLUMNS},
    t.owner_user_id AS tombstone_owner_user_id,
    (t.session_id IS NOT NULL) AS tombstoned
FROM (
    SELECT CAST(:project_id AS uuid) AS project_id,
           CAST(:session_id AS varchar) AS session_id
) k
LEFT JOIN session_streams s
    ON s.project_id = k.project_id AND s.session_id = k.session_id
LEFT JOIN session_trace_tombstones t
    ON s.id IS NULL AND t.project_id = k.project_id AND t.session_id = k.session_id
"""

_LOCK_SESSION_STATE_SQL = f"""
SELECT {_SESSION_STATE_COLUMNS}
FROM session_streams s
WHERE s.project_id = :project_id AND s.session_id = :session_id
FOR UPDATE OF s
"""

# The live copy of `oss000000049`'s session batch statement (technical design 5.2), for
# the one row of `session_id`. Keep the two in step: the owner rule, the first-turn
# order (created_at, then turn_index) and the `visibility IS NULL` guard are the same.
# `test_migration_and_lazy_assignment_agree` runs both on one fixture.
_ASSIGN_LEGACY_SESSION_SQL = """
WITH batch AS (
    SELECT s.project_id, s.id, s.session_id, s.created_by_id
    FROM session_streams s
    WHERE s.project_id = :project_id
      AND s.session_id = :session_id
      AND s.visibility IS NULL
), first_turn AS (
    SELECT DISTINCT ON (t.project_id, t.session_id)
           t.project_id, t.session_id, t.principal_kind, t.principal_id,
           t.sender_user_id, t.origin, t.created_by_id
    FROM session_turns t
    JOIN batch b ON t.project_id = b.project_id AND t.session_id = b.session_id
    ORDER BY t.project_id, t.session_id, t.created_at, t.turn_index
), owner AS (
    SELECT b.project_id, b.id,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM channel_threads c
                WHERE c.project_id = b.project_id AND c.session_id = b.session_id
            ) THEN NULL
            -- Run principal attribution: the stored fields decide, a null sender included.
            WHEN f.principal_kind IS NOT NULL THEN
                CASE
                    WHEN f.origin = 'installation' THEN NULL
                    WHEN f.sender_user_id IS NOT NULL AND f.origin IN ('web', 'api')
                        THEN f.sender_user_id
                    WHEN f.principal_kind = 'human' AND f.origin IN ('web', 'schedule')
                        THEN f.principal_id
                    ELSE NULL
                END
            -- Rows written before run principals only: the creator.
            ELSE COALESCE(b.created_by_id, f.created_by_id)
        END AS owner_user_id
    FROM batch b
    LEFT JOIN first_turn f
      ON f.project_id = b.project_id AND f.session_id = b.session_id
)
UPDATE session_streams s
SET visibility = 'project', owner_user_id = o.owner_user_id
FROM owner o
WHERE s.project_id = o.project_id AND s.id = o.id AND s.visibility IS NULL
"""

_GRANT_COLUMNS = "g.stream_id, g.user_id, g.role, g.created_at, g.created_by_id"

_LIST_SESSION_GRANTS_SQL = f"""
SELECT {_GRANT_COLUMNS}
FROM session_grants g
WHERE g.project_id = :project_id AND g.stream_id = :stream_id
ORDER BY g.created_at ASC NULLS LAST, g.user_id ASC
"""

# Hard-deleted sessions are gone through the cascade; nothing else is excluded.
_LIST_USER_GRANTS_SQL = """
SELECT g.stream_id, s.owner_user_id
FROM session_grants g
JOIN session_streams s ON s.project_id = g.project_id AND s.id = g.stream_id
WHERE g.project_id = :project_id AND g.user_id = :user_id
"""

_SET_SESSION_VISIBILITY_SQL = """
UPDATE session_streams
SET visibility = :visibility
WHERE project_id = :project_id AND id = :stream_id
"""

_DELETE_GRANTS_SQL = """
DELETE FROM session_grants
WHERE project_id = :project_id
  AND stream_id = :stream_id
  AND user_id = ANY(CAST(:user_ids AS uuid[]))
"""

_UPSERT_GRANTS_SQL = f"""
INSERT INTO session_grants AS g
    (project_id, stream_id, user_id, role, created_at, created_by_id)
SELECT :project_id, :stream_id, x.user_id, x.role, now(), :user_id
FROM unnest(CAST(:user_ids AS uuid[]), CAST(:roles AS text[])) AS x(user_id, role)
ON CONFLICT (project_id, stream_id, user_id) DO UPDATE
SET role = EXCLUDED.role
RETURNING {_GRANT_COLUMNS}
"""


def _session_params(*, project_id: UUID, session_id: str) -> dict:
    return {
        "project_id": project_id,
        "session_id": session_id,
        "agent_keys": sorted(AGENT_REFERENCE_KEYS),
    }


def _grant_delta(
    *,
    old: Dict[UUID, SessionGrant],
    change: SessionSharingChange,
) -> tuple[List[UUID], List[SessionGrantInput]]:
    """The users whose grant goes, and the grants to add or change, against the stored
    grants: removals first, then upserts. Only real changes are returned."""

    if change.remove_all_grants:
        kept = {}
    else:
        removed = set(change.remove_user_ids)
        kept = {u: g for u, g in old.items() if u not in removed}
    wanted = {u: g.role for u, g in kept.items()}
    for item in change.upsert_grants:
        wanted[item.user_id] = item.role

    removed_user_ids = [u for u in old if u not in wanted]
    upserted = [
        SessionGrantInput(user_id=u, role=role)
        for u, role in wanted.items()
        if u not in old or old[u].role != role
    ]
    return removed_user_ids, upserted


class SharingDAO(SharingDAOInterface):
    def __init__(self, *, engine):
        self.engine = engine

    # -- agents -------------------------------------------------------------------------

    async def fetch_agent_policy(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
    ) -> Optional[AccessPolicy]:
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    text(_FETCH_AGENT_POLICY_SQL),
                    {"project_id": project_id, "artifact_id": artifact_id},
                )
            ).first()
        return map_agent_access_dbe_to_dto(row) if row is not None else None

    async def set_agent_policy(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        #
        expected: Optional[AccessPolicy],
        policy: AccessPolicy,
        #
        user_id: UUID,
    ) -> AgentPolicyWriteResult:
        params = {"project_id": project_id, "artifact_id": artifact_id}
        async with self.engine.transaction() as connection:
            locked = (
                await connection.execute(text(_LOCK_AGENT_ARTIFACT_SQL), params)
            ).first()
            if locked is None:
                raise SharedItemNotFound()

            row = (
                await connection.execute(text(_FETCH_AGENT_POLICY_SQL), params)
            ).first()
            current = map_agent_access_dbe_to_dto(row) if row is not None else None
            if current != expected:
                raise SharingConflict(current=current)

            await connection.execute(
                text(_UPSERT_AGENT_POLICY_SQL),
                {
                    **params,
                    "visibility": policy.visibility.value,
                    "owner_user_id": policy.owner_user_id,
                    "user_id": user_id,
                },
            )

        return AgentPolicyWriteResult(policy=policy)

    # -- sessions -----------------------------------------------------------------------

    async def fetch_session_policy(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionPolicyState]:
        params = _session_params(project_id=project_id, session_id=session_id)
        row = await self._fetch_session_state(params)
        if row is not None and row.visibility is None:
            # A row an old pod wrote: assign its policy with the backfill's rule, then
            # read it again. Never returned or cached with a NULL policy.
            await self.assign_legacy_session_access(
                project_id=project_id, session_id=session_id
            )
            row = await self._fetch_session_state(params)
        if row is None:
            return None
        return map_session_state_row_to_dto(row)

    async def fetch_session_policy_or_tombstone(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Tuple[Optional[SessionPolicyState], Optional[SessionTombstone]]:
        params = _session_params(project_id=project_id, session_id=session_id)
        async with self.engine.session() as session:
            row = (
                await session.execute(
                    text(_FETCH_SESSION_STATE_OR_TOMBSTONE_SQL), params
                )
            ).first()
        if row is not None and row.stream_id is not None and row.visibility is None:
            # A row an old pod wrote: assigned, then read again (as fetch_session_policy).
            await self.assign_legacy_session_access(
                project_id=project_id, session_id=session_id
            )
            row = await self._fetch_session_state(params)
            return (
                map_session_state_row_to_dto(row) if row is not None else None
            ), None
        if row is None or row.stream_id is None:
            tombstone = (
                SessionTombstone(
                    session_id=session_id, owner_user_id=row.tombstone_owner_user_id
                )
                if row is not None and row.tombstoned
                else None
            )
            return None, tombstone
        return map_session_state_row_to_dto(row), None

    async def _fetch_session_state(self, params: dict):
        async with self.engine.session() as session:
            return (
                await session.execute(text(_FETCH_SESSION_STATE_SQL), params)
            ).first()

    async def assign_legacy_session_access(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> None:
        async with self.engine.transaction() as connection:
            await _assign_legacy(
                connection, project_id=project_id, session_id=session_id
            )

    async def list_session_grants(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> List[SessionGrant]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    text(_LIST_SESSION_GRANTS_SQL),
                    {"project_id": project_id, "stream_id": stream_id},
                )
            ).all()
        return [map_session_grant_dbe_to_dto(row) for row in rows]

    async def list_user_grants(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[UserSessionGrant]:
        async with self.engine.session() as session:
            rows = (
                await session.execute(
                    text(_LIST_USER_GRANTS_SQL),
                    {"project_id": project_id, "user_id": user_id},
                )
            ).all()
        return [map_user_session_grant_to_dto(row) for row in rows]

    async def set_session_sharing(
        self,
        *,
        project_id: UUID,
        session_id: str,
        #
        expected: AccessPolicy,
        change: SessionSharingChange,
        #
        user_id: UUID,
    ) -> SessionSharingWriteResult:
        params = _session_params(project_id=project_id, session_id=session_id)
        async with self.engine.transaction() as connection:
            row = (
                await connection.execute(text(_LOCK_SESSION_STATE_SQL), params)
            ).first()
            if row is not None and row.visibility is None:
                # Not reachable through the service (it reads `expected` through
                # `fetch_session_policy`, which assigns first), but a legacy row is
                # never compared as NULL: assign it under the lock and read it again.
                await _assign_legacy(
                    connection, project_id=project_id, session_id=session_id
                )
                row = (
                    await connection.execute(text(_LOCK_SESSION_STATE_SQL), params)
                ).first()
            if row is None:
                raise SharedItemNotFound()

            state = map_session_state_row_to_dto(row)
            before = state.policy
            if before != expected:
                raise SharingConflict(current=before)

            stream = {"project_id": project_id, "stream_id": state.stream_id}
            old = {
                grant.user_id: grant
                for grant in (
                    map_session_grant_dbe_to_dto(r)
                    for r in (
                        await connection.execute(text(_LIST_SESSION_GRANTS_SQL), stream)
                    ).all()
                )
            }
            removed_user_ids, upserted = _grant_delta(old=old, change=change)

            policy = before
            if change.visibility is not None and change.visibility != before.visibility:
                policy = AccessPolicy(
                    visibility=change.visibility,
                    owner_user_id=before.owner_user_id,
                )
                await connection.execute(
                    text(_SET_SESSION_VISIBILITY_SQL),
                    {**stream, "visibility": policy.visibility.value},
                )

            if removed_user_ids:
                await connection.execute(
                    text(_DELETE_GRANTS_SQL), {**stream, "user_ids": removed_user_ids}
                )

            written: Dict[UUID, SessionGrant] = {}
            if upserted:
                rows = (
                    await connection.execute(
                        text(_UPSERT_GRANTS_SQL),
                        {
                            **stream,
                            "user_id": user_id,
                            "user_ids": [item.user_id for item in upserted],
                            "roles": [item.role.value for item in upserted],
                        },
                    )
                ).all()
                written = {
                    grant.user_id: grant
                    for grant in (map_session_grant_dbe_to_dto(r) for r in rows)
                }

        removed = set(removed_user_ids)
        grants = [
            written.get(u, grant) for u, grant in old.items() if u not in removed
        ] + [grant for u, grant in written.items() if u not in old]

        return SessionSharingWriteResult(
            state=state.model_copy(update={"policy": policy}),
            before=before,
            grants=grants,
            upserted=upserted,
            removed_user_ids=removed_user_ids,
        )


async def lock_agent_policy(
    session,
    *,
    project_id: UUID,
    artifact_id: UUID,
) -> Optional[AccessPolicy]:
    """Inside the caller's write transaction (`session` is an ORM session or a
    connection): lock `workflow_artifacts (project_id, id)` FOR UPDATE, then read the
    agent's policy, uncached. The lock is held until the caller commits, so a concurrent
    `set_agent_policy` (a make-private, a transfer) either committed before this read
    (and its policy is seen here) or waits for the caller's commit. Same lock order as
    `set_agent_policy`: the artifact first, then `channel_agents`.

    None when the agent has no access row, or no artifact row (a static catalog agent,
    which is never private)."""

    params = {"project_id": project_id, "artifact_id": artifact_id}
    locked = (await session.execute(text(_LOCK_ARTIFACT_SQL), params)).first()
    if locked is None:
        return None
    row = (await session.execute(text(_FETCH_AGENT_POLICY_SQL), params)).first()
    return map_agent_access_dbe_to_dto(row) if row is not None else None


async def guard_agent_activation(
    session,
    *,
    project_id: UUID,
    artifact_id: UUID,
    user_id: UUID,
) -> None:
    """`lock_agent_policy`, then refuse a private agent of someone else with
    `SharedItemNotFound` (what an unknown agent answers): only its owner writes an
    active channel binding of a private agent (rule A2: nobody else may see it)."""

    policy = await lock_agent_policy(
        session, project_id=project_id, artifact_id=artifact_id
    )
    if (
        policy is not None
        and policy.visibility == Visibility.PRIVATE
        and policy.owner_user_id != user_id
    ):
        raise SharedItemNotFound()


async def _assign_legacy(
    connection: AsyncConnection,
    *,
    project_id: UUID,
    session_id: str,
) -> None:
    await connection.execute(
        text(_ASSIGN_LEGACY_SESSION_SQL),
        {"project_id": project_id, "session_id": session_id},
    )
