from typing import Dict, Optional, List, Any
from uuid import UUID, uuid4

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
    RevisionCreate,
    RevisionQuery,
    RevisionCommit,
)
from oss.src.models.db_models import TestsetDB
from oss.src.core.testcases.dtos import Testcase
from oss.src.services.db_manager import fetch_testset_by_id
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.apis.fastapi.testsets.models import (
    SimpleTestset,
    SimpleTestsetCreate,
    SimpleTestsetEdit,
    #
    SimpleTestsetCreateRequest,
    SimpleTestsetEditRequest,
)
from oss.src.core.testsets.dtos import (
    Testset,
    TestsetCreate,
    TestsetEdit,
    TestsetQuery,
    TestsetRevisionsLog,
    #
    TestsetVariant,
    TestsetVariantCreate,
    TestsetVariantEdit,
    TestsetVariantQuery,
    #
    TestsetRevision,
    TestsetRevisionData,
    TestsetRevisionCreate,
    TestsetRevisionEdit,
    TestsetRevisionQuery,
    TestsetRevisionCommit,
)
from oss.src.apis.fastapi.testsets.utils import (
    json_array_to_json_object,
    validate_testset_limits,
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

    async def _populate_testcases(
        self,
        project_id: UUID,
        #
        testset_revision: TestsetRevision,
        #
        include_testcases: Optional[bool] = None,
    ) -> None:
        """Conditionally populate testcases in revision data.

        Args:
            testset_revision: The testset revision to populate
            project_id: Project ID for fetching testcases
            include_testcases: If None or True, fetch and include testcases.
                              If False, leave testcases as None (only testcase_ids).
        """
        if not testset_revision.data:
            return

        # Default to True if None (backward compatible)
        if include_testcases is None or include_testcases:
            # Include full testcases, exclude testcase_ids
            if testset_revision.data.testcase_ids:
                testset_revision.data.testcases = (
                    await self.testcases_service.fetch_testcases(
                        project_id=project_id,
                        testcase_ids=testset_revision.data.testcase_ids,
                    )
                )
                # Clear testcase_ids when including full testcases
                testset_revision.data.testcase_ids = None

                # Clear alias fields from testcases for clean API responses
                if testset_revision.data.testcases:
                    for testcase in testset_revision.data.testcases:
                        testcase.set_id = None
        else:
            # Include only testcase_ids, exclude full testcases
            testset_revision.data.testcases = None

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
        artifact_create = ArtifactCreate(
            **testset_create.model_dump(
                mode="json",
            ),
        )

        artifact = await self.testsets_dao.create_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_create=artifact_create,
            #
            artifact_id=testset_id,
        )

        if not artifact:
            return None

        testset = Testset(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return testset

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

        testset = Testset(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return testset

    async def edit_testset(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_edit: TestsetEdit,
    ) -> Optional[Testset]:
        artifact_edit = ArtifactEdit(
            **testset_edit.model_dump(
                mode="json",
            ),
        )

        artifact = await self.testsets_dao.edit_artifact(
            project_id=project_id,
            user_id=user_id,
            #
            artifact_edit=artifact_edit,
        )

        if not artifact:
            return None

        testset = Testset(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return testset

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

        testset = Testset(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return testset

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

        testset = Testset(
            **artifact.model_dump(
                mode="json",
            ),
        )

        return testset

    async def query_testsets(
        self,
        *,
        project_id: UUID,
        #
        testset_query: Optional[TestsetQuery] = None,
        #
        testset_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Testset]:
        artifact_query = (
            ArtifactQuery(
                **testset_query.model_dump(
                    mode="json",
                ),
            )
            if testset_query
            else ArtifactQuery()
        )

        artifacts = await self.testsets_dao.query_artifacts(
            project_id=project_id,
            #
            artifact_query=artifact_query,
            #
            artifact_refs=testset_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        testsets = [
            Testset(
                **artifact.model_dump(
                    mode="json",
                ),
            )
            for artifact in artifacts
        ]

        return testsets

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
        variant_create = VariantCreate(
            **testset_variant_create.model_dump(
                mode="json",
            ),
        )

        variant = await self.testsets_dao.create_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_create=variant_create,
        )

        if not variant:
            return None

        testset_variant = TestsetVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return testset_variant

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

        testset_variant = TestsetVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return testset_variant

    async def edit_testset_variant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_variant_edit: TestsetVariantEdit,
    ) -> Optional[TestsetVariant]:
        variant_edit = VariantEdit(
            **testset_variant_edit.model_dump(
                mode="json",
            ),
        )

        variant = await self.testsets_dao.edit_variant(
            project_id=project_id,
            user_id=user_id,
            #
            variant_edit=variant_edit,
        )

        if not variant:
            return None

        testset_variant = TestsetVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return testset_variant

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

        testset_variant = TestsetVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return testset_variant

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

        testset_variant = TestsetVariant(
            **variant.model_dump(
                mode="json",
            ),
        )

        return testset_variant

    async def query_variants(
        self,
        *,
        project_id: UUID,
        #
        testset_variant_query: Optional[TestsetVariantQuery] = None,
        #
        testset_refs: Optional[List[Reference]] = None,
        testset_variant_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TestsetVariant]:
        variant_query = (
            VariantQuery(
                **testset_variant_query.model_dump(
                    mode="json",
                ),
            )
            if testset_variant_query
            else VariantQuery()
        )

        variants = await self.testsets_dao.query_variants(
            project_id=project_id,
            #
            variant_query=variant_query,
            #
            artifact_refs=testset_refs,
            variant_refs=testset_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        testset_variants = [
            TestsetVariant(
                **variant.model_dump(
                    mode="json",
                ),
            )
            for variant in variants
        ]

        return testset_variants

    ## -------------------------------------------------------------------------

    ## -- revisions ------------------------------------------------------------

    async def create_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_create: TestsetRevisionCreate,
        #
        include_testcases: Optional[bool] = None,
    ) -> Optional[TestsetRevision]:
        revision_create = RevisionCreate(
            **testset_revision_create.model_dump(
                mode="json",
            ),
        )

        revision = await self.testsets_dao.create_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_create=revision_create,
        )

        if not revision:
            return None

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        await self._populate_testcases(
            project_id,
            testset_revision,
            include_testcases,
        )

        return testset_revision

    async def fetch_testset_revision(
        self,
        *,
        project_id: UUID,
        #
        testset_ref: Optional[Reference] = None,
        testset_variant_ref: Optional[Reference] = None,
        testset_revision_ref: Optional[Reference] = None,
        #
        include_testcases: Optional[bool] = None,
    ) -> Optional[TestsetRevision]:
        if not testset_ref and not testset_variant_ref and not testset_revision_ref:
            return None

        if testset_ref and not testset_variant_ref and not testset_revision_ref:
            testset = await self.fetch_testset(
                project_id=project_id,
                #
                testset_ref=testset_ref,
            )

            if not testset:
                return None

            testset_ref = Reference(
                id=testset.id,
                slug=testset.slug,
            )

            testset_variant = await self.fetch_testset_variant(
                project_id=project_id,
                #
                testset_ref=testset_ref,
            )

            if not testset_variant:
                return None

            testset_variant_ref = Reference(
                id=testset_variant.id,
                slug=testset_variant.slug,
            )

        revision = await self.testsets_dao.fetch_revision(
            project_id=project_id,
            #
            variant_ref=testset_variant_ref,
            revision_ref=testset_revision_ref,
        )

        if not revision:
            return None

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        await self._populate_testcases(
            project_id,
            testset_revision,
            include_testcases,
        )

        return testset_revision

    async def edit_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_edit: TestsetRevisionEdit,
        #
        include_testcases: Optional[bool] = None,
    ) -> Optional[TestsetRevision]:
        revision_edit = TestsetRevisionEdit(
            **testset_revision_edit.model_dump(
                mode="json",
            ),
        )

        revision = await self.testsets_dao.edit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_edit=revision_edit,
        )

        if not revision:
            return None

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        await self._populate_testcases(
            project_id,
            testset_revision,
            include_testcases,
        )

        return testset_revision

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

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return testset_revision

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

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        return testset_revision

    async def query_testset_revisions(
        self,
        *,
        project_id: UUID,
        #
        testset_revision_query: Optional[TestsetRevisionQuery] = None,
        #
        testset_refs: Optional[List[Reference]] = None,
        testset_variant_refs: Optional[List[Reference]] = None,
        testset_revision_refs: Optional[List[Reference]] = None,
        #
        include_archived: Optional[bool] = None,
        include_testcases: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TestsetRevision]:
        revision_query = (
            RevisionQuery(
                **testset_revision_query.model_dump(
                    mode="json",
                ),
            )
            if testset_revision_query
            else RevisionQuery()
        )

        revisions = await self.testsets_dao.query_revisions(
            project_id=project_id,
            #
            revision_query=revision_query,
            #
            artifact_refs=testset_refs,
            variant_refs=testset_variant_refs,
            revision_refs=testset_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

        if not revisions:
            return []

        testset_revisions = []

        for revision in revisions:
            testset_revision = TestsetRevision(
                **revision.model_dump(
                    mode="json",
                ),
            )

            await self._populate_testcases(
                project_id,
                testset_revision,
                include_testcases,
            )

            testset_revisions.append(testset_revision)

        return testset_revisions

    ## .........................................................................

    async def commit_testset_revision(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_commit: TestsetRevisionCommit,
        #
        include_testcases: Optional[bool] = None,
    ) -> Optional[TestsetRevision]:
        if testset_revision_commit.delta and not testset_revision_commit.data:
            return await self._commit_testset_revision_delta(
                project_id=project_id,
                user_id=user_id,
                testset_revision_commit=testset_revision_commit,
                include_testcases=include_testcases,
            )

        if testset_revision_commit.data and testset_revision_commit.data.testcases:
            if testset_revision_commit.data.testcases:
                for testcase in testset_revision_commit.data.testcases:
                    testcase.set_id = testset_revision_commit.testset_id

            testcases = await self.testcases_service.create_testcases(
                project_id=project_id,
                user_id=user_id,
                #
                testcases=testset_revision_commit.data.testcases,
            )

            testset_revision_commit.data.testcase_ids = [
                testcase.id for testcase in testcases
            ]

            testset_revision_commit.data.testcases = None

        revision_commit = RevisionCommit(
            **testset_revision_commit.model_dump(mode="json", exclude_none=True),
        )

        revision = await self.testsets_dao.commit_revision(
            project_id=project_id,
            user_id=user_id,
            #
            revision_commit=revision_commit,
        )

        if not revision:
            return None

        testset_revision = TestsetRevision(
            **revision.model_dump(
                mode="json",
            ),
        )

        await self._populate_testcases(
            project_id,
            testset_revision,
            include_testcases,
        )

        return testset_revision

    async def log_testset_revisions(
        self,
        *,
        project_id: UUID,
        #
        testset_revisions_log: TestsetRevisionsLog,
        #
        include_testcases: Optional[bool] = None,
        include_archived: bool = False,
    ) -> List[TestsetRevision]:
        revisions = await self.testsets_dao.log_revisions(
            project_id=project_id,
            #
            revisions_log=testset_revisions_log,
            #
            include_archived=include_archived,
        )

        if not revisions:
            return []

        testset_revisions = []

        for revision in revisions:
            testset_revision = TestsetRevision(
                **revision.model_dump(
                    mode="json",
                ),
            )

            await self._populate_testcases(
                project_id,
                testset_revision,
                include_testcases,
            )

            testset_revisions.append(testset_revision)

        return testset_revisions

    async def _commit_testset_revision_delta(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_revision_commit: TestsetRevisionCommit,
        #
        include_testcases: Optional[bool] = None,
    ) -> Optional[TestsetRevision]:
        """Apply delta operations to a base revision and commit as a new revision."""
        # Get the base revision to patch
        base_revision = await self.fetch_testset_revision(
            project_id=project_id,
            testset_ref=Reference(id=testset_revision_commit.testset_id),
            testset_revision_ref=(
                Reference(id=testset_revision_commit.revision_id)
                if testset_revision_commit.revision_id
                else None
            ),
        )

        if not base_revision:
            log.error(
                f"Base revision not found for testset {testset_revision_commit.testset_id}"
            )
            return None

        # Load all current testcases from the base revision, preserving order.
        current_testcases: List[Testcase] = []
        if base_revision.data and base_revision.data.testcases:
            current_testcases = list(base_revision.data.testcases)

        operations = testset_revision_commit.delta
        if not operations:
            # No operations, just return the base revision
            return base_revision

        # Apply column operations to ALL testcases first
        # This ensures column changes are applied even to testcases not in update list
        if operations.columns:
            replace_map = {}
            if operations.columns.replace:
                replace_map = {old: new for old, new in operations.columns.replace}
            remove_set = set(operations.columns.remove or [])
            for tc in current_testcases:
                if tc.data:
                    # Preserve column order for replace/remove.
                    updated_data: Dict[str, Any] = {}
                    for key, value in tc.data.items():
                        if key in remove_set:
                            continue
                        new_key = replace_map.get(key, key)
                        updated_data[new_key] = value
                    tc.data = updated_data

                    # Apply column additions (initialize to empty string)
                    if operations.columns.add:
                        for col_name in operations.columns.add:
                            if col_name not in tc.data:
                                tc.data[col_name] = ""

        # Build final testcases list, preserving base order.
        remove_set: set[UUID] = (
            set(operations.rows.remove or []) if operations.rows else set()
        )
        replace_map: Dict[UUID, Testcase] = {}
        if operations.rows and operations.rows.replace:
            replace_map = {
                tc.id: tc for tc in operations.rows.replace if tc.id is not None
            }

        # 1) Replace in place, 2) remove wherever it appears, 3) add at the end.
        final_testcases: List[Testcase] = []
        for tc in current_testcases:
            if not tc.id:
                continue
            updated_tc = replace_map.get(tc.id)
            if updated_tc is not None:
                candidate = Testcase(
                    id=None,
                    set_id=testset_revision_commit.testset_id,
                    data=updated_tc.data,
                )
            else:
                candidate = Testcase(
                    id=None,
                    set_id=testset_revision_commit.testset_id,
                    data=tc.data,
                )
            if tc.id in remove_set:
                continue
            final_testcases.append(candidate)

        # 3) Add at the end.
        if operations.rows and operations.rows.add:
            for new_tc in operations.rows.add:
                final_testcases.append(
                    Testcase(
                        id=None,
                        set_id=testset_revision_commit.testset_id,
                        data=new_tc.data,
                    )
                )

        # Get variant_id from base revision (required for commit)
        variant_id = (
            testset_revision_commit.testset_variant_id
            or base_revision.testset_variant_id
        )

        # Generate a unique slug for the new revision if missing
        revision_slug = testset_revision_commit.slug or uuid4().hex[-12:]

        # Create commit request with full testcases data
        # This will go through the regular commit flow
        testset_revision_commit = TestsetRevisionCommit(
            slug=revision_slug,
            testset_id=testset_revision_commit.testset_id,
            testset_variant_id=variant_id,
            message=testset_revision_commit.message or "Patched testset revision",
            description=(
                testset_revision_commit.description or base_revision.description
            ),
            flags=testset_revision_commit.flags,
            data=TestsetRevisionData(
                testcases=final_testcases,
            ),
        )

        # Use the regular commit flow - this handles testcase creation and deduplication
        return await self.commit_testset_revision(
            project_id=project_id,
            user_id=user_id,
            testset_revision_commit=testset_revision_commit,
            include_testcases=include_testcases,
        )

    ## -------------------------------------------------------------------------


class SimpleTestsetsService:
    def __init__(
        self,
        *,
        testsets_service: TestsetsService,
    ):
        self.testsets_service = testsets_service

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_testset_create_request: SimpleTestsetCreateRequest,
        #
        testset_id: Optional[UUID] = None,
    ):
        try:
            testcases = simple_testset_create_request.testset.data.testcases

            testcases_data = [testcase.data for testcase in testcases]

            testcases_data = json_array_to_json_object(
                data=testcases_data,
            )

            validate_testset_limits(testcases_data)

            for i, testcase_data in enumerate(testcases_data.values()):
                simple_testset_create_request.testset.data.testcases[
                    i
                ].data = testcase_data

        except Exception:
            return None

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=simple_testset_create_request.testset.data.testcases,
            )

        except Exception:
            return None

        testset_create = TestsetCreate(
            slug=simple_testset_create_request.testset.slug,
            #
            name=simple_testset_create_request.testset.name,
            description=simple_testset_create_request.testset.description,
            #
            # flags =
            tags=simple_testset_create_request.testset.tags,
            meta=simple_testset_create_request.testset.meta,
        )

        testset: Optional[Testset] = await self.testsets_service.create_testset(
            project_id=project_id,
            user_id=user_id,
            #
            testset_create=testset_create,
            #
            testset_id=testset_id,
        )

        if testset is None:
            return None

        testset_variant_slug = uuid4().hex[-12:]

        testset_variant_create = TestsetVariantCreate(
            slug=testset_variant_slug,
            #
            name=simple_testset_create_request.testset.name,
            description=simple_testset_create_request.testset.description,
            #
            # flags =
            tags=simple_testset_create_request.testset.tags,
            meta=simple_testset_create_request.testset.meta,
            #
            testset_id=testset.id,
        )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.create_testset_variant(
            project_id=project_id,
            user_id=user_id,
            #
            testset_variant_create=testset_variant_create,
        )

        if testset_variant is None:
            return None

        testset_revision_slug = uuid4().hex[-12:]

        testset_revision_create = TestsetRevisionCreate(
            slug=testset_revision_slug,
            #
            name=simple_testset_create_request.testset.name,
            description=simple_testset_create_request.testset.description,
            #
            # flags =
            tags=simple_testset_create_request.testset.tags,
            meta=simple_testset_create_request.testset.meta,
            #
            testset_id=testset.id,
            testset_variant_id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.create_testset_revision(
            project_id=project_id,
            user_id=user_id,
            #
            testset_revision_create=testset_revision_create,
        )

        if testset_revision is None:
            return None

        testset_revision_slug = uuid4().hex[-12:]

        testset_revision_commit = TestsetRevisionCommit(
            slug=testset_revision_slug,
            #
            name=simple_testset_create_request.testset.name,
            description=simple_testset_create_request.testset.description,
            #
            # flags =
            tags=simple_testset_create_request.testset.tags,
            meta=simple_testset_create_request.testset.meta,
            #
            data=testset_revision_data,
            #
            testset_id=testset.id,
            testset_variant_id=testset_variant.id,
        )

        testset_revision = await self.testsets_service.commit_testset_revision(
            project_id=project_id,
            user_id=user_id,
            #
            testset_revision_commit=testset_revision_commit,
        )

        if testset_revision is None:
            return None

        simple_testset = SimpleTestset(
            id=testset.id,
            slug=testset.slug,
            #
            created_at=testset.created_at,
            updated_at=testset.updated_at,
            deleted_at=testset.deleted_at,
            created_by_id=testset.created_by_id,
            updated_by_id=testset.updated_by_id,
            deleted_by_id=testset.deleted_by_id,
            #
            name=testset.name,
            description=testset.description,
            #
            # flags =
            tags=testset.tags,
            meta=testset.meta,
            #
            data=testset_revision.data,
            #
            revision_id=testset_revision.id,
        )

        return simple_testset

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        simple_testset_edit_request: SimpleTestsetEditRequest,
    ) -> Optional[SimpleTestset]:
        try:
            testcases = simple_testset_edit_request.testset.data.testcases

            testcases_data = [testcase.data for testcase in testcases]

            testcases_data = json_array_to_json_object(
                data=testcases_data,
            )

            validate_testset_limits(testcases_data)

            for i, testcase_data in enumerate(testcases_data.values()):
                simple_testset_edit_request.testset.data.testcases[
                    i
                ].data = testcase_data

        except Exception:
            return None

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=testcases,
            )

        except Exception:
            return None

        testset_ref = Reference(
            id=simple_testset_edit_request.testset.id,
        )

        testset: Optional[Testset] = await self.testsets_service.fetch_testset(
            project_id=project_id,
            #
            testset_ref=testset_ref,
        )

        if testset is None:
            return None

        has_changes = (
            testset.name != simple_testset_edit_request.testset.name
            or testset.description != simple_testset_edit_request.testset.description
            or testset.tags != simple_testset_edit_request.testset.tags
            or testset.meta != simple_testset_edit_request.testset.meta
        )

        if has_changes:
            testset_edit = TestsetEdit(
                id=testset.id,
                #
                name=simple_testset_edit_request.testset.name,
                description=simple_testset_edit_request.testset.description,
                #
                # flags =
                tags=simple_testset_edit_request.testset.tags,
                meta=simple_testset_edit_request.testset.meta,
            )

            testset: Optional[Testset] = await self.testsets_service.edit_testset(  # type: ignore
                project_id=project_id,
                user_id=user_id,
                #
                testset_edit=testset_edit,
            )

            if testset is None:
                return None

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_testset_variant(
            project_id=project_id,
            #
            testset_ref=testset_ref,
        )

        if testset_variant is None:
            return None

        has_changes = (
            testset_variant.name != simple_testset_edit_request.testset.name
            or testset_variant.description
            != simple_testset_edit_request.testset.description
            or testset_variant.tags != simple_testset_edit_request.testset.tags
            or testset_variant.meta != simple_testset_edit_request.testset.meta
        )

        if has_changes:
            testset_variant_edit = TestsetVariant(
                id=testset_variant.id,
                #
                name=simple_testset_edit_request.testset.name,
                description=simple_testset_edit_request.testset.description,
                #
                # flags =
                tags=simple_testset_edit_request.testset.tags,
                meta=simple_testset_edit_request.testset.meta,
            )

            testset_variant: Optional[TestsetVariant] = (  # type: ignore
                await self.testsets_service.edit_testset_variant(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    testset_variant_edit=testset_variant_edit,
                )
            )

            if testset_variant is None:
                return None

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_testset_revision(
            project_id=project_id,
            #
            testset_variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            return None

        old_testcase_ids = [
            testcase.data for testcase in testset_revision.data.testcases
        ]

        new_testcase_ids = [
            testcase.data
            for testcase in simple_testset_edit_request.testset.data.testcases
        ]

        has_changes = (
            testset_revision.name != simple_testset_edit_request.testset.name
            or testset_revision.description
            != simple_testset_edit_request.testset.description
            or testset_revision.tags != simple_testset_edit_request.testset.tags
            or testset_revision.meta != simple_testset_edit_request.testset.meta
            or old_testcase_ids != new_testcase_ids
        )

        if has_changes:
            testset_revision_slug = uuid4().hex[-12:]

            testset_revision_commit = TestsetRevisionCommit(
                slug=testset_revision_slug,
                #
                name=simple_testset_edit_request.testset.name,
                description=simple_testset_edit_request.testset.description,
                #
                # flags =
                tags=simple_testset_edit_request.testset.tags,
                meta=simple_testset_edit_request.testset.meta,
                #
                data=testset_revision_data,
                #
                testset_id=testset.id,
                testset_variant_id=testset_variant.id,
            )

            testset_revision: Optional[TestsetRevision] = (  # type: ignore
                await self.testsets_service.commit_testset_revision(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    testset_revision_commit=testset_revision_commit,
                )
            )

            if testset_revision is None:
                return None

        simple_testset = SimpleTestset(
            id=testset.id,
            slug=testset.slug,
            #
            created_at=testset.created_at,
            updated_at=testset.updated_at,
            deleted_at=testset.deleted_at,
            created_by_id=testset.created_by_id,
            updated_by_id=testset.updated_by_id,
            deleted_by_id=testset.deleted_by_id,
            #
            name=testset.name,
            description=testset.description,
            #
            # flags =
            tags=testset.tags,
            meta=testset.meta,
            #
            data=testset_revision.data,
            #
            revision_id=testset_revision.id,
        )

        return simple_testset

    async def transfer(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        testset_id: UUID,
    ):
        old_testset = await fetch_testset_by_id(
            project_id=str(project_id),
            #
            testset_id=str(testset_id),
        )

        if old_testset is None:
            return None

        testset_revision_data = self._transfer_simple_testset_revision_data(
            old_testset=old_testset,
        )

        new_testset = await self.testsets_service.fetch_testset(
            project_id=project_id,
            #
            testset_ref=Reference(id=testset_id),
        )

        if not new_testset:
            name = str(old_testset.name)
            slug = get_slug_from_name_and_id(
                name=name,
                id=testset_id,
            )

            simple_testset_create_request = SimpleTestsetCreateRequest(
                testset=SimpleTestsetCreate(
                    slug=slug,
                    name=name,
                    description=None,
                    # flags=None,
                    tags=None,
                    meta=None,
                    data=testset_revision_data,
                )
            )

            testset = await self.create(
                project_id=project_id,
                user_id=user_id,
                #
                simple_testset_create_request=simple_testset_create_request,
                #
                testset_id=testset_id,
            )

        else:
            simple_testset_edit_request = SimpleTestsetEditRequest(
                testset=SimpleTestsetEdit(
                    id=testset_id,
                    #
                    name=new_testset.name,
                    description=new_testset.description,
                    #
                    # flags=new_testset.flags,
                    tags=new_testset.tags,
                    meta=new_testset.meta,
                    #
                    data=testset_revision_data,
                )
            )

            testset = await self.edit(
                project_id=project_id,
                user_id=user_id,
                #
                simple_testset_edit_request=simple_testset_edit_request,
            )

        return testset

    def _transfer_simple_testset_revision_data(
        self,
        *,
        old_testset: TestsetDB,
    ) -> TestsetRevisionData:
        return TestsetRevisionData(
            testcases=[
                Testcase(data=testcase_data) for testcase_data in old_testset.csvdata
            ],
        )
