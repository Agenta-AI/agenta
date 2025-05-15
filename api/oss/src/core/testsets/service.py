from typing import Optional, List
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.blobs.interfaces import BlobDAOInterface
from oss.src.core.shared.dtos import Reference, Tags, Data
from oss.src.core.blobs.dtos import Blob
from oss.src.core.testsets.dtos import (
    TestsetData,
    TestsetFlags,
    TestsetArtifact,
    TestsetVariant,
    TestsetRevision,
)

log = get_module_logger(__name__)


class TestsetsService:
    def __init__(
        self,
        *,
        git_dao: GitDAOInterface,
        blobs_dao: BlobDAOInterface,
    ):
        self.git_dao = git_dao
        self.blobs_dao = blobs_dao

    ## -- artifacts ------------------------------------------------------------

    async def create_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_slug: str,
        #
        artifact_flags: Optional[TestsetFlags] = None,
        artifact_metadata: Optional[Tags] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[TestsetArtifact]:
        artifact = await self.git_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_slug=artifact_slug,
            #
            artifact_flags=(artifact_flags.model_dump() if artifact_flags else None),
            artifact_metadata=artifact_metadata,
            artifact_name=artifact_name,
            artifact_description=artifact_description,
        )

        if not artifact:
            return None

        artifact = TestsetArtifact(**artifact.model_dump())

        return artifact

    async def fetch_artifact(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Reference,
    ) -> Optional[TestsetArtifact]:
        artifact = await self.git_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=artifact_ref,
        )

        if not artifact:
            return None

        artifact = TestsetArtifact(**artifact.model_dump())

        return artifact

    async def edit_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
        #
        artifact_flags: Optional[TestsetFlags] = None,
        artifact_metadata: Optional[Tags] = None,
        artifact_name: Optional[str] = None,
        artifact_description: Optional[str] = None,
    ) -> Optional[TestsetArtifact]:
        artifact = await self.git_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
            #
            artifact_flags=(artifact_flags.model_dump() if artifact_flags else None),
            artifact_metadata=artifact_metadata,
            artifact_name=artifact_name,
            artifact_description=artifact_description,
        )

        if not artifact:
            return None

        artifact = TestsetArtifact(**artifact.model_dump())

        return artifact

    async def archive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[TestsetArtifact]:
        artifact = await self.git_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
        )

        if not artifact:
            return None

        artifact = TestsetArtifact(**artifact.model_dump())

        return artifact

    async def unarchive_artifact(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        artifact_id: UUID,
    ) -> Optional[TestsetArtifact]:
        artifact = await self.git_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
        )

        if not artifact:
            return None

        artifact = TestsetArtifact(**artifact.model_dump())

        return artifact

    async def query_artifacts(
        self,
        *,
        project_id: UUID,
        #
        artifact_flags: Optional[TestsetFlags] = None,
        artifact_metadata: Optional[Tags] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[TestsetArtifact]:
        artifacts = await self.git_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_flags=(artifact_flags.model_dump() if artifact_flags else None),
            artifact_metadata=artifact_metadata,
            #
            include_archived=include_archived,
        )

        artifacts = [TestsetArtifact(**artifact.model_dump()) for artifact in artifacts]

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
        variant_flags: Optional[TestsetFlags] = None,
        variant_metadata: Optional[Tags] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=artifact_id,
            #
            variant_slug=variant_slug,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_metadata=variant_metadata,
            variant_name=variant_name,
            variant_description=variant_description,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    async def fetch_variant(
        self,
        *,
        project_id: UUID,
        #
        artifact_ref: Optional[Reference] = None,
        variant_ref: Optional[Reference] = None,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=artifact_ref,
            variant_ref=variant_ref,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    async def edit_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
        #
        variant_flags: Optional[TestsetFlags] = None,
        variant_metadata: Optional[Tags] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_metadata=variant_metadata,
            variant_name=variant_name,
            variant_description=variant_description,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    async def archive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    async def unarchive_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        variant_flags: Optional[TestsetFlags] = None,
        variant_metadata: Optional[Tags] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[TestsetVariant]:
        variants = await self.git_dao.query_variants(
            project_id=project_id,
            #
            variant_flags=(variant_flags.model_dump() if variant_flags else None),
            variant_metadata=variant_metadata,
            #
            include_archived=include_archived,
        )

        variants = [TestsetVariant(**variant.model_dump()) for variant in variants]

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
        variant_flags: Optional[TestsetFlags] = None,
        variant_metadata: Optional[Tags] = None,
        variant_name: Optional[str] = None,
        variant_description: Optional[str] = None,
        #
        revision_flags: Optional[TestsetFlags] = None,
        revision_metadata: Optional[Tags] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
    ) -> Optional[TestsetVariant]:
        variant = await self.git_dao.fork_variant(
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
            variant_metadata=variant_metadata,
            variant_name=variant_name,
            variant_description=variant_description,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_metadata=revision_metadata,
            revision_name=revision_name,
            revision_description=revision_description,
            revision_message=revision_message,
        )

        if not variant:
            return None

        variant = TestsetVariant(**variant.model_dump())

        return variant

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    async def create_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        variant_id: UUID,
        #
        revision_slug: str,
        #
        revision_flags: Optional[TestsetFlags] = None,
        revision_metadata: Optional[Tags] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[TestsetRevision]:
        revision = await self.git_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=variant_id,
            #
            revision_slug=revision_slug,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_metadata=revision_metadata,
            revision_name=revision_name if revision_name else revision_slug,
            revision_description=revision_description,
        )

        if not revision:
            return None

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def fetch_revision(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
    ) -> Optional[TestsetRevision]:
        revision = await self.git_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
        )

        if not revision:
            return None

        if revision.data:
            testcase_ids = revision.data.get("testcase_ids")

            testcases = await self.load_testcases(
                project_id=project_id,
                #
                testcase_ids=testcase_ids,
            )

            revision.data = TestsetData(
                testcases=testcases,
            )

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def edit_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
        #
        revision_flags: Optional[TestsetFlags] = None,
        revision_metadata: Optional[Tags] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
    ) -> Optional[TestsetRevision]:
        revision = await self.git_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_metadata=revision_metadata,
            revision_name=revision_name,
            revision_description=revision_description,
        )

        if not revision:
            return None

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def archive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[TestsetRevision]:
        revision = await self.git_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
        )

        if not revision:
            return None

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def unarchive_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        revision_id: UUID,
    ) -> Optional[TestsetRevision]:
        revision = await self.git_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=revision_id,
        )

        if not revision:
            return None

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def query_revisions(
        self,
        *,
        project_id: UUID,
        #
        revision_flags: Optional[TestsetFlags] = None,
        revision_metadata: Optional[Tags] = None,
        #
        include_archived: Optional[bool] = None,
    ) -> List[TestsetRevision]:
        revisions = await self.git_dao.query_revisions(
            project_id=project_id,
            #
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_metadata=revision_metadata,
            #
            include_archived=include_archived,
        )

        revisions = [TestsetRevision(**revision.model_dump()) for revision in revisions]

        for revision in revisions:
            if revision.data:
                testcase_ids = revision.data.get("testcase_ids")

                testcases = await self.load_testcases(
                    project_id=project_id,
                    #
                    testcase_ids=testcase_ids,
                )
                revision.data = TestsetData(
                    testcases=testcases,
                )

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
        revision_flags: Optional[TestsetFlags] = None,
        revision_metadata: Optional[Tags] = None,
        revision_name: Optional[str] = None,
        revision_description: Optional[str] = None,
        revision_message: Optional[str] = None,
        revision_data: Optional[TestsetData] = None,
    ) -> Optional[TestsetRevision]:
        variant = await self.git_dao.fetch_variant(
            project_id=project_id,
            #
            variant_ref=Reference(id=variant_id),
        )

        if not variant:
            return None

        testset_data = None

        if revision_data and revision_data.testcases:
            testcases = revision_data.testcases

            testcase_ids = await self.save_testcases(
                project_id=project_id,
                #
                testset_id=variant.artifact_id,
                #
                testcases=testcases,
            )

            testset_data = TestsetData(
                testcase_ids=testcase_ids,
            )

        revision = await self.git_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=variant.artifact_id,
            variant_id=variant_id,
            #
            revision_slug=revision_slug,
            #
            revision_flags=(revision_flags.model_dump() if revision_flags else None),
            revision_metadata=revision_metadata,
            revision_name=revision_name,
            revision_description=revision_description,
            revision_message=revision_message,
            revision_data=testset_data.model_dump() if testset_data else None,
        )

        if not revision:
            return None

        if revision.data:
            testcase_ids = revision.data.get("testcase_ids")

            testcases = await self.load_testcases(
                project_id=project_id,
                #
                testcase_ids=testcase_ids,
            )

            revision.data = TestsetData(
                testcases=testcases,
            )

        revision = TestsetRevision(**revision.model_dump())

        return revision

    async def log_revisions(
        self,
        *,
        project_id: UUID,
        #
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ) -> List[TestsetRevision]:
        revisions = await self.git_dao.log_revisions(
            project_id=project_id,
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
            depth=depth,
        )

        revisions = [TestsetRevision(**revision.model_dump()) for revision in revisions]

        for revision in revisions:
            if revision.data:
                testcase_ids = revision.data.get("testcase_ids")

                testcases = await self.load_testcases(
                    project_id=project_id,
                    #
                    testcase_ids=testcase_ids,
                )
                revision.data = TestsetData(
                    testcases=testcases,
                )

        return revisions

    ## -------------------------------------------------------------------------

    ## -- testcases ------------------------------------------------------------

    async def save_testcases(
        self,
        *,
        project_id: UUID,
        #
        testset_id: UUID,
        #
        testcases: List[Data],
    ) -> List[UUID]:
        blobs = [
            Blob(
                data=testcase,
                set_id=testset_id,
            )
            for testcase in testcases
        ]

        testcase_blobs = await self.blobs_dao.add_blobs(
            project_id=project_id,
            #
            blobs=blobs,
        )

        if not testcase_blobs:
            return []

        testcase_ids = [testcase_blob.id for testcase_blob in testcase_blobs]

        return testcase_ids

    async def load_testcases(
        self,
        *,
        project_id: UUID,
        #
        testcase_ids: List[UUID],
    ) -> List[Data]:
        testcase_blobs = await self.blobs_dao.fetch_blobs(
            project_id=project_id,
            #
            blob_ids=testcase_ids,
        )

        if not testcase_blobs:
            return []

        testcases = [
            {
                "testcase_id": str(testcase_blob.id),
                **testcase_blob.data,
            }
            for testcase_blob in testcase_blobs
        ]

        return testcases

    ## -------------------------------------------------------------------------
