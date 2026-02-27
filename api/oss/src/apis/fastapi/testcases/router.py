from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Query, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.apis.fastapi.shared.utils import compute_next_windowing

from oss.src.core.testcases.service import (
    TestcasesService,
)
from oss.src.core.testsets.service import (
    TestsetsService,
)

from oss.src.apis.fastapi.testcases.models import (
    TestcasesQueryRequest,
    TestcaseResponse,
    TestcasesResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class TestcasesRouter:
    """
    FastAPI router for testcase endpoints.
    """

    def __init__(
        self,
        *,
        testcases_service: TestcasesService,
        testsets_service: TestsetsService,
    ):
        self.testcases_service = testcases_service
        self.testsets_service = testsets_service
        self.router = APIRouter()

        # TESTCASES ------------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.fetch_testcases,
            methods=["GET"],
            operation_id="fetch_testcases",
            status_code=status.HTTP_200_OK,
            response_model=TestcasesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{testcase_id}",
            self.fetch_testcase,
            methods=["GET"],
            operation_id="fetch_testcase",
            status_code=status.HTTP_200_OK,
            response_model=TestcaseResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_testcases,
            methods=["POST"],
            operation_id="query_testcases",
            status_code=status.HTTP_200_OK,
            response_model=TestcasesResponse,
            response_model_exclude_none=True,
        )

    # TESTCASES ----------------------------------------------------------------

    @intercept_exceptions()
    @suppress_exceptions(default=TestcasesResponse(), exclude=[HTTPException])
    async def fetch_testcases(
        self,
        request: Request,
        *,
        testcase_id: Optional[List[UUID]] = Query(default=None),
        testcase_ids: Optional[str] = Query(default=None),
    ) -> TestcasesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        ids: List[UUID] = list(testcase_id or [])
        if testcase_ids:
            ids.extend(UUID(i.strip()) for i in testcase_ids.split(",") if i.strip())

        if not ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one testcase_id query parameter is required.",
            )

        testcases = await self.testcases_service.query_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=ids,
            #
            testset_id=None,
            #
            windowing=None,
        )

        return TestcasesResponse(
            count=len(testcases),
            testcases=testcases if testcases else [],
        )

    @intercept_exceptions()
    @suppress_exceptions(default=TestcaseResponse(), exclude=[HTTPException])
    async def fetch_testcase(
        self,
        request: Request,
        *,
        testcase_id: UUID,
    ) -> TestcaseResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testcases = await self.testcases_service.fetch_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=[testcase_id],
        )

        testcase = testcases[0] if len(testcases) > 0 else None

        testcase_response = TestcaseResponse(
            count=1 if testcase else 0,
            testcase=testcase,
        )

        return testcase_response

    @intercept_exceptions()
    @suppress_exceptions(default=TestcasesResponse(), exclude=[HTTPException])
    async def query_testcases(
        self,
        request: Request,
        *,
        testcases_query_request: TestcasesQueryRequest,
    ) -> TestcasesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_id = testcases_query_request.testset_id
        testcase_ids = testcases_query_request.testcase_ids
        testset_revision_ref = testcases_query_request.testset_revision_ref

        # If any ref is provided, resolve the revision to get its testcase_ids
        if (
            testset_revision_ref
            or testcases_query_request.testset_variant_ref
            or testcases_query_request.testset_ref
        ):
            testset_revision = await self.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                #
                testset_ref=testcases_query_request.testset_ref,
                testset_variant_ref=testcases_query_request.testset_variant_ref,
                testset_revision_ref=testset_revision_ref,
                #
                include_testcase_ids=True,
                include_testcases=False,
            )
            if (
                testset_revision
                and testset_revision.data
                and testset_revision.data.testcase_ids
            ):
                testset_id = testset_revision.testset_id
                testcase_ids = testset_revision.data.testcase_ids
            else:
                return TestcasesResponse()

        if not testcase_ids and not testset_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "At least one filter is required: testcase_ids, testset_id, "
                    "testset_ref/testset_variant_ref/testset_revision_ref."
                ),
            )

        testcases = await self.testcases_service.query_testcases(
            project_id=UUID(request.state.project_id),
            #
            testcase_ids=testcase_ids,
            #
            testset_id=testset_id,
            #
            windowing=testcases_query_request.windowing,
        )

        next_windowing = compute_next_windowing(
            entities=testcases,
            attribute="created_at",  # Testcase IDs are content-hashed (UUID5), use timestamp
            windowing=testcases_query_request.windowing,
            order="ascending",  # Must match order used in BlobsDAO.query_blobs
        )

        testcase_response = TestcasesResponse(
            count=len(testcases),
            testcases=testcases if testcases else [],
            windowing=next_windowing,
        )

        return testcase_response
