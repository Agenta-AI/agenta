"""The workflows DAO: `GitDAO` on the workflow tables, plus the agent access writes that
share a transaction with the workflow rows.

Lock order (the same as `SharingDAO.set_agent_policy`): an agent access write locks
`workflow_artifacts (project_id, id) FOR UPDATE` first.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import text

from oss.src.core.git.dtos import Artifact, ArtifactCreate
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.sharing.dtos import AccessPolicy
from oss.src.core.sharing.types import AgentCreationFailed
from oss.src.core.workflows.interfaces import WorkflowsDAOInterface
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.sharing.mappings import map_agent_access_dto_to_dbe
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# One statement. The CTE takes the artifact row lock before the insert, so the insert
# cannot land after a concurrent `set_agent_policy` read "no row" under the same lock
# (that write would overwrite this row, or this one would be lost). ON CONFLICT covers a
# row that a concurrent writer committed while this statement waited for the lock.
#
# "First" is the earliest agent revision by (created_at, id), not "no other agent
# revision": two first agent revisions can commit before either call runs, and each
# call then sees the other. Only the call for the earliest one inserts, whatever order
# the calls run in. A NULL created_at sorts first. When the earliest agent revision has
# no owner (it never calls this), no row is written.
_ENSURE_FIRST_AGENT_ACCESS_SQL = """
WITH locked AS (
    SELECT a.id
    FROM workflow_artifacts a
    WHERE a.project_id = :project_id AND a.id = :artifact_id
    FOR UPDATE
),
this_revision AS (
    SELECT COALESCE(r.created_at, '-infinity'::timestamptz) AS created_at, r.id
    FROM workflow_revisions r
    WHERE r.project_id = :project_id
      AND r.artifact_id = :artifact_id
      AND r.id = :revision_id
)
INSERT INTO agent_access
    (project_id, artifact_id, visibility, owner_user_id, created_at, created_by_id)
SELECT :project_id, locked.id, 'project', :owner_user_id, now(), :owner_user_id
FROM locked, this_revision
WHERE NOT EXISTS (
    SELECT 1
    FROM workflow_revisions r
    WHERE r.project_id = :project_id
      AND r.artifact_id = :artifact_id
      AND r.flags @> '{"is_agent": true}'::jsonb
      AND (COALESCE(r.created_at, '-infinity'::timestamptz), r.id)
          < (this_revision.created_at, this_revision.id)
)
ON CONFLICT (project_id, artifact_id) DO NOTHING
RETURNING artifact_id
"""


class WorkflowsDAO(GitDAO, WorkflowsDAOInterface):
    """The constructor is `GitDAO`'s."""

    async def create_agent_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_create: ArtifactCreate,
        access: AccessPolicy,
        #
        artifact_id: Optional[UUID] = None,
        platform_meta: bool = False,
    ) -> Artifact:
        try:
            async with self.engine.session() as session:
                artifact = await self._insert_artifact(
                    session=session,
                    project_id=project_id,
                    user_id=user_id,
                    artifact_create=artifact_create,
                    artifact_id=artifact_id,
                    platform_meta=platform_meta,
                )
                session.add(
                    map_agent_access_dto_to_dbe(
                        project_id=project_id,
                        artifact_id=artifact.id,
                        policy=access,
                        user_id=user_id,
                    )
                )
                await session.commit()
                return artifact

        except EntityCreationConflict:
            raise

        except Exception as e:
            log.error(
                "[sharing] agent creation failed",
                project_id=str(project_id),
                artifact_id=str(artifact_id) if artifact_id else None,
                error_type=type(e).__name__,
            )
            raise AgentCreationFailed() from e

    async def ensure_first_agent_access(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        revision_id: UUID,
        owner_user_id: UUID,
    ) -> bool:
        async with self.engine.transaction() as connection:
            inserted = (
                await connection.execute(
                    text(_ENSURE_FIRST_AGENT_ACCESS_SQL),
                    {
                        "project_id": project_id,
                        "artifact_id": artifact_id,
                        "revision_id": revision_id,
                        "owner_user_id": owner_user_id,
                    },
                )
            ).first()
        return inserted is not None
