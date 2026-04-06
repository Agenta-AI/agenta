from typing import List, Tuple, Dict, Optional, Any, Literal
from uuid import UUID
from asyncio import sleep

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Windowing
from oss.src.core.shared.dtos import Trace
from oss.src.core.shared.dtos import Traces
from oss.src.core.tracing.utils.hashing import make_hash_id
from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Condition,
    Fields,
    Filtering,
    Focus,
    Format,
    Formatting,
    ListOperator,
    LogicalOperator,
    TracingQuery,
)

# Divides cleanly into 1, 2, 3, 4, 5, 6, 8, 10, ...
DEFAULT_BATCH_SIZE = 1 * 2 * 3 * 4 * 5

log = get_module_logger(__name__)

StepKind = Literal["application", "evaluator"]


def paginate_ids(
    *,
    ids: List[UUID],
    windowing: Optional[Windowing],
) -> Tuple[List[UUID], bool]:
    """Apply cursor-based pagination to an ordered list of UUIDs.

    Returns (page_ids, has_more).  The list must be deterministically ordered
    (UUID7 ascending by default) so the cursor lookup is stable across requests.
    """
    if not windowing:
        return list(ids), False

    ordered = list(ids)

    if windowing.order == "descending":
        ordered.reverse()

    if windowing.next is not None:
        try:
            next_index = ordered.index(windowing.next)
            ordered = ordered[next_index + 1 :]
        except ValueError:
            return [], False

    if windowing.limit is None:
        return ordered, False

    has_more = len(ordered) > windowing.limit
    return ordered[: windowing.limit], has_more


def next_windowing_from_ids(
    *,
    paged_ids: List[UUID],
    windowing: Optional[Windowing],
    has_more: bool,
) -> Optional[Windowing]:
    """Build the next-page windowing cursor from a paginated ID slice."""
    if not windowing or windowing.limit is None or len(paged_ids) == 0 or not has_more:
        return None

    return Windowing(
        newest=windowing.newest,
        oldest=windowing.oldest,
        next=paged_ids[-1],
        limit=windowing.limit,
        order=windowing.order,
    )


def flatten_dedup_ids(ids_by_group: List[List[UUID]]) -> List[UUID]:
    """Flatten a list of ID groups, deduplicating while preserving first-seen order."""
    result: List[UUID] = []
    seen: set = set()
    for group in ids_by_group:
        for id_ in group:
            if id_ not in seen:
                seen.add(id_)
                result.append(id_)
    return result


def filter_scenario_ids(
    user_id: UUID,
    user_ids: List[List[UUID]],
    scenario_ids: List[UUID],
    is_sequential: bool,
    batch_offset: Optional[int] = None,
    batch_size: Optional[int] = None,
) -> List[List[UUID]]:
    user_scenario_ids: List[List[UUID]] = []

    if is_sequential:
        blocks = (
            batch_size
            if isinstance(batch_size, int) and batch_size > 0
            else DEFAULT_BATCH_SIZE
        )
        MOD = min(len(scenario_ids), blocks)
    else:
        MOD = DEFAULT_BATCH_SIZE
    offset = batch_offset if isinstance(batch_offset, int) and batch_offset >= 0 else 0

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


def _normalize_reference(reference: Any) -> Dict[str, str]:
    if hasattr(reference, "model_dump"):
        reference = reference.model_dump(mode="json", exclude_none=True)

    if not isinstance(reference, dict):
        return {}

    entry = {}
    for field in ("id", "slug", "version"):
        value = reference.get(field)
        if value is not None:
            entry[field] = str(value)
    return entry


def _normalize_link(link: Any) -> Dict[str, str]:
    if hasattr(link, "model_dump"):
        link = link.model_dump(mode="json", exclude_none=True)

    if not isinstance(link, dict):
        return {}

    entry = {}
    for field in ("trace_id", "span_id"):
        value = link.get(field)
        if value is not None:
            entry[field] = str(value)
    return entry


def make_hash(
    *,
    references: Optional[Dict[str, Any]] = None,
    links: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    normalized_references = {
        key: _normalize_reference(reference)
        for key, reference in (references or {}).items()
    }
    normalized_links = {
        key: _normalize_link(link) for key, link in (links or {}).items()
    }

    return make_hash_id(
        references=normalized_references,
        links=normalized_links,
    )


async def fetch_traces_by_hash(
    tracing_service,
    project_id: UUID,
    *,
    hash_id: str,
    limit: Optional[int] = None,
) -> Traces:
    if not hash_id:
        return []

    return await tracing_service.query_traces(
        project_id=project_id,
        query=TracingQuery(
            formatting=Formatting(
                focus=Focus.TRACE,
                format=Format.AGENTA,
            ),
            windowing=Windowing(
                limit=limit,
                order="descending",
            ),
            filtering=Filtering(
                operator=LogicalOperator.AND,
                conditions=[
                    Condition(
                        field=Fields.PARENT_ID,
                        operator=ComparisonOperator.IS,
                        value=None,
                    ),
                    Condition(
                        field=Fields.HASHES,
                        operator=ListOperator.IN,
                        value=[{"id": hash_id}],
                    ),
                ],
            ),
        ),
    )


def select_traces_for_reuse(
    *,
    traces: Optional[Traces],
    required_count: int,
) -> Traces:
    if not traces or required_count <= 0:
        return []

    reusable: Traces = []
    for trace in traces:
        if not trace:
            continue
        if not getattr(trace, "trace_id", None):
            continue
        reusable.append(trace)
        if len(reusable) >= required_count:
            break

    return reusable


def plan_missing_traces(
    *,
    required_count: int,
    reusable_count: int,
) -> int:
    return max(0, required_count - max(0, reusable_count))


def build_repeat_indices(
    repeats: Optional[int],
) -> List[int]:
    count = repeats or 1
    if count < 1:
        count = 1
    return list(range(count))


def required_traces_for_step(
    *,
    repeats: Optional[int],
    is_split: bool,
    step_kind: StepKind,
    has_evaluator_steps: bool = True,
) -> int:
    count = max(1, repeats or 1)

    if step_kind == "application":
        if not has_evaluator_steps:
            return count
        return count if is_split else 1

    if step_kind == "evaluator":
        return count

    return count


def effective_is_split(
    *,
    is_split: bool,
    is_live: bool = False,
    is_queue: bool = False,
    has_application_steps: bool = False,
    has_evaluator_steps: bool = False,
) -> bool:
    if is_live or is_queue:
        return False
    if not has_application_steps or not has_evaluator_steps:
        return False
    return is_split


def _has_usable_root_span(trace: Any) -> bool:
    spans = getattr(trace, "spans", None)
    if not isinstance(spans, dict) or not spans:
        return False

    for span in spans.values():
        if isinstance(span, list):
            continue
        if getattr(span, "span_id", None):
            return True

    return False


async def fetch_trace(
    tracing_service,
    project_id: UUID,
    #
    trace_id: str,
    max_retries: int = 8,
    delay: float = 0.5,
    max_delay: float = 4.0,
) -> Optional[Trace]:
    current_delay = delay
    for attempt in range(max_retries):
        had_exception = False
        try:
            trace = await tracing_service.fetch_trace(
                project_id=project_id,
                trace_id=trace_id,
            )
            # spans = getattr(trace, "spans", None) if trace else None
            # log.debug(
            #     "[EVAL] [trace] fetch attempt",
            #     trace_id=trace_id,
            #     attempt=attempt + 1,
            #     found=bool(trace),
            #     spans_type=type(spans).__name__ if spans is not None else None,
            #     span_count=len(spans) if isinstance(spans, dict) else None,
            #     usable_root_span=_has_usable_root_span(trace) if trace else False,
            # )
            if trace and _has_usable_root_span(trace):
                return Trace(
                    **trace.model_dump(
                        mode="json",
                        exclude_none=True,
                    )
                )

        except Exception:  # pylint: disable=broad-exception-caught
            had_exception = True
            if attempt == max_retries - 1:
                log.warning(
                    "[EVAL] [trace] fetch failed after retries",
                    trace_id=trace_id,
                    attempts=max_retries,
                    exc_info=True,
                )

        if attempt < max_retries - 1:
            await sleep(current_delay)
            current_delay = min(current_delay * 2, max_delay)
        elif not had_exception:
            log.warning(
                "[EVAL] [trace] empty or incomplete trace response after retries",
                trace_id=trace_id,
                attempts=max_retries,
            )

    return None
