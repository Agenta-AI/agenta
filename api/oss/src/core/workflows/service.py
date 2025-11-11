from typing import Optional, List
from uuid import UUID


from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.shared.dtos import Reference, Meta
from oss.src.core.workflows.dtos import (
    WorkflowData,
    WorkflowFlags,
    WorkflowArtifact,
    WorkflowVariant,
    WorkflowRevision,
)


class WorkflowsService:
    def __init__(
        self,
        *,
        workflows_dao: GitDAOInterface,
    ):
        self.workflows_dao = workflows_dao

    ## -- artifacts ------------------------------------------------------------

    async def create_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_slug: str,
        #
        artifact_flags: Optional[WorkflowFlags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[WorkflowArtifact]:
        artifact = await self.workflows_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_slug=artifact_slug,
            #
            artifact_flags=(artifact_flags.model_dump() if artifact_flags else None),
            artifact_meta=artifact_meta,
            artifact_name=artifact_name or artifact_slug,
            artifact_description=artifact_description,
        )

        if not artifact:
            return None

        artifact = WorkflowArtifact(**artifact.model_dump())

        return artifact

    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Reference,
    ) -> Optional[WorkflowArtifact]:
        artifact = await self.workflows_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=artifact_ref,
        )

        if not artifact:
            return None

        artifact = WorkflowArtifact(**artifact.model_dump())

        return artifact

    async def edit_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        #
        artifact_flags: Optional[WorkflowFlags] = None,
        artifact_meta: Optional[Meta] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[WorkflowArtifact]:
        artifact = await self.workflows_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
            #
            artifact_flags=(artifact_flags.model_dump() if artifact_flags else None),
            artifact_meta=artifact_meta,
            artifact_name=artifact_name,
            artifact_description=artifact_description,
        )

        if not artifact:
            return None

        artifact = WorkflowArtifact(**artifact.model_dump())

        return artifact

    async def archive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[WorkflowArtifact]:
        artifact = await self.workflows_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
        )

        if not artifact:
            return None

        artifact = WorkflowArtifact(**artifact.model_dump())

        return artifact

    async def unarchive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[WorkflowArtifact]:
        artifact = await self.workflows_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
        )

        if not artifact:
            return None

        artifact = WorkflowArtifact(**artifact.model_dump())

        return artifact

    async def query_artifacts(
        self,
        *,
        project_id: UUID,
        #
        artifact_flags: Optional[WorkflowFlags] = None,
        artifact_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[WorkflowArtifact]:
        artifacts = await self.workflows_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_flags=(
                artifact_flags.model_dump(exclude_none=True) if artifact_flags else None
            ),
            artifact_meta=artifact_meta,
            #
            include_archived=include_archived,
        )

        artifacts = [
            WorkflowArtifact(**artifact.model_dump()) for artifact in artifacts
        ]

        return artifacts

    ## -------------------------------------------------------------------------

    ## -- variants -------------------------------------------------------------

    async def create_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        #
        variant_slug: str,
        #
        variant_flags: Optional[WorkflowFlags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
            #
            variant_slug=variant_slug,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_meta=variant_meta,
            variant_name=variant_name or variant_slug,
            variant_description=variant_description,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    async def fetch_variant(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
        variant_ref: Optional[Reference] = None,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=artifact_ref,
            variant_ref=variant_ref,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    async def edit_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
        #
        variant_flags: Optional[WorkflowFlags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_meta=variant_meta,
            variant_name=variant_name,
            variant_description=variant_description,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    async def archive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    async def unarchive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        variant_flags: Optional[WorkflowFlags] = None,
        variant_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[WorkflowVariant]:
        variants = await self.workflows_dao.query_variants(
            project_id=project_id,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_meta=variant_meta,
            #
            include_archived=include_archived,
        )

        variants = [WorkflowVariant(**variant.model_dump()) for variant in variants]

        return variants

    ## .........................................................................

    async def fork_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_slug: str,
        revision_slug: str,
        #
        variant_id: Optional[UUID] = None,
        revision_id: Optional[UUID] = None,
        depth: Optional[int] = None,
        #
        variant_flags: Optional[WorkflowFlags] = None,
        variant_meta: Optional[Meta] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
        #
        revision_flags: Optional[WorkflowFlags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
    ) -> Optional[WorkflowVariant]:
        variant = await self.workflows_dao.fork_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_slug=variant_slug,
            revision_slug=revision_slug,
            #
            variant_id=variant_id,
            revision_id=revision_id,
            depth=depth,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_meta=variant_meta,
            variant_name=variant_name or variant_slug,
            variant_description=variant_description,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_meta=revision_meta,
            revision_name=revision_name or revision_slug,
            revision_description=revision_description,
            revision_message=revision_message,
        )

        if not variant:
            return None

        variant = WorkflowVariant(**variant.model_dump())

        return variant

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    async def create_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[WorkflowFlags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
            variant_id=variant_id,
            #
            revision_slug=revision_slug,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_meta=revision_meta,
            revision_name=revision_name or revision_slug,
            revision_description=revision_description,
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def fetch_revision(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
        #
        revision_flags: Optional[WorkflowFlags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_meta=revision_meta,
            revision_name=revision_name,
            revision_description=revision_description,
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def archive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def unarchive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[WorkflowRevision]:
        revision = await self.workflows_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def query_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_flags: Optional[WorkflowFlags] = None,
        revision_meta: Optional[Meta] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[WorkflowRevision]:
        revisions = await self.workflows_dao.query_revisions(
            project_id=project_id,
            #
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_meta=revision_meta,
            #
            include_archived=include_archived,
        )

        revisions = [
            WorkflowRevision(**revision.model_dump()) for revision in revisions
        ]

        return revisions

    ## .........................................................................

    async def commit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        # artifact_id: UUID,
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[WorkflowFlags] = None,
        revision_meta: Optional[Meta] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
        revision_data: Optional[WorkflowData] = None,
    ) -> Optional[WorkflowRevision]:
        variant = await self.workflows_dao.fetch_variant(
            project_id=project_id,
            #
            variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        revision = await self.workflows_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=variant.artifact_id,
            variant_id=variant_id,
            #
            revision_slug=revision_slug,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_meta=revision_meta,
            revision_name=revision_name or revision_slug,
            revision_description=revision_description,
            revision_message=revision_message,
            revision_data=(revision_data.model_dump() if revision_data else None),
        )

        if not revision:
            return None

        revision = WorkflowRevision(**revision.model_dump())

        return revision

    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ) -> List[WorkflowRevision]:
        revisions = await self.workflows_dao.log_revisions(
            project_id=project_id,
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
            depth=depth,
        )

        revisions = [
            WorkflowRevision(**revision.model_dump()) for revision in revisions
        ]

        return revisions

    ## -------------------------------------------------------------------------
