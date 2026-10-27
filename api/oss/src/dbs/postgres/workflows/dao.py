"""The workflows DAO: `GitDAO` on the workflow tables, plus the agent access writes that
share a transaction with the workflow rows.

Lock order (the same as `SharingDAO.set_agent_policy`): an agent access write locks
`workflow_artifacts (project_id, id) FOR UPDATE` first.
"""

from typing import List, Literal, Optional
from uuid import UUID

from sqlalchemy import and_, exists, select, text
from sqlalchemy.orm import aliased

from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactQuery,
    Revision,
    RevisionGrouping,
    RevisionQuery,
    Variant,
    VariantQuery,
)
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.sharing.dtos import AccessPolicy, AgentReadScope, Visibility
from oss.src.core.sharing.types import AgentCreationFailed
from oss.src.core.workflows.dtos import WorkflowArtifact
from oss.src.core.workflows.interfaces import WorkflowsDAOInterface
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.sharing.dbes import AgentAccessDBE
from oss.src.dbs.postgres.git.mappings import map_dbe_to_dto
from oss.src.dbs.postgres.sharing.mappings import (
    map_agent_access_dto_to_dbe,
    map_joined_agent_access_to_dto,
)
from oss.src.utils.exceptions import suppress_exceptions
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

# The agent rule of the backfill and of `ensure_first_agent_access`: an artifact is an
# agent when one of its revisions carries `flags.is_agent`.
_IS_AGENT_ARTIFACT_SQL = """
SELECT EXISTS (
    SELECT 1
    FROM workflow_artifacts a
    JOIN workflow_revisions r
      ON r.project_id = a.project_id AND r.artifact_id = a.id
    WHERE a.project_id = :project_id
      AND a.id = :artifact_id
      AND r.flags @> '{"is_agent": true}'::jsonb
)
"""


class WorkflowsDAO(GitDAO, WorkflowsDAOInterface):
    """The constructor is `GitDAO`'s."""

    # -- agent read scope ---------------------------------------------------------------

    def _agent_read_filter(
        self,
        *,
        project_id: UUID,
        artifact_id_column,
        read_scope: AgentReadScope,
    ):
        """Technical design 4.3: hide every private agent whose owner is not the
        scope's owner. A `NOT EXISTS` on the `agent_access` primary key, inside the
        query's own statement."""

        return ~exists().where(
            AgentAccessDBE.project_id == project_id,
            AgentAccessDBE.artifact_id == artifact_id_column,
            AgentAccessDBE.visibility == Visibility.PRIVATE.value,
            AgentAccessDBE.owner_user_id.is_distinct_from(read_scope.owner_user_id),
        )

    @suppress_exceptions(default=[])
    async def query_artifacts(
        self,
        *,
        project_id: UUID,
        #
        artifact_query: ArtifactQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[WorkflowArtifact]:
        stmt = self._artifacts_statement(
            project_id=project_id,
            artifact_query=artifact_query,
            artifact_refs=artifact_refs,
            include_archived=include_archived,
            windowing=windowing,
            scope_filters=(
                self._agent_read_filter(
                    project_id=project_id,
                    artifact_id_column=self.ArtifactDBE.id,
                    read_scope=read_scope,
                ),
            ),
        )
        # The access policy rides in the same statement: a LEFT JOIN on the
        # `agent_access` primary key (no added statement, WQ stays 1). An alias, so
        # the scope's NOT EXISTS keeps its own `agent_access` (no auto-correlation).
        access = aliased(AgentAccessDBE)
        stmt = stmt.outerjoin(
            access,
            and_(
                access.project_id == self.ArtifactDBE.project_id,
                access.artifact_id == self.ArtifactDBE.id,
            ),
        ).add_columns(access.visibility, access.owner_user_id)

        async with self.engine.session() as session:
            rows = (await session.execute(stmt)).all()

        return [
            map_dbe_to_dto(DTO=WorkflowArtifact, dbe=artifact_dbe).model_copy(
                update={
                    "access": map_joined_agent_access_to_dto(
                        visibility=visibility, owner_user_id=owner_user_id
                    )
                }
            )
            for artifact_dbe, visibility, owner_user_id in rows
        ]

    @suppress_exceptions(default=[])
    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        variant_query: VariantQuery,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Variant]:
        return await self._query_variants(
            project_id=project_id,
            variant_query=variant_query,
            artifact_refs=artifact_refs,
            variant_refs=variant_refs,
            include_archived=include_archived,
            windowing=windowing,
            scope_filters=(
                self._agent_read_filter(
                    project_id=project_id,
                    artifact_id_column=self.VariantDBE.artifact_id,
                    read_scope=read_scope,
                ),
            ),
        )

    @suppress_exceptions(default=[])
    async def query_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        grouping: Optional[RevisionGrouping] = None,
        #
        artifact_refs: Optional[List[Reference]] = None,
        variant_refs: Optional[List[Reference]] = None,
        revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Revision]:
        return await self._query_revisions(
            project_id=project_id,
            revision_query=revision_query,
            grouping=grouping,
            artifact_refs=artifact_refs,
            variant_refs=variant_refs,
            revision_refs=revision_refs,
            include_archived=include_archived,
            windowing=windowing,
            scope_filters=(
                self._agent_read_filter(
                    project_id=project_id,
                    artifact_id_column=self.RevisionDBE.artifact_id,
                    read_scope=read_scope,
                ),
            ),
        )

    async def query_head_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_query: RevisionQuery,
        #
        artifact_search: Optional[str] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
        #
        read_scope: AgentReadScope,
    ) -> List[Revision]:
        return await self._query_head_revisions(
            project_id=project_id,
            revision_query=revision_query,
            artifact_search=artifact_search,
            include_archived=include_archived,
            windowing=windowing,
            scope_filters=(
                self._agent_read_filter(
                    project_id=project_id,
                    artifact_id_column=self.RevisionDBE.artifact_id,
                    read_scope=read_scope,
                ),
            ),
        )

    # -- reference resolution -----------------------------------------------------------

    async def fetch_agent_artifact_id(
        self,
        *,
        project_id: UUID,
        level: Literal["artifact", "variant", "revision"],
        reference: Reference,
    ) -> Optional[UUID]:
        if not reference.id and not reference.slug:
            return None

        artifacts = self.ArtifactDBE
        if level == "artifact":
            row_dbe = artifacts
            stmt = select(artifacts.id)  # type: ignore
        else:
            row_dbe = self.VariantDBE if level == "variant" else self.RevisionDBE
            stmt = select(row_dbe.artifact_id).join(  # type: ignore
                artifacts,
                (artifacts.project_id == row_dbe.project_id)  # type: ignore
                & (artifacts.id == row_dbe.artifact_id),  # type: ignore
            )
            stmt = stmt.filter(row_dbe.deleted_at.is_(None))  # type: ignore
            if level == "revision":
                # An archived variant archives its revisions too.
                variants = self.VariantDBE
                stmt = stmt.join(
                    variants,
                    (variants.project_id == row_dbe.project_id)  # type: ignore
                    & (variants.id == row_dbe.variant_id),  # type: ignore
                ).filter(variants.deleted_at.is_(None))  # type: ignore

        stmt = stmt.filter(
            row_dbe.project_id == project_id,  # type: ignore
            artifacts.deleted_at.is_(None),  # type: ignore
        )
        if reference.id:
            stmt = stmt.filter(row_dbe.id == reference.id)  # type: ignore
        else:
            stmt = stmt.filter(row_dbe.slug == reference.slug)  # type: ignore

        async with self.engine.session() as session:
            return (await session.execute(stmt.limit(1))).scalar()

    async def is_agent_artifact(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            return bool(
                (
                    await session.execute(
                        text(_IS_AGENT_ARTIFACT_SQL),
                        {"project_id": project_id, "artifact_id": artifact_id},
                    )
                ).scalar()
            )

    # -- agent access writes ------------------------------------------------------------

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
