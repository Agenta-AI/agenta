from typing import Dict, Any, Optional, Literal, List
from uuid import UUID
from datetime import datetime
from json import dumps
from io import BytesIO
from hashlib import blake2b as digest

import orjson as oj
import polars as pl

from fastapi import HTTPException, Query

from oss.src.utils.logging import get_module_logger

from oss.src.apis.fastapi.shared.utils import parse_metadata
from oss.src.apis.fastapi.testsets.models import (
    TestsetQueryRequest,
    TestsetVariantQueryRequest,
    TestsetRevisionQueryRequest,
    TestsetRevisionRetrieveRequest,
)

from oss.src.core.blobs.utils import compute_blob_id
from oss.src.core.shared.dtos import Windowing, Reference
from oss.src.core.testsets.dtos import (
    TestsetFlags,
    #
    TestsetQuery,
    TestsetVariantQuery,
    TestsetRevisionQuery,
)


log = get_module_logger(__name__)


def parse_testset_query_request_from_params(
    testset_id: Optional[UUID] = Query(None),
    testset_ids: Optional[List[UUID]] = Query(None),
    testset_slug: Optional[str] = Query(None),
    testset_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> TestsetQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = TestsetFlags(**_flags) if _flags else None  # type: ignore

    testset = (
        TestsetQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    testset_refs = (
        (
            [
                Reference(
                    id=testset_id,
                    slug=testset_slug,
                )
            ]
            if testset_id or testset_slug
            else []
        )
        + (
            [
                Reference(
                    id=testset_id,
                    slug=testset_slug,
                )
                for testset_id, testset_slug in zip(
                    testset_ids,
                    testset_slugs,
                )
            ]
            if testset_ids and testset_slugs
            else []
        )
    ) or None

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_testset_query_request_from_body(
        testset=testset,
        #
        testset_refs=testset_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_testset_query_request_from_body(
    testset: Optional[TestsetQuery] = None,
    #
    testset_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> TestsetQueryRequest:
    testset_query_request = None

    try:
        testset_query_request = TestsetQueryRequest(
            testset=testset,
            #
            testset_refs=testset_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        testset_query_request = TestsetQueryRequest()

    return testset_query_request


def merge_testset_query_requests(
    query_request_params: Optional[TestsetQueryRequest] = None,
    query_request_body: Optional[TestsetQueryRequest] = None,
) -> TestsetQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return TestsetQueryRequest(
            testset=query_request_body.testset or query_request_params.testset,
            #
            testset_refs=query_request_body.testset_refs
            or query_request_params.testset_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return TestsetQueryRequest()


def parse_testset_variant_query_request_from_params(
    testset_id: Optional[UUID] = Query(None),
    testset_ids: Optional[List[UUID]] = Query(None),
    testset_slug: Optional[str] = Query(None),
    testset_slugs: Optional[List[str]] = Query(None),
    #
    testset_variant_id: Optional[UUID] = Query(None),
    testset_variant_ids: Optional[List[UUID]] = Query(None),
    testset_variant_slug: Optional[str] = Query(None),
    testset_variant_slugs: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> TestsetVariantQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = TestsetFlags(**_flags) if _flags else None  # type: ignore

    testset_variant = (
        TestsetVariantQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    testset_refs = (
        (
            [
                Reference(
                    id=testset_id,
                    slug=testset_slug,
                )
            ]
            if testset_id or testset_slug
            else []
        )
        + (
            [
                Reference(
                    id=testset_id,
                    slug=testset_slug,
                )
                for testset_id, testset_slug in zip(
                    testset_ids,
                    testset_slugs,
                )
            ]
            if testset_ids and testset_slugs
            else []
        )
    ) or None

    testset_variant_refs = (
        (
            [
                Reference(
                    id=testset_variant_id,
                    slug=testset_variant_slug,
                )
            ]
            if testset_variant_id or testset_variant_slug
            else []
        )
        + (
            [
                Reference(
                    id=testset_variant_id,
                    slug=testset_variant_slug,
                )
                for testset_variant_id, testset_variant_slug in zip(
                    testset_variant_ids,
                    testset_variant_slugs,
                )
            ]
            if testset_variant_ids and testset_variant_slugs
            else []
        )
    ) or None

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_testset_variant_query_request_from_body(
        testset_variant=testset_variant,
        #
        testset_refs=testset_refs or None,
        testset_variant_refs=testset_variant_refs or None,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_testset_variant_query_request_from_body(
    testset_variant: Optional[TestsetVariantQuery] = None,
    #
    testset_refs: Optional[List[Reference]] = None,
    testset_variant_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> TestsetVariantQueryRequest:
    testset_variant_query_request = None

    try:
        testset_variant_query_request = TestsetVariantQueryRequest(
            testset_variant=testset_variant,
            #
            testset_refs=testset_refs,
            testset_variant_refs=testset_variant_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )
    except Exception:  # pylint: disable=broad-except
        testset_variant_query_request = TestsetVariantQueryRequest()

    return testset_variant_query_request


def merge_testset_variant_query_requests(
    query_request_params: Optional[TestsetVariantQueryRequest] = None,
    query_request_body: Optional[TestsetVariantQueryRequest] = None,
) -> TestsetVariantQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return TestsetVariantQueryRequest(
            testset_variant=query_request_body.testset_variant
            or query_request_params.testset_variant,
            #
            testset_refs=query_request_body.testset_refs
            or query_request_params.testset_refs,
            testset_variant_refs=query_request_body.testset_variant_refs
            or query_request_params.testset_variant_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return TestsetVariantQueryRequest()


def parse_testset_revision_query_request_from_params(
    testset_id: Optional[UUID] = Query(None),
    testset_ids: Optional[List[UUID]] = Query(None),
    testset_slug: Optional[str] = Query(None),
    testset_slugs: Optional[List[str]] = Query(None),
    #
    testset_variant_id: Optional[UUID] = Query(None),
    testset_variant_ids: Optional[List[UUID]] = Query(None),
    testset_variant_slug: Optional[str] = Query(None),
    testset_variant_slugs: Optional[List[str]] = Query(None),
    #
    testset_revision_id: Optional[UUID] = Query(None),
    testset_revision_ids: Optional[List[UUID]] = Query(None),
    testset_revision_slug: Optional[str] = Query(None),
    testset_revision_slugs: Optional[List[str]] = Query(None),
    testset_revision_version: Optional[str] = Query(None),
    testset_revision_versions: Optional[List[str]] = Query(None),
    #
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    #
    flags: Optional[str] = Query(None),
    tags: Optional[str] = Query(None),
    meta: Optional[str] = Query(None),
    #
    include_archived: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),  # pylint disable=redefined-builtin
    newest: Optional[datetime] = Query(None),
    oldest: Optional[datetime] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> TestsetRevisionQueryRequest:
    _flags, _tags, _meta = parse_metadata(flags, tags, meta)

    __flags = TestsetFlags(**_flags) if _flags else None  # type: ignore

    testset_revision = (
        TestsetRevisionQuery(
            name=name,
            description=description,
            #
            flags=__flags,
            meta=_meta,
            tags=_tags,
        )
        if __flags or _meta or _tags
        else None
    )

    testset_refs = (
        [
            Reference(
                id=testset_id,
                slug=testset_slug,
            )
        ]
        if testset_id or testset_slug
        else []
    ) + (
        [
            Reference(
                id=testset_id,
                slug=testset_slug,
            )
            for testset_id, testset_slug in zip(
                testset_ids,
                testset_slugs,
            )
        ]
        if testset_ids and testset_slugs
        else []
    )

    testset_variant_refs = (
        [
            Reference(
                id=testset_variant_id,
                slug=testset_variant_slug,
            )
        ]
        if testset_variant_id or testset_variant_slug
        else []
    ) + (
        [
            Reference(
                id=testset_variant_id,
                slug=testset_variant_slug,
            )
            for testset_variant_id, testset_variant_slug in zip(
                testset_variant_ids,
                testset_variant_slugs,
            )
        ]
        if testset_variant_ids and testset_variant_slugs
        else []
    )

    testset_revision_refs = (
        [
            Reference(
                id=testset_revision_id,
                slug=testset_revision_slug,
                version=testset_revision_version,
            )
        ]
        if testset_revision_id or testset_revision_slug or testset_revision_version
        else []
    ) + (
        [
            Reference(
                id=testset_revision_id,
                slug=testset_revision_slug,
                version=testset_revision_version,
            )
            for testset_revision_id, testset_revision_slug, testset_revision_version in zip(
                testset_revision_ids,
                testset_revision_slugs,
                testset_revision_versions,
            )
        ]
        if testset_revision_ids and testset_revision_slugs and testset_revision_versions
        else []
    )

    windowing = (
        Windowing(
            next=next,
            newest=newest,
            oldest=oldest,
            limit=limit,
            order=order,
        )
        if next or newest or oldest or limit or order
        else None
    )

    return parse_testset_revision_query_request_from_body(
        testset_revision=testset_revision,
        #
        testset_refs=testset_refs,
        testset_variant_refs=testset_variant_refs,
        testset_revision_refs=testset_revision_refs,
        #
        include_archived=include_archived,
        #
        windowing=windowing,
    )


def parse_testset_revision_query_request_from_body(
    testset_revision: Optional[TestsetRevisionQuery] = None,
    #
    testset_refs: Optional[List[Reference]] = None,
    testset_variant_refs: Optional[List[Reference]] = None,
    testset_revision_refs: Optional[List[Reference]] = None,
    #
    include_archived: Optional[bool] = None,
    #
    windowing: Optional[Windowing] = None,
) -> TestsetRevisionQueryRequest:
    testset_revision_query_request = None

    try:
        testset_revision_query_request = TestsetRevisionQueryRequest(
            testset_revision=testset_revision,
            #
            testset_refs=testset_refs,
            testset_variant_refs=testset_variant_refs,
            testset_revision_refs=testset_revision_refs,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        testset_revision_query_request = TestsetRevisionQueryRequest()

    return testset_revision_query_request


def merge_testset_revision_query_requests(
    query_request_params: Optional[TestsetRevisionQueryRequest] = None,
    query_request_body: Optional[TestsetRevisionQueryRequest] = None,
) -> TestsetRevisionQueryRequest:
    if query_request_params and not query_request_body:
        return query_request_params

    if not query_request_params and query_request_body:
        return query_request_body

    if query_request_params and query_request_body:
        return TestsetRevisionQueryRequest(
            testset_revision=query_request_body.testset_revision
            or query_request_params.testset_revision,
            #
            testset_refs=query_request_body.testset_refs
            or query_request_params.testset_refs,
            testset_variant_refs=query_request_body.testset_variant_refs
            or query_request_params.testset_variant_refs,
            testset_revision_refs=query_request_body.testset_revision_refs
            or query_request_params.testset_revision_refs,
            #
            include_archived=(
                query_request_body.include_archived
                if query_request_body.include_archived is not None
                else query_request_params.include_archived
            ),
            #
            windowing=query_request_body.windowing or query_request_params.windowing,
        )

    return TestsetRevisionQueryRequest()


def parse_testset_revision_retrieve_request_from_params(
    testset_id: Optional[UUID] = Query(None),
    testset_slug: Optional[str] = Query(None),
    #
    testset_variant_id: Optional[UUID] = Query(None),
    testset_variant_slug: Optional[str] = Query(None),
    #
    testset_revision_id: Optional[UUID] = Query(None),
    testset_revision_slug: Optional[str] = Query(None),
    testset_revision_version: Optional[str] = Query(None),
    #
    include_testcases: Optional[bool] = Query(None),
):
    testset_ref = (
        Reference(
            id=testset_id,
            slug=testset_slug,
        )
        if testset_id or testset_slug
        else None
    )

    testset_variant_ref = (
        Reference(
            id=testset_variant_id,
            slug=testset_variant_slug,
        )
        if testset_variant_id or testset_variant_slug
        else None
    )

    testset_revision_ref = (
        Reference(
            id=testset_revision_id,
            slug=testset_revision_slug,
            version=testset_revision_version,
        )
        if testset_revision_id or testset_revision_slug or testset_revision_version
        else None
    )

    return parse_testset_revision_retrieve_request_from_body(
        testset_ref=testset_ref,
        testset_variant_ref=testset_variant_ref,
        testset_revision_ref=testset_revision_ref,
        include_testcases=include_testcases,
    )


def parse_testset_revision_retrieve_request_from_body(
    testset_ref: Optional[Reference] = None,
    testset_variant_ref: Optional[Reference] = None,
    testset_revision_ref: Optional[Reference] = None,
    include_testcases: Optional[bool] = None,
) -> TestsetRevisionRetrieveRequest:
    return TestsetRevisionRetrieveRequest(
        testset_ref=testset_ref,
        testset_variant_ref=testset_variant_ref,
        testset_revision_ref=testset_revision_ref,
        include_testcases=include_testcases,
    )


# ---------------------------------------------------------------------------- #


TESTSETS_COUNT_LIMIT = 10 * 1_000  # 10,000 testcases per testset
TESTSETS_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MB per testset

TESTSETS_COUNT_WARNING = f"Testset exceeds the maximum count of {TESTSETS_COUNT_LIMIT} testcases per testset."
TESTSETS_SIZE_WARNING = f"Testset exceeds the maximum size of {TESTSETS_SIZE_LIMIT // (1024 * 1024)} MB per testset."

TESTSETS_SIZE_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_SIZE_WARNING,
)

TESTSETS_COUNT_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_COUNT_WARNING,
)


def validate_testset_limits(rows: List[dict]) -> tuple[int, int]:
    i = -1
    total_size = 2
    for i, row in enumerate(rows):
        row_str = dumps(row)
        total_size += len(row_str.encode("utf-8"))
        if i > 0:
            total_size += 1
        if i + 1 > TESTSETS_COUNT_LIMIT:
            log.error(TESTSETS_COUNT_WARNING)
            raise TESTSETS_COUNT_EXCEPTION
        if total_size > TESTSETS_SIZE_LIMIT:
            log.error(TESTSETS_SIZE_WARNING)
            raise TESTSETS_SIZE_EXCEPTION
    return i + 1, total_size


def to_uuid(id, data):
    """Ensure value is a valid UUID; generate a new one if missing/invalid."""
    try:
        return str(UUID(str(id)))  # Convert valid UUID to string
    except ValueError:
        return str(compute_blob_id(blob_data=data))


async def json_file_to_json_array(
    json_file,
):
    """Reads a JSON file from path or UploadFile and returns the parsed data."""
    try:
        if hasattr(json_file, "read"):  # Covers UploadFile or similar
            content = await json_file.read()  # Read async
            return oj.loads(content)
        else:
            raise TypeError("Unsupported file type")
    except oj.JSONDecodeError as e:
        log.error("[TESTSETS] Invalid JSON format", exc_info=True)
        raise e
    except Exception as e:
        log.error("[TESTSETS] Unexpected issue", exc_info=True)
        raise e


def json_array_to_json_file(
    json_file,
    data,
):
    """Writes JSON data to a file."""
    try:
        with open(json_file, "wb") as f:
            f.write(
                oj.dumps(
                    data,
                    option=oj.OPT_INDENT_2,
                )
            )  # Pretty-print JSON
    except Exception as e:
        log.error("[TESTSETS] Could not write to file", exc_info=True)
        raise e


def json_array_to_json_object(
    data,
    testcase_id_key="testcase_id",
    testcase_dedup_id_key="testcase_dedup_id",
):
    """
    Transforms a list of JSON objects into a dictionary using `testcase_id` as key.
    - Generates a UUID if `testcase_id` is missing or invalid.
    - Removes `testcase_id` from the final JSON object.

    Args:
        data (list): List of JSON objects.
        testcase_id_key (str, optional): Key to use as dictionary key. Defaults to "testcase_id".

    Returns:
        dict: Dictionary with `testcase_id` as keys.
    """
    if not isinstance(data, list):
        log.warning("[TESTSETS] Expected a list.")
        return None

    transformed_data = {}

    for testcase_idx, testcase_data in enumerate(data):
        if not isinstance(testcase_data, dict):
            continue  # Ignore non-dict entries

        testcase_dedup_id = testcase_data.pop(testcase_dedup_id_key, None)

        testcase_id_str = testcase_data.pop(testcase_id_key, None)

        testcase_id = to_uuid(testcase_id_str, testcase_data)

        testcase_dedup_id = (
            testcase_dedup_id
            or digest(
                f"{testcase_id}:{testcase_idx}".encode(),
                digest_size=6,
            ).hexdigest()
        )

        if testcase_dedup_id_key is not None:
            testcase_data[testcase_dedup_id_key] = testcase_dedup_id

        testcase_id = to_uuid(testcase_id_str, testcase_data)

        transformed_data[testcase_id] = testcase_data

    return transformed_data


def json_object_to_json_array(
    data,
    testcase_id_key="testcase_id",
):
    """
    Transforms a dictionary back into a list of JSON objects.
    - Reintroduces `testcase_id` into each object.

    Args:
        data (dict): Dictionary where keys are `testcase_id`.

    Returns:
        list: List of JSON objects with `testcase_id` reintroduced.
    """
    if not isinstance(data, dict):
        log.warning("[TESTSETS] Expected a dict.")
        return None

    return [
        {testcase_id_key: key, **value}
        for key, value in data.items()
        if isinstance(value, dict)
    ]


async def csv_file_to_json_array(
    csv_file,
    column_types=None,
):
    """
    Reads a CSV file and returns it as a JSON array (list of dictionaries).
    It preserves JSON types like booleans, numbers, and None if specified.

    Args:
        csv_file (str): Path to the CSV file.
        column_types (dict, optional): Dictionary mapping column names to types (e.g., {"age": int, "active": bool}).

    Returns:
        list: A list of dictionaries representing the CSV rows.
    """
    try:
        try:
            data = await csv_file.read()
            df = pl.read_csv(
                BytesIO(data), infer_schema_length=0
            )  # infer_schema_length=0 reads all as strings
            return df.to_dicts()
        except Exception as e:
            log.error("[TESTSETS] Could not read CSV file", exc_info=True)
            raise e

    except Exception as e:
        log.error("[TESTSETS] Could not read CSV file", exc_info=True)
        raise e


def json_array_to_csv_file(
    json_array,
    output_csv_file,
    column_types=None,
):
    """
    Converts a JSON array (list of dictionaries) into a CSV file using Dask Bags.
    Optionally enforces column types when writing.

    Args:
        json_array (list): JSON array where each item is a dictionary.
        output_csv_file (str): Path to save the output CSV file.
        column_types (dict, optional): Dictionary mapping column names to types (e.g., {"age": str, "active": int}).
    """
    if not json_array:
        log.warning("[TESTSETS] JSON array is empty, nothing to write.")
        return None

    try:
        df = pl.DataFrame(json_array)

        # Apply type conversion if specified
        if column_types:
            for col, dtype in column_types.items():
                if col in df.columns:
                    df = df.with_columns(pl.col(col).cast(dtype))

        # Write directly to CSV using Polars
        df.write_csv(output_csv_file)

    except Exception as e:
        log.error("[TESTSETS] Could not convert JSON array to CSV file", exc_info=True)
        raise e


def csv_data_to_json_array(
    csv_data: List[Dict[str, Any]],
    column_types: Dict[str, type] = {},
) -> List[Dict[str, Any]]:
    """
    Converts CSV-like data (list of dictionaries) into a JSON array, preserving JSON types if specified.

    Args:
        csv_data (List[Dict[str, Any]]): List of dictionaries representing CSV data.
        column_types (Dict[str, type], optional): Dictionary mapping column names to types.

    Returns:
        List[Dict[str, Any]]: JSON array with preserved data types.
    """
    if not isinstance(csv_data, list) or not all(
        isinstance(row, dict) for row in csv_data
    ):
        log.warning("[TESTSETS] Expected a list of dictionaries (CSV-like structure).")
        return []

    # Convert column types if specified
    if column_types:
        for row in csv_data:
            for col, dtype in column_types.items():
                if col in row:
                    try:
                        row[col] = dtype(row[col])  # Cast to the specified type
                    except (ValueError, TypeError):
                        log.warning(
                            f"[TESTSETS] Could not convert column '{col}' to {dtype}, keeping original value."
                        )

    return csv_data
