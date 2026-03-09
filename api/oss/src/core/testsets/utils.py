from hashlib import blake2b as digest
from json import dumps
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.blobs.utils import compute_blob_id

log = get_module_logger(__name__)

TESTSETS_COUNT_LIMIT = 10 * 1_000  # 10,000 testcases per testset
TESTSETS_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MB per testset

TESTSETS_COUNT_WARNING = f"Testset exceeds the maximum count of {TESTSETS_COUNT_LIMIT} testcases per testset."
TESTSETS_SIZE_WARNING = f"Testset exceeds the maximum size of {TESTSETS_SIZE_LIMIT // (1024 * 1024)} MB per testset."


def validate_testset_limits(rows: Dict[str, dict]) -> tuple[int, int]:
    if not isinstance(rows, dict):
        raise TypeError("Testset rows must be a dictionary.")

    i = -1
    total_size = 2
    for i, row in enumerate(rows.values()):
        row_str = dumps(row)
        total_size += len(row_str.encode("utf-8"))
        if i > 0:
            total_size += 1
        if i + 1 > TESTSETS_COUNT_LIMIT:
            log.error(TESTSETS_COUNT_WARNING)
            raise ValueError(TESTSETS_COUNT_WARNING)
        if total_size > TESTSETS_SIZE_LIMIT:
            log.error(TESTSETS_SIZE_WARNING)
            raise ValueError(TESTSETS_SIZE_WARNING)
    return i + 1, total_size


def _to_uuid(value: Optional[str], data: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError):
        return str(compute_blob_id(blob_data=data))


def json_array_to_json_object(
    data: Any,
    testcase_id_key: str = "testcase_id",
    testcase_dedup_id_key: Optional[str] = "testcase_dedup_id",
) -> Optional[Dict[str, Dict[str, Any]]]:
    """
    Transform a list of testcase rows into a dict keyed by testcase id.
    """
    if not isinstance(data, list):
        log.warning("[TESTSETS] Expected a list.")
        return None

    transformed_data: Dict[str, Dict[str, Any]] = {}

    for testcase_idx, testcase_data in enumerate(data):
        if not isinstance(testcase_data, dict):
            continue

        testcase_dedup_id = testcase_data.pop(testcase_dedup_id_key, None)
        testcase_id_str = testcase_data.pop(testcase_id_key, None)
        testcase_id = _to_uuid(testcase_id_str, testcase_data)

        testcase_dedup_id = (
            testcase_dedup_id
            or digest(
                f"{testcase_id}:{testcase_idx}".encode(),
                digest_size=6,
            ).hexdigest()
        )

        if testcase_dedup_id_key is not None:
            testcase_data[testcase_dedup_id_key] = testcase_dedup_id

        # Re-compute after mutating testcase_data: when testcase_id_str is not
        # a valid UUID, _to_uuid falls back to hashing testcase_data, so the
        # final ID must be derived from the data with dedup_id already injected.
        testcase_id = _to_uuid(testcase_id_str, testcase_data)
        transformed_data[testcase_id] = testcase_data

    return transformed_data
