from typing import Optional, List, Dict, Any
from json import loads, dumps
from uuid import UUID, uuid4

import orjson
import dask

from fastapi import Query, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference, Tags
from oss.src.core.testsets.dtos import TestsetFlags, TestsetQuery


log = get_module_logger(__name__)


TESTSETS_COUNT_LIMIT = 10 * 1_000  # 10,000 testcases per testset
TESTSETS_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MB per testset

TESTSETS_COUNT_WARNING = f"Test set exceeds the maximum count of {TESTSETS_COUNT_LIMIT} test cases per test set."
TESTSETS_SIZE_WARNING = f"Test set exceeds the maximum size of {TESTSETS_SIZE_LIMIT // (1024 * 1024)} MB per test set."

TESTSETS_SIZE_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_SIZE_WARNING,
)

TESTSETS_COUNT_EXCEPTION = HTTPException(
    status_code=400,
    detail=TESTSETS_COUNT_WARNING,
)


def validate_testset_limits(rows: List[dict]) -> tuple[int, int]:
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


def format_validation_error(e, request_body=None):
    formatted_errors = []

    for error in e.errors():
        loc = error.get("loc", [])

        if not loc or loc[0] != "body":
            loc = ["body"] + list(loc)

        error_detail = {
            "type": error.get("type", "value_error"),
            "loc": loc,
            "msg": error.get("msg", "Validation error"),
        }

        if "input" in error:
            error_detail["input"] = error.get("input")
        elif request_body is not None:
            error_detail["input"] = request_body

        formatted_errors.append(error_detail)

    return formatted_errors


def parse_testset_query_request(
    testset_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    testset_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    testset_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> TestsetQuery:
    if testset_ref:
        try:
            testset_ref = Reference(**loads(testset_ref))
        except Exception:  # pylint: disable=broad-except
            testset_ref = None

            log.error("Failed to parse testset_ref (%s)", testset_ref)

    if testset_flags:
        try:
            testset_flags = TestsetFlags(**loads(testset_flags))
        except Exception:  # pylint: disable=broad-except
            testset_flags = None

            log.error("Failed to parse testset_flags (%s)", testset_flags)

    if testset_meta:
        try:
            testset_meta = loads(testset_meta)
        except Exception:  # pylint: disable=broad-except
            testset_meta = None

            log.error(f"Failed to parse testset_meta ({testset_meta})")

    return parse_testset_body_request(
        testset_ref=testset_ref,
        #
        testset_flags=testset_flags,
        testset_meta=testset_meta,
        #
        include_archived=include_archived,
    )


def parse_testset_body_request(
    testset_ref: Optional[Reference] = None,
    #
    testset_flags: Optional[TestsetFlags] = None,
    testset_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> TestsetQuery:
    _query = None

    try:
        _query = TestsetQuery(
            testset_ref=testset_ref,
            #
            flags=testset_flags,
            meta=testset_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing testset body request: %s", e)

        _query = None

    return _query


def parse_variant_query_request(
    testset_ref: Optional[str] = Query(
        None,
        description='JSON string of reference, e.g. {"key": value}',
    ),
    variant_ref: Optional[str] = Query(
        None,
        description='JSON string of reference, e.g. {"key": value}',
    ),
    variant_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    variant_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> TestsetQuery:
    if testset_ref:
        try:
            testset_ref = Reference(**loads(testset_ref))
        except Exception:  # pylint: disable=broad-except
            testset_ref = None

            log.error("Failed to parse testset_ref (%s)", testset_ref)

    if variant_ref:
        try:
            variant_ref = Reference(**loads(variant_ref))
        except Exception:  # pylint: disable=broad-except
            variant_ref = None

            log.error("Failed to parse variant_ref (%s)", variant_ref)

    if variant_flags:
        try:
            variant_flags = TestsetFlags(**loads(variant_flags))
        except Exception:  # pylint: disable=broad-except
            variant_flags = None

            log.error("Failed to parse variant_flags (%s)", variant_flags)

    if variant_meta:
        try:
            variant_meta = loads(variant_meta)
        except Exception:  # pylint: disable=broad-except
            variant_meta = None

            log.error(f"Failed to parse variant_meta ({variant_meta})")

    return parse_variant_body_request(
        testset_ref=testset_ref,
        variant_ref=variant_ref,
        #
        variant_flags=variant_flags,
        variant_meta=variant_meta,
        #
        include_archived=include_archived,
    )


def parse_variant_body_request(
    testset_ref: Optional[Reference] = None,
    variant_ref: Optional[Reference] = None,
    #
    variant_flags: Optional[TestsetFlags] = None,
    variant_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> TestsetQuery:
    _query = None

    try:
        _query = TestsetQuery(
            artifact_ref=testset_ref,
            variant_ref=variant_ref,
            #
            flags=variant_flags,
            meta=variant_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn("Error parsing variant body request: %s", e)

        _query = None

    return _query


def parse_revision_query_request(
    variant_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    revision_ref: Optional[str] = Query(
        None,
        description='JSON string of ref, e.g. {"key": value}',
    ),
    revision_meta: Optional[str] = Query(
        None, description='JSON string of meta, e.g. {"key": value}'
    ),
    revision_flags: Optional[str] = Query(
        None, description='JSON string of flags, e.g. {"key": value}'
    ),
    include_archived: Optional[bool] = Query(None),
) -> TestsetQuery:
    if variant_ref:
        try:
            variant_ref = Reference(**loads(variant_ref))
        except Exception:  # pylint: disable=broad-except
            variant_ref = None

            log.error("Failed to parse variant_ref (%s)", variant_ref)

    if revision_ref:
        try:
            revision_ref = Reference(**loads(revision_ref))
        except Exception:  # pylint: disable=broad-except
            revision_ref = None

            log.error("Failed to parse revision_ref (%s)", revision_ref)

    if revision_flags:
        try:
            revision_flags = TestsetFlags(**loads(revision_flags))
        except Exception:  # pylint: disable=broad-except
            revision_flags = None

            log.error("Failed to parse revision_flags (%s)", revision_flags)

    if revision_meta:
        try:
            revision_meta = loads(revision_meta)
        except Exception:  # pylint: disable=broad-except
            revision_meta = None

            log.error(f"Failed to parse revision_meta ({revision_meta})")

    return parse_revision_body_request(
        variant_ref=variant_ref,
        revision_ref=revision_ref,
        #
        revision_flags=revision_flags,
        revision_meta=revision_meta,
        #
        include_archived=include_archived,
    )


def parse_revision_body_request(
    variant_ref: Optional[Reference] = None,
    revision_ref: Optional[Reference] = None,
    #
    revision_flags: Optional[TestsetFlags] = None,
    revision_meta: Optional[Tags] = None,
    #
    include_archived: Optional[bool] = None,
) -> TestsetQuery:
    _query = None

    try:
        _query = TestsetQuery(
            variant_ref=variant_ref,
            revision_ref=revision_ref,
            #
            flags=revision_flags,
            meta=revision_meta,
            #
            include_archived=include_archived,
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        _query = None

    return _query


def merge_requests(
    query_param: Optional[TestsetQuery] = None,
    query_body: Optional[TestsetQuery] = None,
) -> TestsetQuery:
    if query_body is None:
        return query_param

    if query_param is None:
        return query_body

    return TestsetQuery(
        artifact_ref=query_body.artifact_ref or query_param.artifact_ref,
        variant_ref=query_body.variant_ref or query_param.variant_ref,
        revision_ref=query_body.revision_ref or query_param.revision_ref,
        #
        flags=query_body.flags or query_param.flags,
        meta=query_body.meta or query_param.meta,
        #
        include_archived=query_body.include_archived or query_param.include_archived,
    )


def to_uuid(value):
    """Ensure value is a valid UUID; generate a new one if missing/invalid."""
    try:
        return str(UUID(str(value)))  # Convert valid UUID to string
    except ValueError:
        return str(uuid4())  # Generate a new UUID


def json_file_to_json_array(
    json_file,
):
    """Reads a JSON file and returns the parsed data."""
    try:
        if isinstance(json_file, str):
            with open(json_file, "rb") as f:
                return orjson.loads(f.read())  # Efficiently load JSON
        else:
            return orjson.loads(json_file)
    except orjson.JSONDecodeError as e:
        print(f"Error: Invalid JSON format - {e}")
        raise e
    except Exception as e:
        print(f"Error: Unexpected issue - {e}")
        raise e


def json_array_to_json_file(
    json_file,
    data,
):
    """Writes JSON data to a file."""
    try:
        with open(json_file, "wb") as f:
            f.write(
                orjson.dumps(
                    data,
                    option=orjson.OPT_INDENT_2,
                )
            )  # Pretty-print JSON
    except Exception as e:
        print(f"Error: Could not write to file - {e}")
        raise e


def json_array_to_json_object(
    data,
    testcase_id_key="testcase_id",
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
        print("Error: Expected a list of objects.")
        return None

    transformed_data = {}

    for obj in data:
        if not isinstance(obj, dict):
            continue  # Ignore non-dict entries

        testcase_id = to_uuid(
            obj.pop(testcase_id_key, None)
        )  # Remove `testcase_id` after extracting it
        transformed_data[testcase_id] = obj  # Store object without `testcase_id`

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
        print("Error: Expected a dictionary.")
        return None

    return [
        {testcase_id_key: key, **value}
        for key, value in data.items()
        if isinstance(value, dict)
    ]


def csv_file_to_json_array(
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
        df = dask.dataframe.read_csv(
            csv_file,
            dtype=str,
        ).compute()  # Read as string for flexibility

        if column_types:
            for col, dtype in column_types.items():
                if col in df.columns:
                    df[col] = df[col].astype(dtype)  # Convert column to specified type

        return df.to_dict(
            orient="records"
        )  # Convert to list of dictionaries (JSON array)
    except Exception as e:
        print(f"Error: Could not read CSV file - {e}")
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
        print("Error: JSON array is empty, nothing to write.")
        return None

    try:
        # Convert JSON array to Dask Bag
        bag = dask.bag.from_sequence(json_array)

        # Convert to DataFrame
        df = bag.to_dataframe()

        # Apply type conversion if specified
        if column_types:
            for col, dtype in column_types.items():
                if col in df.columns:
                    df[col] = df[col].astype(dtype)

        # Write directly to CSV using Dask
        df.to_csv(output_csv_file, index=False, single_file=True)

    except Exception as e:
        print(f"Error: Could not convert JSON array to CSV file - {e}")
        raise e


def csv_data_to_json_array(
    csv_data: List[Dict[str, Any]], column_types: Dict[str, type] = None
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
        print("Error: Expected a list of dictionaries (CSV-like structure).")
        return None

    # Convert column types if specified
    if column_types:
        for row in csv_data:
            for col, dtype in column_types.items():
                if col in row:
                    try:
                        row[col] = dtype(row[col])  # Cast to the specified type
                    except (ValueError, TypeError):
                        print(
                            f"Warning: Could not convert column '{col}' to {dtype}, keeping original value."
                        )

    return csv_data
