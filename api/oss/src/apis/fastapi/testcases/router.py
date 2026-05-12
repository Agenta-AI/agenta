from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Query, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.apis.fastapi.shared.utils import compute_next_windowing
from oss.src.core.shared.dtos import Windowing

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

    __test__ = False

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
        has_testset_refs = bool(
            testset_revision_ref
            or testcases_query_request.testset_variant_ref
            or testcases_query_request.testset_ref
        )

        # If any ref is provided, resolve the revision to get its testcase_ids
        if has_testset_refs:
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
            if testset_revision and testset_revision.data:
                testset_id = testset_revision.testset_id
                testcase_ids = testset_revision.data.testcase_ids or []
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

        # B.2 by testset refs should mirror A.2 semantics:
        # pagination is applied to the revision's deterministic testcase_ids list.
        if has_testset_refs and testcase_ids is not None:
            paged_ids, has_more = self._paginate_ids(
                ids=testcase_ids,
                windowing=testcases_query_request.windowing,
            )
            testcases = await self.testcases_service.fetch_testcases(
                project_id=UUID(request.state.project_id),
                testcase_ids=paged_ids,
            )
            next_windowing = self._next_windowing_from_ids(
                paged_ids=paged_ids,
                windowing=testcases_query_request.windowing,
                has_more=has_more,
            )
        else:
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

    @staticmethod
    def _paginate_ids(
        *,
        ids: List[UUID],
        windowing: Optional[Windowing],
    ) -> tuple[List[UUID], bool]:
        if not windowing:
            return list(ids), False

        ordered_ids = list(ids)
        if windowing.order == "descending":
            ordered_ids.reverse()

        if windowing.next is not None:
            try:
                next_index = ordered_ids.index(windowing.next)
                ordered_ids = ordered_ids[next_index + 1 :]
            except ValueError:
                return [], False

        if windowing.limit is None:
            return ordered_ids, False

        has_more = len(ordered_ids) > windowing.limit
        return ordered_ids[: windowing.limit], has_more

    @staticmethod
    def _next_windowing_from_ids(
        *,
        paged_ids: List[UUID],
        windowing: Optional[Windowing],
        has_more: bool,
    ) -> Optional[Windowing]:
        if (
            not windowing
            or windowing.limit is None
            or len(paged_ids) == 0
            or not has_more
        ):
            return None

        return Windowing(
            newest=windowing.newest,
            oldest=windowing.oldest,
            next=paged_ids[-1],
            limit=windowing.limit,
            order=windowing.order,
        )
