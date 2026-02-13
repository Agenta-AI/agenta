from typing import Optional, List, Literal, Dict, Any
from uuid import uuid4, UUID
from json import loads, JSONDecodeError
from io import BytesIO

import orjson
import polars as pl
from pydantic import ValidationError

from fastapi.responses import StreamingResponse
from fastapi import (
    APIRouter,
    Request,
    status,
    UploadFile,
    File,
    Form,
    Query,
    HTTPException,
)

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import set_cache

from oss.src.apis.fastapi.shared.utils import compute_next_windowing

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.testcases.dtos import (
    Testcase,
)
from oss.src.core.testsets.dtos import (
    TestsetFlags,
    TestsetRevisionData,
    SimpleTestset,
    SimpleTestsetCreate,
    SimpleTestsetEdit,
)
from oss.src.core.testsets.service import (
    TestsetsService,
    SimpleTestsetsService,
)

from oss.src.apis.fastapi.testsets.models import (
    TestsetCreateRequest,
    TestsetEditRequest,
    TestsetQueryRequest,
    TestsetResponse,
    TestsetsResponse,
    #
    TestsetVariantCreateRequest,
    TestsetVariantEditRequest,
    TestsetVariantQueryRequest,
    TestsetVariantResponse,
    TestsetVariantsResponse,
    #
    TestsetRevisionCreateRequest,
    TestsetRevisionEditRequest,
    TestsetRevisionQueryRequest,
    TestsetRevisionRetrieveRequest,
    TestsetRevisionCommitRequest,
    TestsetRevisionsLogRequest,
    TestsetRevisionResponse,
    TestsetRevisionsResponse,
    #
    SimpleTestsetCreateRequest,
    SimpleTestsetEditRequest,
    SimpleTestsetQueryRequest,
    SimpleTestsetResponse,
    SimpleTestsetsResponse,
)
from oss.src.apis.fastapi.testsets.utils import (
    csv_file_to_json_array,
    json_file_to_json_array,
    json_array_to_json_object,
    validate_testset_limits,
    TESTSETS_SIZE_EXCEPTION,
    TESTSETS_SIZE_LIMIT,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)

# Exclude alias fields from API responses
TESTSET_REVISION_RESPONSE_EXCLUDE: Dict[str, Any] = {
    "testset_revision": {
        "artifact_id",
        "variant_id",
        "revision_id",
    }
}

TESTSET_REVISIONS_RESPONSE_EXCLUDE: Dict[str, Any] = {
    "testset_revisions": {
        "__all__": {
            "artifact_id",
            "variant_id",
            "revision_id",
        }
    }
}


def _to_plain_dict(value: Any) -> Dict[str, Any]:
    """Convert a value to a plain Python dict, handling Pydantic models."""
    if value is None:
        return {}
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    if isinstance(value, dict):
        return dict(value)  # Make a copy to be safe
    return {}


def _serialize_value(value: Any) -> Any:
    """Serialize a value to a JSON-safe type.

    Handles Pydantic models, dicts, lists, and primitives.
    Returns the serialized value (not a JSON string).
    """
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    if isinstance(value, dict):
        return {k: _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_value(v) for v in value]
    # Fallback: convert to string
    return str(value)


def _serialize_value_for_csv(value: Any) -> Any:
    """Serialize complex values to JSON strings for CSV export.

    Polars cannot serialize dicts, lists, or other complex objects to CSV,
    so we convert them to JSON strings. This includes Pydantic models.
    """
    if value is None:
        return ""
    # Handle primitive types directly
    if isinstance(value, (str, int, float, bool)):
        return value
    # Handle Pydantic models by converting to dict first
    if hasattr(value, "model_dump"):
        return orjson.dumps(value.model_dump()).decode("utf-8")
    if hasattr(value, "dict"):
        return orjson.dumps(value.dict()).decode("utf-8")
    # Handle dicts and lists
    if isinstance(value, (dict, list)):
        return orjson.dumps(value).decode("utf-8")
    # Fallback: convert to string
    return str(value)


def _prepare_testcases_for_csv(
    testcases_data: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Prepare testcases data for CSV export by serializing complex values."""
    return [
        {key: _serialize_value_for_csv(val) for key, val in row.items()}
        for row in testcases_data
    ]


def _drop_empty_export_columns(testcases_data: List[Dict[str, Any]]) -> None:
    """Drop metadata columns that are None for every row (CSV export only)."""
    if not testcases_data:
        return
    for column in ("__flags__", "__tags__", "__meta__"):
        if all(row.get(column) is None for row in testcases_data):
            for row in testcases_data:
                row.pop(column, None)


def _normalize_testcase_dedup_ids(testcases_data: List[Dict[str, Any]]) -> None:
    """Normalize legacy dedup keys to the canonical testcase_dedup_id field."""
    for testcase_data in testcases_data:
        if not isinstance(testcase_data, dict):
            continue
        legacy_dedup_id = testcase_data.pop("__dedup_id__", None)
        existing_dedup_id = testcase_data.get("testcase_dedup_id")
        if legacy_dedup_id not in (None, "") and existing_dedup_id in (None, ""):
            testcase_data["testcase_dedup_id"] = legacy_dedup_id


def _normalize_testcase_dedup_ids_in_request(
    testcases: Optional[List[Testcase]],
) -> None:
    """Normalize CSV-style dedup keys in JSON body requests."""
    for testcase in testcases or []:
        testcase_data = testcase.data
        if not isinstance(testcase_data, dict):
            continue
        legacy_dedup_id = testcase_data.pop("__dedup_id__", None)
        existing_dedup_id = testcase_data.get("testcase_dedup_id")
        if legacy_dedup_id not in (None, "") and existing_dedup_id in (None, ""):
            testcase_data["testcase_dedup_id"] = legacy_dedup_id


def _build_testcase_export_row(testcase: Any) -> Dict[str, Any]:
    """Build a dict for exporting a testcase, properly handling Pydantic models.

    Extracts and serializes all testcase fields into a flat dict suitable for export.
    """
    # Extract the data field - handle both Pydantic models and plain dicts
    data_dict = _to_plain_dict(testcase.data)

    # Serialize all values in the data dict to ensure they're JSON-safe
    serialized_data = {key: _serialize_value(val) for key, val in data_dict.items()}
    if "__dedup_id__" not in serialized_data and "testcase_dedup_id" in serialized_data:
        serialized_data["__dedup_id__"] = serialized_data["testcase_dedup_id"]
    if "__dedup_id__" in serialized_data and "testcase_dedup_id" in serialized_data:
        serialized_data.pop("testcase_dedup_id", None)

    export_row = {
        **serialized_data,
        "__id__": str(testcase.id) if testcase.id else None,
    }

    flags = _serialize_value(testcase.flags)
    tags = _serialize_value(testcase.tags)
    meta = _serialize_value(testcase.meta)

    if flags is not None:
        export_row["__flags__"] = flags
    if tags is not None:
        export_row["__tags__"] = tags
    if meta is not None:
        export_row["__meta__"] = meta

    return export_row


class TestsetsRouter:
    TESTCASES_FLAGS = TestsetFlags(
        has_testcases=True,
        has_traces=False,
    )

    def __init__(self, *, testsets_service: TestsetsService):
        self.testsets_service = testsets_service

        self.router = APIRouter()

        # TESTSETS -------------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_testset,
            methods=["POST"],
            operation_id="create_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{testset_id}",
            self.fetch_testset,
            methods=["GET"],
            operation_id="fetch_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{testset_id}",
            self.edit_testset,
            methods=["PUT"],
            operation_id="edit_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{testset_id}/archive",
            self.archive_testset,
            methods=["POST"],
            operation_id="archive_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{testset_id}/unarchive",
            self.unarchive_testset,
            methods=["POST"],
            operation_id="unarchive_testset",
            status_code=status.HTTP_200_OK,
            response_model=TestsetResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_testsets,
            methods=["POST"],
            operation_id="query_testsets",
            status_code=status.HTTP_200_OK,
            response_model=TestsetsResponse,
            response_model_exclude_none=True,
        )

        # TESTSET VARIANTS -----------------------------------------------------

        self.router.add_api_route(
            "/variants/",
            self.create_testset_variant,
            methods=["POST"],
            operation_id="create_testset_variant",
            status_code=status.HTTP_201_CREATED,
            response_model=TestsetVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{testset_variant_id}",
            self.fetch_testset_variant,
            methods=["GET"],
            operation_id="fetch_testset_variant",
            status_code=status.HTTP_200_OK,
            response_model=TestsetVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{testset_variant_id}",
            self.edit_testset_variant,
            methods=["PUT"],
            operation_id="edit_testset_variant",
            status_code=status.HTTP_200_OK,
            response_model=TestsetVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{testset_variant_id}/archive",
            self.archive_testset_variant,
            methods=["PUT"],
            operation_id="archive_testset_variant",
            status_code=status.HTTP_200_OK,
            response_model=TestsetVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{testset_variant_id}/unarchive",
            self.unarchive_testset_variant,
            methods=["PUT"],
            operation_id="unarchive_testset_variant",
            status_code=status.HTTP_200_OK,
            response_model=TestsetVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/query",
            self.query_testset_variants,
            methods=["POST"],
            operation_id="query_testset_variants",
            status_code=status.HTTP_200_OK,
            response_model=TestsetVariantsResponse,
            response_model_exclude_none=True,
        )

        # TESTSET REVISIONS ----------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_testset_revision,
            methods=["POST"],
            operation_id="retrieve_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/",
            self.create_testset_revision,
            methods=["POST"],
            operation_id="create_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/{testset_revision_id}",
            self.fetch_testset_revision,
            methods=["GET"],
            operation_id="fetch_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/{testset_revision_id}",
            self.edit_testset_revision,
            methods=["PUT"],
            operation_id="edit_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/{testset_revision_id}/archive",
            self.archive_testset_revision,
            methods=["POST"],
            operation_id="archive_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/{testset_revision_id}/unarchive",
            self.unarchive_testset_revision,
            methods=["POST"],
            operation_id="unarchive_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        # POST /api/preview/testsets/revisions/{testset_revision_id}/download
        self.router.add_api_route(
            "/revisions/{testset_revision_id}/download",
            self.fetch_testset_revision_to_file,
            methods=["POST"],
            operation_id="fetch_testset_revision_to_file",
            status_code=status.HTTP_200_OK,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_testset_revisions,
            methods=["POST"],
            operation_id="query_testset_revisions",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionsResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISIONS_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_testset_revision,
            methods=["POST"],
            operation_id="commit_testset_revision",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISION_RESPONSE_EXCLUDE,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_testset_revisions,
            methods=["POST"],
            operation_id="log_testset_revisions",
            status_code=status.HTTP_200_OK,
            response_model=TestsetRevisionsResponse,
            response_model_exclude_none=True,
            response_model_exclude=TESTSET_REVISIONS_RESPONSE_EXCLUDE,
        )

    # TESTSETS -----------------------------------------------------------------

    async def create_testset(
        self,
        request: Request,
        *,
        testset_id: Optional[UUID] = None,
        #
        testset_create_request: TestsetCreateRequest,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.testsets_service.create_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
            #
            testset_create=testset_create_request.testset,
        )

        testset_response = TestsetResponse(
            count=1 if testset else 0,
            testset=testset,
        )

        return testset_response

    async def fetch_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=Reference(id=testset_id),
        )

        testset_response = TestsetResponse(
            count=1 if testset else 0,
            testset=testset,
        )

        return testset_response

    async def edit_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
        #
        testset_edit_request: TestsetEditRequest,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(testset_id) != str(testset_edit_request.testset.id):
            return TestsetResponse()

        testset = await self.testsets_service.edit_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_edit=testset_edit_request.testset,
        )

        testset_response = TestsetResponse(
            count=1 if testset else 0,
            testset=testset,
        )

        return testset_response

    async def archive_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.testsets_service.archive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        testset_response = TestsetResponse(
            count=1 if testset else 0,
            testset=testset,
        )

        return testset_response

    async def unarchive_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> TestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.testsets_service.unarchive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        testset_response = TestsetResponse(
            count=1 if testset else 0,
            testset=testset,
        )

        return testset_response

    async def query_testsets(
        self,
        request: Request,
        *,
        testset_query_request: TestsetQueryRequest,
    ) -> TestsetsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testsets = await self.testsets_service.query_testsets(
            project_id=UUID(request.state.project_id),
            #
            testset_query=testset_query_request.testset,
            #
            testset_refs=testset_query_request.testset_refs,
            #
            include_archived=testset_query_request.include_archived,
            #
            windowing=testset_query_request.windowing,
        )

        next_windowing = compute_next_windowing(
            entities=testsets,
            attribute="id",  # UUID7 - use id for cursor-based pagination
            windowing=testset_query_request.windowing,
        )

        testsets_response = TestsetsResponse(
            count=len(testsets),
            testsets=testsets,
            windowing=next_windowing,
        )

        return testsets_response

    # TESTSET VARIANTS ---------------------------------------------------------

    async def create_testset_variant(
        self,
        request: Request,
        *,
        testset_variant_create_request: TestsetVariantCreateRequest,
    ) -> TestsetVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_variant = await self.testsets_service.create_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_create=testset_variant_create_request.testset_variant,
        )

        testset_variant_response = TestsetVariantResponse(
            count=1 if testset_variant else 0,
            testset_variant=testset_variant,
        )

        return testset_variant_response

    async def fetch_testset_variant(
        self, request: Request, *, testset_variant_id: UUID
    ) -> TestsetVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_variant = await self.testsets_service.fetch_testset_variant(
            project_id=UUID(request.state.project_id),
            #
            testset_variant_ref=Reference(id=testset_variant_id),
        )

        testset_variant_response = TestsetVariantResponse(
            count=1 if testset_variant else 0,
            testset_variant=testset_variant,
        )

        return testset_variant_response

    async def edit_testset_variant(
        self,
        request: Request,
        *,
        testset_variant_id: UUID,
        #
        testset_variant_edit_request: TestsetVariantEditRequest,
    ) -> TestsetVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(testset_variant_id) != str(
            testset_variant_edit_request.testset_variant.id
        ):
            return TestsetVariantResponse()

        testset_variant = await self.testsets_service.edit_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_edit=testset_variant_edit_request.testset_variant,
        )

        testset_variant_response = TestsetVariantResponse(
            count=1 if testset_variant else 0,
            testset_variant=testset_variant,
        )

        return testset_variant_response

    async def archive_testset_variant(
        self,
        request: Request,
        *,
        testset_variant_id: UUID,
    ) -> TestsetVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_variant = await self.testsets_service.archive_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_id=testset_variant_id,
        )

        testset_variant_response = TestsetVariantResponse(
            count=1 if testset_variant else 0,
            testset_variant=testset_variant,
        )

        return testset_variant_response

    async def unarchive_testset_variant(
        self,
        request: Request,
        *,
        testset_variant_id: UUID,
    ) -> TestsetVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_variant = await self.testsets_service.unarchive_testset_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_variant_id=testset_variant_id,
        )

        testset_variant_response = TestsetVariantResponse(
            count=1 if testset_variant else 0,
            testset_variant=testset_variant,
        )

        return testset_variant_response

    async def query_testset_variants(
        self,
        request: Request,
        *,
        testset_variant_query_request: TestsetVariantQueryRequest,
    ) -> TestsetVariantsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_variants = await self.testsets_service.query_variants(
            project_id=UUID(request.state.project_id),
            #
            testset_variant_query=testset_variant_query_request.testset_variant,
            #
            testset_refs=testset_variant_query_request.testset_refs,
            testset_variant_refs=testset_variant_query_request.testset_variant_refs,
            #
            include_archived=testset_variant_query_request.include_archived,
            #
            windowing=testset_variant_query_request.windowing,
        )

        testset_variant_response = TestsetVariantsResponse(
            count=len(testset_variants),
            testset_variants=testset_variants,
        )

        return testset_variant_response

    # TESTSET REVISIONS --------------------------------------------------------

    async def retrieve_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_retrieve_request: TestsetRevisionRetrieveRequest,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        cache_key = {
            "artifact_ref": testset_revision_retrieve_request.testset_ref,  # type: ignore
            "variant_ref": testset_revision_retrieve_request.testset_variant_ref,  # type: ignore
            "revision_ref": testset_revision_retrieve_request.testset_revision_ref,  # type: ignore
        }

        testset_revision = None
        # testset_revision = await get_cache(
        #     namespace="testsets:retrieve",
        #     project_id=request.state.project_id,
        #     user_id=request.state.user_id,
        #     key=cache_key,
        #     model=TestsetRevision,
        # )

        if not testset_revision:
            testset_revision = await self.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                #
                testset_ref=testset_revision_retrieve_request.testset_ref,  # type: ignore
                testset_variant_ref=testset_revision_retrieve_request.testset_variant_ref,  # type: ignore
                testset_revision_ref=testset_revision_retrieve_request.testset_revision_ref,  # type: ignore
                include_testcases=testset_revision_retrieve_request.include_testcases,
            )

            await set_cache(
                namespace="testsets:retrieve",
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                key=cache_key,
                value=testset_revision,
            )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def create_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_create_request: TestsetRevisionCreateRequest,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revision = await self.testsets_service.create_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_create=testset_revision_create_request.testset_revision,
            include_testcases=testset_revision_create_request.include_testcases,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def fetch_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_id: UUID,
        include_testcases: Optional[bool] = Query(
            None,
            description="Include full testcase objects. Default (null/true): include testcases. False: return only testcase IDs.",
        ),
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revision = await self.testsets_service.fetch_testset_revision(
            project_id=UUID(request.state.project_id),
            #
            testset_revision_ref=Reference(id=testset_revision_id),
            include_testcases=include_testcases,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def edit_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_id: UUID,
        #
        testset_revision_edit_request: TestsetRevisionEditRequest,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(testset_revision_id) != str(
            testset_revision_edit_request.testset_revision.id
        ):
            return TestsetRevisionResponse()

        testset_revision = await self.testsets_service.edit_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_edit=testset_revision_edit_request.testset_revision,
            include_testcases=testset_revision_edit_request.include_testcases,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def archive_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_id: UUID,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revision = await self.testsets_service.archive_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_id=testset_revision_id,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def unarchive_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_id: UUID,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revision = await self.testsets_service.unarchive_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_id=testset_revision_id,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    @intercept_exceptions()
    async def fetch_testset_revision_to_file(
        self,
        request: Request,
        *,
        testset_revision_id: UUID,
        #
        file_type: Optional[Literal["csv", "json"]] = Query(
            "csv",
            description="File type to download. Supported: 'csv' or 'json'. Default: 'csv'.",
        ),
        file_name: Optional[str] = Query(
            None,
            description="Optional custom filename for the download.",
        ),
    ) -> StreamingResponse:  # type: ignore
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        # Fetch the revision with testcases
        testset_revision_response = await self.fetch_testset_revision(
            request=request,
            testset_revision_id=testset_revision_id,
            include_testcases=True,
        )

        if (
            not testset_revision_response.count
            or not testset_revision_response.testset_revision
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Testset revision not found. Please check the revision_id and try again.",
            )

        revision = testset_revision_response.testset_revision

        filename = (
            file_name or f"revision_{testset_revision_id}"
        ) + f".{file_type.lower()}"
        testcases = revision.data.testcases if revision.data else []

        # Build export data using helper that properly handles Pydantic models
        testcases_data = [
            _build_testcase_export_row(testcase) for testcase in testcases or []
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
            _drop_empty_export_columns(testcases_data)
            csv_data = _prepare_testcases_for_csv(testcases_data)
            pl.DataFrame(csv_data).write_csv(buffer)
            buffer.seek(0)

            return StreamingResponse(
                buffer,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

    async def query_testset_revisions(
        self,
        request: Request,
        *,
        testset_revision_query_request: TestsetRevisionQueryRequest,
    ) -> TestsetRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revisions = await self.testsets_service.query_testset_revisions(
            project_id=UUID(request.state.project_id),
            #
            testset_revision_query=testset_revision_query_request.testset_revision,
            #
            testset_refs=testset_revision_query_request.testset_refs,
            testset_variant_refs=testset_revision_query_request.testset_variant_refs,
            testset_revision_refs=testset_revision_query_request.testset_revision_refs,
            #
            include_archived=testset_revision_query_request.include_archived,
            include_testcases=testset_revision_query_request.include_testcases,
            #
            windowing=testset_revision_query_request.windowing,
        )

        testset_revisions_response = TestsetRevisionsResponse(
            count=len(testset_revisions),
            testset_revisions=testset_revisions,
        )

        return testset_revisions_response

    async def commit_testset_revision(
        self,
        request: Request,
        *,
        testset_revision_commit_request: TestsetRevisionCommitRequest,
    ) -> TestsetRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        commit = testset_revision_commit_request.testset_revision_commit
        if commit.data and commit.delta:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide either data or delta for a commit, not both.",
            )
        if not commit.data and not commit.delta:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide either data or delta for a commit.",
            )

        testset_revision = await self.testsets_service.commit_testset_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_revision_commit=commit,
            include_testcases=testset_revision_commit_request.include_testcases,
        )

        testset_revision_response = TestsetRevisionResponse(
            count=1 if testset_revision else 0,
            testset_revision=testset_revision,
        )

        return testset_revision_response

    async def log_testset_revisions(
        self,
        request: Request,
        *,
        testset_revisions_log_request: TestsetRevisionsLogRequest,
    ) -> TestsetRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset_revisions = await self.testsets_service.log_testset_revisions(
            project_id=UUID(request.state.project_id),
            #
            testset_revisions_log=testset_revisions_log_request.testset_revision,
            include_testcases=testset_revisions_log_request.include_testcases,
        )

        testset_revisions_response = TestsetRevisionsResponse(
            count=len(testset_revisions),
            testset_revisions=testset_revisions,
        )

        return testset_revisions_response


class SimpleTestsetsRouter:
    TESTCASES_FLAGS = TestsetFlags(
        has_testcases=True,
        has_traces=False,
    )

    def __init__(
        self,
        *,
        simple_testsets_service: SimpleTestsetsService,
    ):
        self.simple_testsets_service = simple_testsets_service

        self.router = APIRouter()

        # SIMPLE TESTSETS ------------------------------------------------------

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

    # SIMPLE TESTSETS ----------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_testset(
        self,
        request: Request,
        *,
        testset_id: Optional[UUID] = None,
        #
        simple_testset_create_request: SimpleTestsetCreateRequest,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _normalize_testcase_dedup_ids_in_request(
            simple_testset_create_request.testset.data.testcases
        )

        simple_testset = await self.simple_testsets_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
            #
            simple_testset_create_request=simple_testset_create_request,
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetResponse(), exclude=[HTTPException])
    async def fetch_simple_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.simple_testsets_service.testsets_service.fetch_testset(
            project_id=UUID(request.state.project_id),
            #
            testset_ref=Reference(id=testset_id),
        )

        if testset is None:
            return SimpleTestsetResponse()

        testset_variant = (
            await self.simple_testsets_service.testsets_service.fetch_testset_variant(
                project_id=UUID(request.state.project_id),
                #
                testset_ref=Reference(id=testset.id),
            )
        )

        if testset_variant is None:
            return SimpleTestsetResponse()

        testset_revision = (
            await self.simple_testsets_service.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                #
                testset_variant_ref=Reference(id=testset_variant.id),
            )
        )

        if testset_revision is None:
            return SimpleTestsetResponse()

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
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def edit_simple_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
        #
        simple_testset_edit_request: SimpleTestsetEditRequest,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(testset_id) != str(simple_testset_edit_request.testset.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Testset ID in path does not match testset ID in request body.",
            )

        # Check if testset exists before attempting to edit
        existing_testset = (
            await self.simple_testsets_service.testsets_service.fetch_testset(
                project_id=UUID(request.state.project_id),
                testset_ref=Reference(id=testset_id),
            )
        )

        if existing_testset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Testset with ID '{testset_id}' does not exist.",
            )

        _normalize_testcase_dedup_ids_in_request(
            simple_testset_edit_request.testset.data.testcases
        )

        simple_testset: Optional[
            SimpleTestset
        ] = await self.simple_testsets_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_testset_edit_request=simple_testset_edit_request,
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def archive_simple_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.simple_testsets_service.testsets_service.archive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        if not testset:
            return SimpleTestsetResponse()

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
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    async def unarchive_simple_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testset = await self.simple_testsets_service.testsets_service.unarchive_testset(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        if not testset:
            return SimpleTestsetResponse()

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
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetsResponse(), exclude=[HTTPException])
    async def list_simple_testsets(
        self,
        request: Request,
    ) -> SimpleTestsetsResponse:
        simple_testset_query_request = SimpleTestsetQueryRequest()

        return await self.query_simple_testsets(
            request=request,
            #
            simple_testset_query_request=simple_testset_query_request,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetsResponse(), exclude=[HTTPException])
    async def query_simple_testsets(
        self,
        request: Request,
        *,
        simple_testset_query_request: SimpleTestsetQueryRequest,
    ) -> SimpleTestsetsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        testsets = await self.simple_testsets_service.testsets_service.query_testsets(
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

        simple_testsets: List[SimpleTestset] = []

        for testset in testsets:
            testset_variant = await self.simple_testsets_service.testsets_service.fetch_testset_variant(
                project_id=UUID(request.state.project_id),
                #
                testset_ref=Reference(id=testset.id),
            )

            if not testset_variant:
                continue

            testset_revision = await self.simple_testsets_service.testsets_service.fetch_testset_revision(
                project_id=UUID(request.state.project_id),
                #
                testset_variant_ref=Reference(id=testset_variant.id),
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
        request: Request,
        *,
        file: UploadFile = File(...),
        file_type: Literal["csv", "json"] = Form("csv"),
        testset_slug: Optional[str] = Form(None),
        testset_name: Optional[str] = File(None),
        testset_description: Optional[str] = Form(None),
        testset_tags: Optional[str] = Form(None),
        testset_meta: Optional[str] = Form(None),
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        if (file.size or 0) > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        # deserialize tags and meta if provided
        try:
            _testset_tags = loads(testset_tags) if testset_tags else None
            _testset_meta = loads(testset_meta) if testset_meta else None
        except JSONDecodeError as e:
            log.error(e)
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse tags or meta as JSON: {e}",
            ) from e

        testcases = []
        testcases_data = {}

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
            _normalize_testcase_dedup_ids(testcases_data)
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
                slug=testset_slug or uuid4().hex[-12:],
                #
                name=testset_name or testset_slug or None,
                description=testset_description,
                #
                # flags =
                tags=_testset_tags,
                meta=_testset_meta,
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
        request: Request,
        *,
        testset_id: UUID,
        #
        file: UploadFile = File(...),
        file_type: Literal["csv", "json"] = Form("csv"),
        testset_name: Optional[str] = File(None),
        testset_description: Optional[str] = Form(None),
        testset_tags: Optional[str] = Form(None),
        testset_meta: Optional[str] = Form(None),
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'CSV' and 'JSON'.",
            )

        if (file.size or 0) > TESTSETS_SIZE_LIMIT:  # Preemptively check file size
            raise TESTSETS_SIZE_EXCEPTION

        # deserialize tags and meta if provided
        try:
            _testset_tags = loads(testset_tags) if testset_tags else None
            _testset_meta = loads(testset_meta) if testset_meta else None
        except JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to parse tags or meta as JSON: {e}",
            ) from e

        testcases = []
        testcases_data = {}

        if file_type.lower() == "json":
            try:
                testcases_data = await json_file_to_json_array(json_file=file)

            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to read JSON file: {e}",
                ) from e

        elif file_type.lower() == "csv":
            try:
                testcases_data = await csv_file_to_json_array(csv_file=file)

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
            _normalize_testcase_dedup_ids(testcases_data)
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
                tags=_testset_tags or simple_testset_response.testset.tags,
                meta=_testset_meta or simple_testset_response.testset.meta,
                #
                data=testset_revision_data,
            )
        )

        return await self.edit_simple_testset(
            request=request,
            #
            testset_id=testset_id,
            #
            simple_testset_edit_request=simple_testset_edit_request,
        )

    @intercept_exceptions()
    async def fetch_simple_testset_to_file(
        self,
        request: Request,
        *,
        testset_id: UUID,
        #
        file_type: Optional[Literal["csv", "json"]] = None,
        file_name: Optional[str] = None,
    ) -> StreamingResponse:  # type: ignore
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if file_type is None or file_type not in ["csv", "json"]:
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

        simple_testset_response = await self.fetch_simple_testset(
            request=request,
            #
            testset_id=testset_id,
        )

        if not simple_testset_response.count and not simple_testset_response.testset:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple testset not found. Please check the testset_id and try again.",
            )

        testset = simple_testset_response.testset

        filename = (file_name or f"testset_{testset_id}") + f".{file_type.lower()}"
        testcases = testset.data.testcases

        # Build export data using helper that properly handles Pydantic models
        testcases_data = [
            _build_testcase_export_row(testcase) for testcase in testcases or []
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
            _drop_empty_export_columns(testcases_data)
            csv_data = _prepare_testcases_for_csv(testcases_data)
            df = pl.DataFrame(csv_data)
            df.write_csv(buffer)
            buffer.seek(0)

            return StreamingResponse(
                buffer,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"},
            )

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file type. Supported types are 'csv' and 'json'.",
            )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleTestsetResponse(), exclude=[HTTPException])
    async def transfer_simple_testset(
        self,
        request: Request,
        *,
        testset_id: UUID,
    ) -> SimpleTestsetResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_TESTSETS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_testset = await self.simple_testsets_service.transfer(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            testset_id=testset_id,
        )

        simple_testset_response = SimpleTestsetResponse(
            count=1 if simple_testset else 0,
            testset=simple_testset,
        )

        return simple_testset_response
