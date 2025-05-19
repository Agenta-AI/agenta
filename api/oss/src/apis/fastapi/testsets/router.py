from typing import Union, Optional, List, Literal
from uuid import uuid4, UUID
from tempfile import TemporaryDirectory
from os import path as os_path

from pydantic import ValidationError

from fastapi import Request, status, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import FileResponse

from oss.src.utils.common import APIRouter, is_ee
from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference
from oss.src.core.testsets.dtos import TestsetFlags, TestsetData
from oss.src.core.testsets.service import TestsetsService
from oss.src.apis.fastapi.shared.utils import handle_exceptions

from oss.src.core.testsets.dtos import (
    TestsetArtifact,
    TestsetVariant,
    TestsetRevision,
)

from oss.src.apis.fastapi.testsets.models import (
    TagsRequest,
    TestsetRequest,
    TestsetResponse,
    TestsetsResponse,
    TestcaseResponse,
    Testset,
    Testcase,
)

from oss.src.apis.fastapi.testsets.utils import (
    csv_file_to_json_array,
    json_file_to_json_array,
    json_array_to_json_object,
    json_array_to_csv_file,
    json_array_to_json_file,
    format_validation_error,
    validate_testset_limits,
    TESTSETS_SIZE_EXCEPTION,
    TESTSETS_SIZE_LIMIT,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)

# --- LATER
# TODO: ADD TESTCASE_ID_KEY OPTION
# TODO: ADD DEDUPLICATION
# TODO: ADD DEDUPLICATION_ID_KEY OPTION
# TODO: ADD METADATA
# TODO: ADD METADATA_KEY OPTION


class TestsetsRouter:
    VERSION = "1.0.0"

    TESTCASES_FLAGS = TestsetFlags(
        has_testcases=True,
        has_links=False,
    )

    def __init__(
        self,
        *,
        testsets_service: TestsetsService,
    ):
        self.testsets_service = testsets_service

        self.router = APIRouter()

        # POST /api/v1/testsets/
        self.router.add_api_route(
            "/",
            self.create_testset,
            methods=["POST"],
            operation_id="create_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/v1/testsets/{testset_id}
        self.router.add_api_route(
            "/{testset_id}",
            self.fetch_testset,
            methods=["GET"],
            operation_id="fetch_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/v1/testsets/{testset_id}
        self.router.add_api_route(
            "/{testset_id}",
            self.edit_testset,
            methods=["PUT"],
            operation_id="edit_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/{testset_id}/archive
        self.router.add_api_route(
            "/{testset_id}/archive",
            self.archive_testset,
            methods=["POST"],
            operation_id="archive_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/{testset_id}/unarchive
        self.router.add_api_route(
            "/{testset_id}/unarchive",
            self.unarchive_testset,
            methods=["POST"],
            operation_id="unarchive_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/v1/testsets/
        self.router.add_api_route(
            "/",
            self.query_testsets,
            methods=["GET"],
            operation_id="list_testsets",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/query
        self.router.add_api_route(
            "/query",
            self.query_testsets,
            methods=["POST"],
            operation_id="query_testsets",
            status_code=status.HTTP_200_OK,
            response_model=TestsetsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/upload
        self.router.add_api_route(
            "/upload",
            self.create_testset_from_file,
            methods=["POST"],
            operation_id="create_testset_from_file",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/{testset_id}/upload
        self.router.add_api_route(
            "/{testset_id}/upload",
            self.update_testset_from_file,
            methods=["POST"],
            operation_id="update_testset_from_file",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/v1/testsets/{testset_id}/download
        self.router.add_api_route(
            "/{testset_id}/download",
            self.fetch_testset_to_file,
            methods=["POST"],
            operation_id="fetch_testset_to_file",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/v1/testcases/{testcase_id}
        self.router.add_api_route(
            "/testcases/{testcase_id}",
            self.fetch_testcase,
            methods=["GET"],
            operation_id="fetch_testcase",
            status_code=status.HTTP_200_OK,
            response_model=TestcaseResponse,
            response_model_exclude_none=True,
        )

    @handle_exceptions()
    async def create_testset(
        self,
        *,
        request: Request,
        testset_request: TestsetRequest,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        try:
            testcases = json_array_to_json_object(
                data=testset_request.testset.testcases,
            ).values()

            validate_testset_limits(testcases)

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetData(
                testcases=testcases,
            )

        except ValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=format_validation_error(e, testset_request.model_dump()),
            ) from e

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.create_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_slug=testset_request.testset.slug,
            #
            artifact_flags=self.TESTCASES_FLAGS,
            artifact_metadata=testset_request.testset.metadata,
            artifact_name=testset_request.testset.name,
            artifact_description=testset_request.testset.description,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create testset. Please try again or contact support.",
            )

        testset_variant_slug = uuid4().hex

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.create_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=testset_artifact.id,
            #
            variant_slug=testset_variant_slug,
            #
            variant_flags=self.TESTCASES_FLAGS,
            variant_metadata=testset_request.testset.metadata,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create testset. Please try again or contact support.",
            )

        testset_revision_slug = uuid4().hex

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.create_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=testset_variant.id,
            #
            revision_slug=testset_revision_slug,
            #
            revision_flags=self.TESTCASES_FLAGS,
            revision_metadata=testset_request.testset.metadata,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create testset. Please try again or contact support.",
            )

        testset_revision_slug = uuid4().hex

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.commit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=testset_variant.id,
            #
            revision_slug=testset_revision_slug,
            #
            revision_flags=self.TESTCASES_FLAGS,
            revision_metadata=testset_request.testset.metadata,
            revision_data=testset_revision_data,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create testset. Please try again or contact support.",
            )

        testset = Testset(
            id=testset_artifact.id,
            slug=testset_artifact.slug,
            #
            created_at=testset_artifact.created_at,
            updated_at=testset_artifact.updated_at,
            deleted_at=testset_artifact.deleted_at,
            created_by_id=testset_artifact.created_by_id,
            updated_by_id=testset_artifact.updated_by_id,
            deleted_by_id=testset_artifact.deleted_by_id,
            #
            metadata=testset_artifact.metadata,
            name=testset_artifact.name,
            description=testset_artifact.description,
            testcases=testset_revision.data.testcases,
        )

        testset_response = TestsetResponse(
            count=1,
            testset=testset,
        )

        return testset_response

    @handle_exceptions()
    async def fetch_testset(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_artifact_ref = Reference(
            id=testset_id,
        )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset = Testset(
            id=testset_artifact.id,
            slug=testset_artifact.slug,
            #
            created_at=testset_artifact.created_at,
            updated_at=testset_artifact.updated_at,
            deleted_at=testset_artifact.deleted_at,
            created_by_id=testset_artifact.created_by_id,
            updated_by_id=testset_artifact.updated_by_id,
            deleted_by_id=testset_artifact.deleted_by_id,
            #
            metadata=testset_artifact.metadata,
            name=testset_artifact.name,
            description=testset_artifact.description,
            testcases=testset_revision.data.testcases,
        )

        testset_response = TestsetResponse(
            count=1,
            testset=testset,
        )

        return testset_response

    @handle_exceptions()
    async def edit_testset(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
        testset_request: TestsetRequest,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        try:
            testcases = json_array_to_json_object(
                data=testset_request.testset.testcases,
            ).values()

            validate_testset_limits(testcases)

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetData(
                testcases=testcases,
            )

        except ValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=format_validation_error(e, testset_request.model_dump()),
            ) from e

        if str(testset_id) != str(testset_request.testset.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {testset_id} != {testset_request.testset.id}",
            )

        testset_artifact_ref = Reference(
            id=testset_request.testset.id,
        )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.edit_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=testset_request.testset.id,
            #
            artifact_flags=self.TESTCASES_FLAGS,
            artifact_metadata=testset_request.testset.metadata,
            artifact_name=testset_request.testset.name,
            artifact_description=testset_request.testset.description,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit testset. Please try again or contact support.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.edit_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=testset_variant.id,
            #
            variant_flags=self.TESTCASES_FLAGS,
            variant_metadata=testset_request.testset.metadata,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit testset. Please try again or contact support.",
            )

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.commit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=testset_variant.id,
            #
            revision_slug=testset_revision.slug,
            #
            revision_flags=self.TESTCASES_FLAGS,
            revision_metadata=testset_request.testset.metadata,
            revision_data=testset_revision_data,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit testset. Please try again or contact support.",
            )

        testset = Testset(
            id=testset_artifact.id,
            slug=testset_artifact.slug,
            #
            created_at=testset_artifact.created_at,
            updated_at=testset_artifact.updated_at,
            deleted_at=testset_artifact.deleted_at,
            created_by_id=testset_artifact.created_by_id,
            updated_by_id=testset_artifact.updated_by_id,
            deleted_by_id=testset_artifact.deleted_by_id,
            #
            metadata=testset_artifact.metadata,
            name=testset_artifact.name,
            description=testset_artifact.description,
            testcases=testset_revision.data.testcases,
        )

        testset_response = TestsetResponse(
            count=1,
            testset=testset,
        )

        return testset_response

    @handle_exceptions()
    async def archive_testset(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_artifact_ref = Reference(
            id=testset_id,
        )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.archive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=testset_id,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive testset. Please try again or contact support.",
            )

        testset = Testset(
            id=testset_artifact.id,
            slug=testset_artifact.slug,
            #
            created_at=testset_artifact.created_at,
            updated_at=testset_artifact.updated_at,
            deleted_at=testset_artifact.deleted_at,
            created_by_id=testset_artifact.created_by_id,
            updated_by_id=testset_artifact.updated_by_id,
            deleted_by_id=testset_artifact.deleted_by_id,
            #
            metadata=testset_artifact.metadata,
            name=testset_artifact.name,
            description=testset_artifact.description,
        )

        testset_response = TestsetResponse(
            count=1,
            testset=testset,
        )

        return testset_response

    @handle_exceptions()
    async def unarchive_testset(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_artifact_ref = Reference(
            id=testset_id,
        )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.unarchive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=testset_id,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive testset. Please try again or contact support.",
            )

        testset = Testset(
            id=testset_artifact.id,
            slug=testset_artifact.slug,
            #
            created_at=testset_artifact.created_at,
            updated_at=testset_artifact.updated_at,
            deleted_at=testset_artifact.deleted_at,
            created_by_id=testset_artifact.created_by_id,
            updated_by_id=testset_artifact.updated_by_id,
            deleted_by_id=testset_artifact.deleted_by_id,
            #
            metadata=testset_artifact.metadata,
            name=testset_artifact.name,
            description=testset_artifact.description,
        )

        testset_response = TestsetResponse(
            count=1,
            testset=testset,
        )

        return testset_response

    @handle_exceptions()
    async def query_testsets(
        self,
        *,
        request: Request,
        metadata_request: Optional[TagsRequest] = None,
    ) -> TestsetsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testsets: List[Testset] = []

        metadata = metadata_request.metadata if metadata_request else None

        testset_artifacts: List[
            TestsetArtifact
        ] = await self.testsets_service.query_artifacts(
            project_id=UUID(request.state.project_id),
            #
            artifact_flags=self.TESTCASES_FLAGS,
            artifact_metadata=metadata,
        )

        if testset_artifacts is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to query testsets. Please try again or contact support.",
            )

        for testset_artifact in testset_artifacts:
            testset_artifact_ref = Reference(
                id=testset_artifact.id,
            )

            testset_variant: Optional[
                TestsetVariant
            ] = await self.testsets_service.fetch_variant(
                project_id=UUID(request.state.project_id),
                #
                artifact_ref=testset_artifact_ref,
            )

            if testset_variant is None:
                continue

            testset_variant_ref = Reference(
                id=testset_variant.id,
            )

            testset_revision: Optional[
                TestsetRevision
            ] = await self.testsets_service.fetch_revision(
                project_id=UUID(request.state.project_id),
                #
                variant_ref=testset_variant_ref,
            )

            if testset_revision is None:
                continue

            testsets.append(
                Testset(
                    id=testset_artifact.id,
                    slug=testset_artifact.slug,
                    #
                    created_at=testset_artifact.created_at,
                    updated_at=testset_artifact.updated_at,
                    deleted_at=testset_artifact.deleted_at,
                    created_by_id=testset_artifact.created_by_id,
                    updated_by_id=testset_artifact.updated_by_id,
                    deleted_by_id=testset_artifact.deleted_by_id,
                    #
                    metadata=testset_artifact.metadata,
                    name=testset_artifact.name,
                    description=testset_artifact.description,
                    testcases=testset_revision.data.testcases,
                )
            )

        testsets_response = TestsetsResponse(
            count=len(testsets),
            testsets=testsets,
        )

        return testsets_response

    @handle_exceptions()
    async def create_testset_from_file(
        self,
        *,
        request: Request,
        file: UploadFile = File(...),
        file_type: Literal["CSV", "JSON"] = Form(None),
        testset_slug: Optional[str] = Form(None),
        testset_name: Optional[str] = File(None),
        testset_description: Optional[str] = Form(None),
        testset_metadata: Optional[List[str]] = Form(None),
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["CSV", "JSON"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'CSV' and 'JSON'.",
            )

        if file.size > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        testcases = []

        if file_type == "JSON":
            try:
                testcases = json_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read JSON file: {e}",
                ) from e

        elif file_type == "CSV":
            try:
                testcases = csv_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read CSV file: {e}",
                ) from e

        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        testset_request = TestsetRequest(
            testset=Testset(
                slug=testset_slug,
                #
                metadata=testset_metadata,
                name=testset_name,
                description=testset_description,
                testcases=testcases,
            )
        )

        return await self.create_testset(
            request=request,
            testset_request=testset_request,
        )

    @handle_exceptions()
    async def update_testset_from_file(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
        file: UploadFile = File(...),
        file_type: Literal["CSV", "JSON"] = Form(None),
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["CSV", "JSON"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'CSV' and 'JSON'.",
            )

        if file.size > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        testcases = []

        if file_type == "JSON":
            try:
                testcases = json_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read JSON file: {e}",
                ) from e

        elif file_type == "CSV":
            try:
                testcases = csv_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read CSV file: {e}",
                ) from e

        else:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        testset_response = await self.fetch_testset(
            request=request,
            testset_id=testset_id,
        )

        if testset_response.testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Testset not found. Please check the testset_id and try again.",
            )

        testset_request = TestsetRequest(
            testset=Testset(
                id=testset_id,
                #
                metadata=testset_response.testset.metadata,
                name=testset_response.testset.name,
                description=testset_response.testset.description,
                testcases=testcases,
            )
        )

        return await self.edit_testset(
            request=request,
            testset_id=testset_id,
            testset_request=testset_request,
        )

    @handle_exceptions()
    async def fetch_testset_to_file(
        self,
        *,
        request: Request,
        testset_id: Union[UUID, str],
        file_type: Literal["CSV", "JSON"] = Query(None),
    ) -> ...:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["CSV", "JSON"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'CSV' and 'JSON'.",
            )

        testset_artifact_ref = Reference(
            id=testset_id,
        )

        testset_artifact: Optional[
            TestsetArtifact
        ] = await self.testsets_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=testset_artifact_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic testset not found. Please check the ID and try again.",
            )

        filename = f"testset_{testset_id}.{file_type.lower()}"
        testcases = testset_revision.data.testcases

        with TemporaryDirectory() as tmpdir:
            output_path = os_path.join(tmpdir, filename)

            if file_type == "JSON":
                json_array_to_json_file(output_path, testcases)

                return FileResponse(
                    output_path,
                    media_type="application/json",
                    filename=filename,
                )

            elif file_type == "CSV":
                json_array_to_csv_file(testcases, output_path)

                return FileResponse(
                    output_path,
                    media_type="text/csv",
                    filename=filename,
                )

            else:
                raise HTTPException(status_code=400, detail="Invalid file type.")

    @handle_exceptions()
    async def fetch_testcase(
        self,
        *,
        request: Request,
        testcase_id: UUID,
    ) -> TestcaseResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testcases = await self.testsets_service.load_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=[testcase_id],
        )

        testcase_response = TestcaseResponse(
            count=0,
            testcase=None,
        )

        if testcases is not None:
            testcase_response = TestcaseResponse(
                count=len(testcases),
                testcase=testcases[0] if len(testcases) > 0 else None,
            )

        return testcase_response
