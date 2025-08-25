from typing import Optional, List
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.git.interfaces import GitDAOInterface
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.git.dtos import (
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    #
    VariantCreate,
    VariantEdit,
    VariantQuery,
    VariantFork,
    #
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)
from oss.src.core.testsets.dtos import (
    Testset,
    TestsetCreate,
    TestsetEdit,
    TestsetQuery,
    #
    TestsetVariant,
    TestsetVariantCreate,
    TestsetVariantEdit,
    TestsetVariantQuery,
    #
    TestsetRevision,
    TestsetRevisionCreate,
    TestsetRevisionEdit,
    TestsetRevisionQuery,
    TestsetRevisionCommit,
)

log = get_module_logger(__name__)


class TestsetsService:
    def __init__(
        self,
        *,
        testsets_dao: GitDAOInterface,
        testcases_service: TestcasesService,
    ):
        self.testsets_dao = testsets_dao
        self.testcases_service = testcases_service

    ## -- testset --------------------------------------------------------------

    async def create_testset(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_create: TestsetCreate,
        #
        testset_id: Optional[UUID] = None,
    ) -> Optional[Testset]:
        _artifact_create = ArtifactCreate(
            **testset_create.model_dump(mode="json"),
        )

        artifact = await self.testsets_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=_artifact_create,
            #
            artifact_id=testset_id,
        )

        if not artifact:
            return None

        _testset = Testset(
            **artifact.model_dump(mode="json"),
        )

        return _testset

    async def fetch_testset(
        self,
        *,
        project_id: UUID,
        #
        testset_ref: Reference,
    ) -> Optional[Testset]:
        artifact = await self.testsets_dao.fetch_artifact(
            project_id=project_id,
            #
            artifact_ref=testset_ref,
        )

        if not artifact:
            return None

        _testset = Testset(
            **artifact.model_dump(mode="json"),
        )

        return _testset

    async def edit_testset(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_edit: TestsetEdit,
    ) -> Optional[Testset]:
        _artifact_edit = ArtifactEdit(
            **testset_edit.model_dump(mode="json"),
        )

        artifact = await self.testsets_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=_artifact_edit,
        )

        if not artifact:
            return None

        _testset = Testset(
            **artifact.model_dump(mode="json"),
        )

        return _testset

    async def archive_testset(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_id: UUID,
    ) -> Optional[Testset]:
        artifact = await self.testsets_dao.archive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=testset_id,
        )

        if not artifact:
            return None

        _testset = Testset(
            **artifact.model_dump(mode="json"),
        )

        return _testset

    async def unarchive_testset(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_id: UUID,
    ) -> Optional[Testset]:
        artifact = await self.testsets_dao.unarchive_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_id=testset_id,
        )

        if not artifact:
            return None

        _testset = Testset(
            **artifact.model_dump(mode="json"),
        )

        return _testset

    async def query_testsets(
        self,
        *,
        project_id: UUID,
        #
        testset_query: TestsetQuery,
        #
        testset_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Testset]:
        _artifact_query = (
            ArtifactQuery(
                **testset_query.model_dump(mode="json"),
            )
            if testset_query
            else ArtifactQuery()
        )

        artifacts = await self.testsets_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=_artifact_query,
            #
            artifact_refs=testset_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _testsets = [
            Testset(
                **artifact.model_dump(mode="json"),
            )
            for artifact in artifacts
        ]

        return _testsets

    ## -------------------------------------------------------------------------

    ## -- variants -------------------------------------------------------------

    async def create_testset_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_variant_create: TestsetVariantCreate,
    ) -> Optional[TestsetVariant]:
        _variant_create = VariantCreate(
            **testset_variant_create.model_dump(mode="json"),
        )

        variant = await self.testsets_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=_variant_create,
        )

        if not variant:
            return None

        _testset_variant = TestsetVariant(
            **variant.model_dump(mode="json"),
        )

        return _testset_variant

    async def fetch_testset_variant(
        self,
        *,
        project_id: UUID,
        #
        testset_ref: Optional[Reference] = None,
        testset_variant_ref: Optional[Reference] = None,
    ) -> Optional[TestsetVariant]:
        variant = await self.testsets_dao.fetch_variant(
            project_id=project_id,
            #
            artifact_ref=testset_ref,
            variant_ref=testset_variant_ref,
        )

        if not variant:
            return None

        _testset_variant = TestsetVariant(
            **variant.model_dump(mode="json"),
        )

        return _testset_variant

    async def edit_testset_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_variant_edit: TestsetVariantEdit,
    ) -> Optional[TestsetVariant]:
        _variant_edit = VariantEdit(
            **testset_variant_edit.model_dump(mode="json"),
        )

        variant = await self.testsets_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=_variant_edit,
        )

        if not variant:
            return None

        _testset_variant = TestsetVariant(
            **variant.model_dump(mode="json"),
        )

        return _testset_variant

    async def archive_testset_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_variant_id: UUID,
    ) -> Optional[TestsetVariant]:
        variant = await self.testsets_dao.archive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=testset_variant_id,
        )

        if not variant:
            return None

        _testset_variant = TestsetVariant(
            **variant.model_dump(mode="json"),
        )

        return _testset_variant

    async def unarchive_testset_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_variant_id: UUID,
    ) -> Optional[TestsetVariant]:
        variant = await self.testsets_dao.unarchive_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_id=testset_variant_id,
        )

        if not variant:
            return None

        _testset_variant = TestsetVariant(
            **variant.model_dump(mode="json"),
        )

        return _testset_variant

    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        testset_variant_query: TestsetVariantQuery,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TestsetVariant]:
        _testset_variant_query = VariantQuery(
            **testset_variant_query.model_dump(mode="json"),
        )

        variants = await self.testsets_dao.query_variants(
            project_id=project_id,
            #
            variant_query=_testset_variant_query,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        _testset_variants = [
            TestsetVariant(
                **variant.model_dump(mode="json"),
            )
            for variant in variants
        ]

        return _testset_variants

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    async def create_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_create: TestsetRevisionCreate,
    ) -> Optional[TestsetRevision]:
        _revision_create = RevisionCreate(
            **testset_revision_create.model_dump(mode="json"),
        )

        revision = await self.testsets_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=_revision_create,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        if _testset_revision.data and _testset_revision.data.testcase_ids:
            _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                project_id=project_id,
                #
                testcase_ids=_testset_revision.data.testcase_ids,
            )

        return _testset_revision

    async def fetch_testset_revision(
        self,
        *,
        project_id: UUID,
        #
        testset_ref: Optional[Reference] = None,
        testset_variant_ref: Optional[Reference] = None,
        testset_revision_ref: Optional[Reference] = None,
    ) -> Optional[TestsetRevision]:
        revision = await self.testsets_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=testset_variant_ref,
            revision_ref=testset_revision_ref,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        if _testset_revision.data and _testset_revision.data.testcase_ids:
            _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                project_id=project_id,
                #
                testcase_ids=_testset_revision.data.testcase_ids,
            )

        return _testset_revision

    async def edit_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_edit: TestsetRevisionEdit,
    ) -> Optional[TestsetRevision]:
        _revision_edit = TestsetRevisionEdit(
            **testset_revision_edit.model_dump(mode="json"),
        )

        revision = await self.testsets_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=_revision_edit,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        if _testset_revision.data and _testset_revision.data.testcase_ids:
            _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                project_id=project_id,
                #
                testcase_ids=_testset_revision.data.testcase_ids,
            )

        return _testset_revision

    async def archive_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_id: UUID,
    ) -> Optional[TestsetRevision]:
        revision = await self.testsets_dao.archive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=testset_revision_id,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        return _testset_revision

    async def unarchive_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_id: UUID,
    ) -> Optional[TestsetRevision]:
        revision = await self.testsets_dao.unarchive_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_id=testset_revision_id,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        return _testset_revision

    async def query_testset_revisions(
        self,
        *,
        project_id: UUID,
        #
        testset_revision_query: TestsetRevisionQuery,
    ) -> List[TestsetRevision]:
        _revision_query = RevisionQuery(
            **testset_revision_query.model_dump(mode="json"),
        )

        revisions = await self.testsets_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=_revision_query,
        )

        if not revisions:
            return []

        _testset_revisions = []

        for revision in revisions:
            _testset_revision = TestsetRevision(
                **revision.model_dump(mode="json"),
            )

            if _testset_revision.data and _testset_revision.data.testcase_ids:
                _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                    project_id=project_id,
                    #
                    testcase_ids=_testset_revision.data.testcase_ids,
                )

            _testset_revisions.append(_testset_revision)

        return _testset_revisions

    ## .........................................................................

    async def commit_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_commit: TestsetRevisionCommit,
    ) -> Optional[TestsetRevision]:
        if testset_revision_commit.data and testset_revision_commit.data.testcases:
            if testset_revision_commit.data.testcases:
                for testcase in testset_revision_commit.data.testcases:
                    testcase.set_id = testset_revision_commit.testset_id

            testcases = await self.testcases_service.add_testcases(
                project_id=project_id,
                user_id=user_id,
                #
                testcases=testset_revision_commit.data.testcases,
            )

            testset_revision_commit.data.testcase_ids = [
                testcase.id for testcase in testcases
            ]

            testset_revision_commit.data.testcases = None

        _revision_commit = RevisionCommit(
            **testset_revision_commit.model_dump(mode="json", exclude_none=True),
        )

        revision = await self.testsets_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=_revision_commit,
        )

        if not revision:
            return None

        _testset_revision = TestsetRevision(
            **revision.model_dump(mode="json"),
        )

        if _testset_revision.data and _testset_revision.data.testcase_ids:
            _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                project_id=project_id,
                #
                testcase_ids=_testset_revision.data.testcase_ids,
            )

        return _testset_revision

    async def log_testset_revisions(
        self,
        *,
        project_id: UUID,
        #
        testset_variant_ref: Optional[Reference] = None,
        testset_revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ) -> List[TestsetRevision]:
        revisions = await self.testsets_dao.log_revisions(
            project_id=project_id,
            #
            variant_ref=testset_variant_ref,
            revision_ref=testset_revision_ref,
            depth=depth,
        )

        if not revisions:
            return []

        _testset_revisions = []

        for revision in revisions:
            _testset_revision = TestsetRevision(
                **revision.model_dump(mode="json"),
            )

            if _testset_revision.data and _testset_revision.data.testcase_ids:
                _testset_revision.data.testcases = await self.testcases_service.fetch_testcases(
                    project_id=project_id,
                    #
                    testcase_ids=_testset_revision.data.testcase_ids,
                )

            _testset_revisions.append(_testset_revision)

        return _testset_revisions

    ## -------------------------------------------------------------------------
