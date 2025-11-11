from typing import List, Tuple, Dict, Optional
from uuid import UUID
from asyncio import sleep

from oss.src.core.tracing.dtos import OTelSpansTree

# Divides cleanly into 1, 2, 3, 4, 5, 6, 8, 10, ...
BLOCKS = 1 * 2 * 3 * 4 * 5


def filter_scenario_ids(
    user_id: UUID,
    user_ids: List[List[UUID]],
    scenario_ids: List[UUID],
    is_sequential: bool,
    offset: int = 0,
) -> List[List[UUID]]:
    user_scenario_ids: List[List[UUID]] = []

    MOD = min(len(scenario_ids), BLOCKS)

    for repeat_user_ids in user_ids:
        if not repeat_user_ids:
            user_scenario_ids.append([])

        else:
            repeat_user_bounds = _get_bounds(
                repeat_user_ids,
                user_id,
                MOD,
            )

            if not repeat_user_bounds:
                user_scenario_ids.append([])

            else:
                repeat_scenario_ids = []
                for scenario_idx, scenario_id in enumerate(scenario_ids):
                    mod = (
                        (offset + scenario_idx) if is_sequential else int(scenario_id)
                    ) % MOD

                    if any(
                        lower <= mod < upper for (lower, upper) in repeat_user_bounds
                    ):
                        repeat_scenario_ids.append(scenario_id)

                if not repeat_scenario_ids:
                    user_scenario_ids.append([])

                else:
                    user_scenario_ids.append(repeat_scenario_ids)

    return user_scenario_ids


def _get_bounds(
    assignments: List[UUID],
    target: UUID,
    blocks: int,
) -> List[Tuple[int, int]]:
    bounds: List[Tuple[int, int]] = []

    n = len(assignments)

    if n == 0 or blocks <= 0:
        return bounds

    q, r = divmod(blocks, n)  # base size and remainder

    block_sizes = [q + 1 if i < r else q for i in range(n)]

    start = 0

    for i, size in enumerate(block_sizes):
        end = start + size - 1

        if str(assignments[i]) == str(target):
            bounds.append((start, end + 1))  # half-open bounds [start, end)

        start = end + 1  # next block starts here

    return bounds
    # --------------------------------------------------------------------------


def get_metrics_keys_from_schema(
    schema=None,
    path=(),
) -> List[Dict[str, str]]:
    metrics: List[Dict[str, str]] = list()

    if not isinstance(schema, dict) or "type" not in schema:
        return metrics

    metric_type = None

    t = schema["type"]

    if t == "object":
        if "properties" in schema:
            for key, prop in schema["properties"].items():
                metrics.extend(get_metrics_keys_from_schema(prop, path + (key,)))
        else:
            metric_type = "json"

    elif t == "array" and "items" in schema:
        if schema["items"].get("type") == "string" and "enum" in schema["items"]:
            metric_type = "categorical/multiple"

    elif t == "boolean":
        metric_type = "binary"

    elif t == "string":
        metric_type = "categorical/single" if "enum" in schema else "string"

    elif t == "number":
        metric_type = "numeric/continuous"

    elif t == "integer":
        metric_type = "numeric/discrete"

    if metric_type:
        metrics.append({"path": ".".join(path), "type": metric_type})

    return metrics


async def fetch_trace(
    tracing_router,
    request,
    #
    trace_id: str,
    max_retries: int = 5,
    delay: float = 1.0,
) -> Optional[OTelSpansTree]:
    for attempt in range(max_retries):
        try:
            response = await tracing_router.fetch_trace(
                request=request,
                trace_id=trace_id,
            )

            if response and response.traces:
                return next(iter(response.traces.values()), None)

        except Exception:
            pass

        if attempt < max_retries - 1:
            await sleep(delay)

    return None
