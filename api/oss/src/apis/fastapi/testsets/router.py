from typing import Optional, List, Literal, Dict
from uuid import uuid4, UUID
from json import loads, JSONDecodeError
from io import BytesIO

###
import orjson
import pandas as pd

###

from pydantic import ValidationError
from fastapi.responses import StreamingResponse
from fastapi import APIRouter, Request, status, HTTPException, UploadFile, File, Form

from oss.src.utils.helpers import get_slug_from_name_and_id

from oss.src.services.db_manager import fetch_testset_by_id
from oss.src.models.db_models import TestSetDB

from fastapi import APIRouter, Request, status, HTTPException, UploadFile, File, Form

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Reference
from oss.src.core.testsets.dtos import TestsetFlags, TestsetRevisionData
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testcases.dtos import Testcase

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
from oss.src.apis.fastapi.testsets.models import (
    SimpleTestset,
    SimpleTestsetCreate,
    SimpleTestsetEdit,
    SimpleTestsetQuery,
    #
    SimpleTestsetCreateRequest,
    SimpleTestsetEditRequest,
    SimpleTestsetQueryRequest,
    #
    SimpleTestsetResponse,
    SimpleTestsetsResponse,
    #
    TestcasesQueryRequest,
    #
    TestcaseResponse,
    TestcasesResponse,
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
# TODO: ADD DEDUPLICATION AS OPTIONAL
# TODO: CLEAN UP !


class SimpleTestsetsRouter:
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

        # POST /api/preview/simple/testsets/
        self.router.add_api_route(
            "/",
            self.create_simple_testset,
            methods=["POST"],
            operation_id="create_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/simple/testsets/{testset_id}
        self.router.add_api_route(
            "/{testset_id}",
            self.fetch_simple_testset,
            methods=["GET"],
            operation_id="fetch_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/preview/simple/testsets/{testset_id}
        self.router.add_api_route(
            "/{testset_id}",
            self.edit_simple_testset,
            methods=["PUT"],
            operation_id="edit_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/{testset_id}/archive
        self.router.add_api_route(
            "/{testset_id}/archive",
            self.archive_simple_testset,
            methods=["POST"],
            operation_id="archive_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/{testset_id}/unarchive
        self.router.add_api_route(
            "/{testset_id}/unarchive",
            self.unarchive_simple_testset,
            methods=["POST"],
            operation_id="unarchive_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/simple/testsets/
        self.router.add_api_route(
            "/",
            self.list_simple_testsets,
            methods=["GET"],
            operation_id="list_simple_testsets",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/query
        self.router.add_api_route(
            "/query",
            self.query_simple_testsets,
            methods=["POST"],
            operation_id="query_simple_testsets",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/upload
        self.router.add_api_route(
            "/upload",
            self.create_simple_testset_from_file,
            methods=["POST"],
            operation_id="create_simple_testset_from_file",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/{testset_id}/upload
        self.router.add_api_route(
            "/{testset_id}/upload",
            self.edit_simple_testset_from_file,
            methods=["POST"],
            operation_id="edit_simple_testset_from_file",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/{testset_id}/download
        self.router.add_api_route(
            "/{testset_id}/download",
            self.fetch_simple_testset_to_file,
            methods=["POST"],
            operation_id="fetch_simple_testset_to_file",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/simple/testcases/{testcase_id}
        self.router.add_api_route(
            "/testcases/{testcase_id}",
            self.fetch_testcase,
            methods=["GET"],
            operation_id="fetch_testcase",
            status_code=status.HTTP_200_OK,
            response_model=TestcaseResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/simple/testcases/
        self.router.add_api_route(
            "/testcases/",
            self.list_testcases,
            methods=["GET"],
            operation_id="list_testcases",
            status_code=status.HTTP_200_OK,
            response_model=TestcasesResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testcases/query
        self.router.add_api_route(
            "/testcases/query",
            self.query_testcases,
            methods=["POST"],
            operation_id="query_testcases",
            status_code=status.HTTP_200_OK,
            response_model=TestcasesResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/simple/testsets/{testset_id}/transfer
        self.router.add_api_route(
            "/{testset_id}/transfer",
            self.transfer_simple_testset,
            methods=["POST"],
            operation_id="transfer_simple_testset",
            status_code=status.HTTP_200_OK,
            response_model=SimpleTestsetResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def create_simple_testset(
        self,
        *,
        request: Request,
        simple_testset_create_request: SimpleTestsetCreateRequest,
        testset_id: Optional[UUID] = None,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

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

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=simple_testset_create_request.testset.data.testcases,
            )

        except ValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=format_validation_error(
                    e, simple_testset_create_request.model_dump()
                ),
            ) from e

        _testset_create = TestsetCreate(
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
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_create=_testset_create,
            #
            testset_id=testset_id,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple testset. Please try again or contact support.",
            )

        testset_variant_slug = uuid4().hex

        _testset_variant_create = TestsetVariantCreate(
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
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_create=_testset_variant_create,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple testset. Please try again or contact support.",
            )

        testset_revision_slug = uuid4().hex

        _testset_revision_create = TestsetRevisionCreate(
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
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_create=_testset_revision_create,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple testset. Please try again or contact support.",
            )

        testset_revision_slug = uuid4().hex

        _testset_revision_commit = TestsetRevisionCommit(
            slug=testset_revision_slug,
            #
            name=simple_testset_create_request.testset.name,
            description=simple_testset_create_request.testset.description,
            #
            # flags =
            tags=simple_testset_create_request.testset.tags,
            meta=simple_testset_create_request.testset.meta,
            #
            # message =
            #
            data=testset_revision_data,
            #
            testset_id=testset.id,
            testset_variant_id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.commit_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_commit=_testset_revision_commit,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple testset. Please try again or contact support.",
            )

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
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetResponse())
    async def fetch_simple_testset(
        self,
        *,
        request: Request,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_ref = Reference(
            id=testset_id,
        )

        testset: Optional[Testset] = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the ID and try again.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_testset_variant(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset variant not found. Please check the ID and try again.",
            )

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_testset_revision(
            project_id=UUID(request.state.project_id),
            #
            testset_variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset revision not found. Please check the ID and try again.",
            )

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
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def edit_simple_testset(
        self,
        *,
        request: Request,
        testset_id: UUID,
        simple_testset_edit_request: SimpleTestsetEditRequest,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

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

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=testcases,
            )

        except ValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=format_validation_error(
                    e, simple_testset_edit_request.model_dump()
                ),
            ) from e

        if str(testset_id) != str(simple_testset_edit_request.testset.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {testset_id} != {simple_testset_edit_request.testset.id}",
            )

        testset_ref = Reference(
            id=simple_testset_edit_request.testset.id,
        )

        testset: Optional[Testset] = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the ID and try again.",
            )

        has_changes = (
            testset.name != simple_testset_edit_request.testset.name
            or testset.description != simple_testset_edit_request.testset.description
            or testset.tags != simple_testset_edit_request.testset.tags
            or testset.meta != simple_testset_edit_request.testset.meta
        )

        if has_changes:
            _testset_edit = TestsetEdit(
                id=testset.id,
                #
                name=simple_testset_edit_request.testset.name,
                description=simple_testset_edit_request.testset.description,
                #
                # flags =
                tags=simple_testset_edit_request.testset.tags,
                meta=simple_testset_edit_request.testset.meta,
            )

            testset: Optional[Testset] = await self.testsets_service.edit_testset(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                testset_edit=_testset_edit,
            )

            if testset is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to edit simple testset. Please try again or contact support.",
                )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_testset_variant(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset variant not found. Please check the ID and try again.",
            )

        has_changes = (
            testset_variant.name != simple_testset_edit_request.testset.name
            or testset_variant.description
            != simple_testset_edit_request.testset.description
            or testset_variant.tags != simple_testset_edit_request.testset.tags
            or testset_variant.meta != simple_testset_edit_request.testset.meta
        )

        if has_changes:
            _testset_variant_edit = TestsetVariant(
                id=testset_variant.id,
                #
                name=simple_testset_edit_request.testset.name,
                description=simple_testset_edit_request.testset.description,
                #
                # flags =
                tags=simple_testset_edit_request.testset.tags,
                meta=simple_testset_edit_request.testset.meta,
            )

            testset_variant: Optional[
                TestsetVariant
            ] = await self.testsets_service.edit_testset_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                testset_variant_edit=_testset_variant_edit,
            )

            if testset_variant is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to edit simple testset variant. Please try again or contact support.",
                )

        testset_variant_ref = Reference(
            id=testset_variant.id,
        )

        testset_revision: Optional[
            TestsetRevision
        ] = await self.testsets_service.fetch_testset_revision(
            project_id=UUID(request.state.project_id),
            #
            testset_variant_ref=testset_variant_ref,
        )

        if testset_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset revisions not found. Please check the ID and try again.",
            )

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
            testset_revision_slug = uuid4().hex

            _testset_revision_commit = TestsetRevisionCommit(
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

            testset_revision: Optional[
                TestsetRevision
            ] = await self.testsets_service.commit_testset_revision(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                testset_revision_commit=_testset_revision_commit,
            )

            if testset_revision is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to edit simple testset revision. Please try again or contact support.",
                )

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
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def archive_simple_testset(
        self,
        *,
        request: Request,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_ref = Reference(
            id=testset_id,
        )

        testset: Optional[Testset] = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the ID and try again.",
            )

        testset: Optional[Testset] = await self.testsets_service.archive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive simple testset. Please try again or contact support.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_testset_variant(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Failed to fetch simple testset variant. Please try again or contact support.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.archive_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_id=testset_variant.id,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive simple testset variant. Please try again or contact support.",
            )

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
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def unarchive_simple_testset(
        self,
        *,
        request: Request,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testset_ref = Reference(
            id=testset_id,
        )

        testset: Optional[Testset] = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the ID and try again.",
            )

        testset: Optional[Testset] = await self.testsets_service.unarchive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        if testset is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive simple testset. Please try again or contact support.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.fetch_testset_variant(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=testset_ref,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Failed to fetch simple testset variant. Please try again or contact support.",
            )

        testset_variant: Optional[
            TestsetVariant
        ] = await self.testsets_service.unarchive_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_id=testset_variant.id,
        )

        if testset_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive simple testset variant. Please try again or contact support.",
            )

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
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetsResponse())
    async def list_simple_testsets(
        self,
        *,
        request: Request,
    ) -> SimpleTestsetsResponse:
        simple_testset_query_request = SimpleTestsetQueryRequest()

        return await self.query_simple_testsets(
            request=request,
            simple_testset_query_request=simple_testset_query_request,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetsResponse())
    async def query_simple_testsets(
        self,
        *,
        request: Request,
        simple_testset_query_request: SimpleTestsetQueryRequest,
    ) -> SimpleTestsetsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testsets: List[Testset] = await self.testsets_service.query_testsets(
            project_id=UUID(request.state.project_id),
            #
            testset_query=simple_testset_query_request.testset,
            #
            testset_refs=simple_testset_query_request.testset_refs,
            #
            include_archived=simple_testset_query_request.include_archived,
            #
            windowing=simple_testset_query_request.windowing,
        )

        if testsets is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to query simple testsets. Please try again or contact support.",
            )

        simple_testsets: List[SimpleTestset] = []

        for testset in testsets:
            testset_ref = Reference(
                id=testset.id,
            )

            testset_variant: Optional[
                TestsetVariant
            ] = await self.testsets_service.fetch_testset_variant(
                project_id=UUID(request.state.project_id),
                #
                testset_ref=testset_ref,
            )

            if testset_variant is None:
                continue

            testset_variant_ref = Reference(
                id=testset_variant.id,
            )

            testset_revision: Optional[
                TestsetRevision
            ] = await self.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                #
                testset_variant_ref=testset_variant_ref,
            )

            if testset_revision is None:
                continue

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
            )

            simple_testsets.append(simple_testset)

        simple_testsets_response = SimpleTestsetsResponse(
            count=len(simple_testsets),
            testsets=simple_testsets,
        )

        return simple_testsets_response

    @intercept_exceptions()
    async def create_simple_testset_from_file(
        self,
        *,
        request: Request,
        file: UploadFile = File(...),
        file_type: Literal["csv", "json"] = Form("csv"),
        testset_slug: Optional[str] = Form(None),
        testset_name: Optional[str] = File(None),
        testset_description: Optional[str] = Form(None),
        testset_tags: Optional[str] = Form(None),
        testset_meta: Optional[str] = Form(None),
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["csv", "json"]:
            log.error(e)
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        if file.size > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        # deserialize tags and meta if provided
        try:
            testset_tags = loads(testset_tags) if testset_tags else None
            testset_meta = loads(testset_meta) if testset_meta else None
        except JSONDecodeError as e:
            log.error(e)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse tags or meta as JSON: {e}",
            ) from e

        testcases = []
        testcases_data: Dict[str, list] = {}

        if file_type.lower() == "json":
            try:
                testcases_data = await json_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read JSON file: {e}",
                ) from e

        elif file_type.lower() == "csv":
            try:
                testcases_data = await csv_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read CSV file: {e}",
                ) from e

        else:
            log.error(e)
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        try:
            testcases_data = json_array_to_json_object(
                data=testcases_data,
                testcase_id_key="__id__",
                testcase_dedup_id_key="__dedup_id__",
            )
            validate_testset_limits(testcases_data)

            for testcase_data in testcases_data.values():
                testcase_flags = testcase_data.pop("__flags__", None)
                testcase_tags = testcase_data.pop("__tags__", None)
                testcase_meta = testcase_data.pop("__meta__", None)

                testcases.append(
                    Testcase(
                        id=testcase_data.pop("__id__", None),
                        data=testcase_data,
                        flags=testcase_flags,
                        tags=testcase_tags,
                        meta=testcase_meta,
                    )
                )

        except Exception as e:
            log.error(e)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=testcases,
            )

        except ValidationError as e:
            log.error(e)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            ) from e

        simple_testset_create_request = SimpleTestsetCreateRequest(
            testset=SimpleTestsetCreate(
                slug=testset_slug or uuid4().hex,
                #
                name=testset_name or testset_slug or None,
                description=testset_description,
                #
                # flags =
                tags=testset_tags,
                meta=testset_meta,
                #
                data=testset_revision_data,
            )
        )

        return await self.create_simple_testset(
            request=request,
            simple_testset_create_request=simple_testset_create_request,
        )

    @intercept_exceptions()
    async def edit_simple_testset_from_file(
        self,
        *,
        request: Request,
        testset_id: UUID,
        file: UploadFile = File(...),
        file_type: Literal["csv", "json"] = Form("csv"),
        testset_name: Optional[str] = File(None),
        testset_description: Optional[str] = Form(None),
        testset_tags: Optional[str] = Form(None),
        testset_meta: Optional[str] = Form(None),
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'CSV' and 'JSON'.",
            )

        if file.size > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        # deserialize tags and meta if provided
        try:
            testset_tags = loads(testset_tags) if testset_tags else None
            testset_meta = loads(testset_meta) if testset_meta else None
        except JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse tags or meta as JSON: {e}",
            ) from e

        testcases = []
        testcases_data: Dict[str, list] = {}

        if file_type.lower() == "json":
            try:
                testcases_data = await json_file_to_json_array(file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read JSON file: {e}",
                ) from e

        elif file_type.lower() == "csv":
            try:
                testcases_data = await csv_file_to_json_array(file)

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

        try:
            testcases_data = json_array_to_json_object(
                data=testcases_data,
                testcase_id_key="__id__",
                testcase_dedup_id_key="__dedup_id__",
            )

            validate_testset_limits(testcases_data)

            for testcase_data in testcases_data.values():
                testcase_flags = testcase_data.pop("__flags__", None)
                testcase_tags = testcase_data.pop("__tags__", None)
                testcase_meta = testcase_data.pop("__meta__", None)

                testcases.append(
                    Testcase(
                        id=testcase_data.pop("__id__", None),
                        data=testcase_data,
                        flags=testcase_flags,
                        tags=testcase_tags,
                        meta=testcase_meta,
                    )
                )

        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse testcases as JSON array: {e}",
            ) from e

        try:
            testset_revision_data = TestsetRevisionData(
                testcases=testcases,
            )

        except ValidationError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            ) from e

        simple_testset_response = await self.fetch_simple_testset(
            request=request,
            testset_id=testset_id,
        )

        if simple_testset_response.testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Testset not found. Please check the testset_id and try again.",
            )

        simple_testset_edit_request = SimpleTestsetEditRequest(
            testset=SimpleTestsetEdit(
                id=testset_id,
                #
                name=testset_name or simple_testset_response.testset.name,
                description=testset_description
                or simple_testset_response.testset.description,
                #
                # flags =
                tags=testset_tags or simple_testset_response.testset.tags,
                meta=testset_meta or simple_testset_response.testset.meta,
                #
                data=testset_revision_data,
            )
        )

        return await self.edit_simple_testset(
            request=request,
            testset_id=testset_id,
            simple_testset_edit_request=simple_testset_edit_request,
        )

    @intercept_exceptions()
    async def fetch_simple_testset_to_file(
        self,
        *,
        request: Request,
        testset_id: UUID,
        file_type: Optional[Literal["csv", "json"]] = None,
        file_name: Optional[str] = None,
    ) -> StreamingResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        simple_testset_response = await self.fetch_simple_testset(
            request=request,
            testset_id=testset_id,
        )

        if simple_testset_response.count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the testset_id and try again.",
            )

        testset = simple_testset_response.testset

        filename = (file_name or f"testset_{testset_id}") + f".{file_type.lower()}"
        testcases = testset.data.testcases

        testcases_data = [
            {
                **testcase.data,
                "__id__": testcase.id,
                "__flags__": testcase.flags,
                "__tags__": testcase.tags,
                "__meta__": testcase.meta,
            }
            for testcase in testcases
        ]

        if file_type.lower() == "json":
            buffer = BytesIO(orjson.dumps(testcases_data))

            return StreamingResponse(
                buffer,
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )

        elif file_type.lower() == "csv":
            buffer = BytesIO()
            pd.DataFrame(testcases_data).to_csv(buffer, index=False)
            buffer.seek(0)

            return StreamingResponse(
                buffer,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )

    @intercept_exceptions()
    @suppress_exceptions(default=TestcaseResponse())
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

        testcases = await self.testsets_service.testcases_service.fetch_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=[testcase_id],
        )

        testcase_response = TestcaseResponse(
            count=1 if len(testcases) > 0 else 0,
            testcase=testcases[0] if len(testcases) > 0 else None,
        )

        return testcase_response

    @intercept_exceptions()
    @suppress_exceptions(default=TestcasesResponse())
    async def list_testcases(
        self,
        *,
        request: Request,
    ) -> TestcasesResponse:
        testcase_query_request = TestcasesQueryRequest()

        return await self.query_testcases(
            request=request,
            testcases_query_request=testcase_query_request,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=TestcasesResponse())
    async def query_testcases(
        self,
        *,
        request: Request,
        testcases_query_request: TestcasesQueryRequest,
    ) -> TestcasesResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        testcases = await self.testsets_service.testcases_service.fetch_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=testcases_query_request.testcase_ids,
            #
            testset_id=testcases_query_request.testset_id,
            #
            windowing=testcases_query_request.windowing,
        )

        testcase_response = TestcasesResponse(
            count=len(testcases),
            testcases=testcases if testcases else [],
        )

        return testcase_response

    @intercept_exceptions()
    async def transfer_simple_testset(
        self,
        *,
        request: Request,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,
            ):
                raise FORBIDDEN_EXCEPTION

        old_testset = await fetch_testset_by_id(
            testset_id=str(testset_id),
        )

        if old_testset is None:
            return SimpleTestsetResponse()

        testset_revision_data = self._transfer_simple_testset_revision_data(
            old_testset=old_testset,
        )

        new_testset = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=Reference(id=testset_id),
        )

        if not new_testset:
            slug = get_slug_from_name_and_id(
                name=old_testset.name,
                id=testset_id,
            )

            simple_testset_create_request = SimpleTestsetCreateRequest(
                testset=SimpleTestsetCreate(
                    slug=slug,
                    name=old_testset.name,
                    description=None,
                    flags=None,
                    tags=None,
                    meta=None,
                    data=testset_revision_data,
                )
            )

            simple_testset_response = await self.create_simple_testset(
                request=request,
                testset_id=testset_id,
                simple_testset_create_request=simple_testset_create_request,
            )

            return simple_testset_response

        else:
            simple_testset_edit_request = SimpleTestsetEditRequest(
                testset=SimpleTestsetEdit(
                    id=testset_id,
                    name=new_testset.name,
                    description=new_testset.description,
                    flags=new_testset.flags,
                    tags=new_testset.tags,
                    meta=new_testset.meta,
                    data=testset_revision_data,
                )
            )

            simple_testset_response = await self.edit_simple_testset(
                request=request,
                testset_id=testset_id,
                simple_testset_edit_request=simple_testset_edit_request,
            )

            return simple_testset_response

    def _transfer_simple_testset_revision_data(
        self,
        *,
        old_testset: TestSetDB,
    ) -> TestsetRevisionData:
        return TestsetRevisionData(
            testcases=[
                Testcase(data=testcase_data) for testcase_data in old_testset.csvdata
            ],
        )
