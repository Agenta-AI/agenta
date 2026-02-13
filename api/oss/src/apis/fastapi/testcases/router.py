from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException

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
from oss.src.core.shared.dtos import Reference

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
            "/{testcase_id}",
            self.fetch_testcase,
            methods=["GET"],
            status_code=status.HTTP_200_OK,
            response_model=TestcaseResponse,
        )

        self.router.add_api_route(
            "/query",
            self.query_testcases,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=TestcasesResponse,
        )

    # TESTCASES ----------------------------------------------------------------

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
    async def list_testcases(
        self,
        request: Request,
    ) -> TestcasesResponse:
        testcase_query_request = TestcasesQueryRequest()

        return await self.query_testcases(
            request=request,
            #
            testcases_query_request=testcase_query_request,
        )

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

        # If testset_revision_id is provided, fetch testcase_ids from the revision
        if testcases_query_request.testset_revision_id:
            testset_revision = await self.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                testset_revision_ref=Reference(
                    id=testcases_query_request.testset_revision_id
                ),
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
                # Revision not found or has no testcases
                return TestcasesResponse()

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
