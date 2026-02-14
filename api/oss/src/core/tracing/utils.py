from typing import Dict, Union, Any, Optional, Tuple, List
from uuid import UUID
from datetime import datetime
from collections import OrderedDict

from litellm import cost_calculator


from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import (
    Flags,
    Tags,
    Meta,
    Data,
    Reference,
    Link,
)

from oss.src.core.tracing.dtos import (
    Attributes,
    OTelSpanKind,
    OTelStatusCode,
    OTelSpan,
    OTelFlatSpan,
    OTelFlatSpans,
    TracingQuery,
    FilteringException,
    Filtering,
    Condition,
    StringOperator,
    Fields,
    TraceType,
    SpanType,
    _C_OPS,
    _N_OPS,
    _S_OPS,
    _L_OPS,
    _D_OPS,
    _E_OPS,
)

from oss.src.core.tracing.dtos import OTelAttributes


log = get_module_logger(__name__)

# ATTRIBUTES


def unmarshall_attributes(
    marshalled: OTelAttributes,
) -> OTelAttributes:
    """
    Unmarshalls a dictionary of marshalled attributes into a nested dictionary

    Example:
    marshalled = {
        "ag.type": "tree",
        "ag.span_name": "root",
        "ag.node.children.0.name": "child1",
        "ag.node.children.1.name": "child2"
    }
    unmarshalled = {
        "ag": {
            "type": "tree",
            "node": {
                "name": "root",
                "children": [
                    {
                        "name": "child1",
                    },
                    {
                        "name": "child2",
                    }
                ]
            }
        }
    }
    """
    unmarshalled = {}

    for key, value in marshalled.items():
        keys = key.split(".")
        current = unmarshalled

        for i, key in enumerate(keys):
            is_last = i == len(keys) - 1
            next_key = keys[i + 1] if not is_last else None
            is_index = key.isdigit()
            key = int(key) if is_index else key

            if is_last:
                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append(None)
                    current[key] = value
                elif isinstance(current, dict):
                    current[key] = value
            else:
                next_is_index = next_key.isdigit() if next_key else False

                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append([] if next_is_index else {})
                    if current[key] is None:
                        current[key] = [] if next_is_index else {}
                    current = current[key]
                elif isinstance(current, dict):
                    if key not in current:
                        current[key] = [] if next_is_index else {}
                    current = current[key]

    return unmarshalled


def marshall(
    d: Union[Dict[str, Any], list],
    parent_key: str = "",
    sep: str = ".",
) -> Dict[str, Any]:
    """Recursively flattens a nested dict/list into dot notation."""
    items = []

    if isinstance(d, dict):
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, (dict, list)):
                items.extend(marshall(v, new_key, sep=sep).items())
            else:
                items.append((new_key, v))

    elif isinstance(d, list):
        for idx, v in enumerate(d):
            new_key = f"{parent_key}{sep}{idx}" if parent_key else str(idx)
            if isinstance(v, (dict, list)):
                items.extend(marshall(v, new_key, sep=sep).items())
            else:
                items.append((new_key, v))

    return dict(items)


def unmarshall(
    d: Dict[str, Any],
    sep: str = ".",
) -> Dict[str, Any]:
    items = {}

    for compound_key, value in d.items():
        keys = compound_key.split(sep)
        current = items

        for i, key in enumerate(keys):
            is_last = i == len(keys) - 1
            next_key = keys[i + 1] if not is_last else None
            is_index = key.isdigit()
            key = int(key) if is_index else key

            if is_last:
                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append(None)
                    current[key] = value
                elif isinstance(current, dict):
                    current[key] = value
            else:
                next_is_index = next_key.isdigit() if next_key else False

                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append([] if next_is_index else {})
                    if current[key] is None:
                        current[key] = [] if next_is_index else {}
                    current = current[key]
                elif isinstance(current, dict):
                    if key not in current:
                        current[key] = [] if next_is_index else {}
                    current = current[key]

    return items


# TREE


def parse_span_dtos_to_span_idx(
    span_dtos: List[OTelFlatSpan],
) -> Dict[str, OTelFlatSpan]:
    span_idx = {span.span_id: span for span in span_dtos}

    return span_idx


def calculate_and_propagate_metrics(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Calculate and propagate costs/tokens for a list of span DTOs.

    This must be called BEFORE batching to ensure complete trace trees.
    If called after batching, partial traces will fail to propagate correctly.

    Args:
        span_dtos: List of span DTOs (should be from a complete trace)

    Returns:
        List of span DTOs with calculated and propagated costs/tokens
    """
    if not span_dtos:
        return span_dtos

    # Build span index and tree
    span_idx = parse_span_dtos_to_span_idx(span_dtos)
    span_id_tree = parse_span_idx_to_span_id_tree(span_idx)

    # Calculate incremental costs from token counts
    calculate_costs(span_idx)

    # Propagate costs up the tree (children to parents)
    cumulate_costs(span_id_tree, span_idx)

    # Propagate tokens up the tree (children to parents)
    cumulate_tokens(span_id_tree, span_idx)

    # Return updated span DTOs
    return list(span_idx.values())


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, OTelFlatSpan],
) -> OrderedDict:
    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: OTelFlatSpan) -> None:
        if span_dto.parent_id is None:
            span_id_tree[span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = span_id_tree[span_dto.span_id]
        elif span_dto.parent_id in index:
            index[span_dto.parent_id][span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = index[span_dto.parent_id][span_dto.span_id]

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.start_time):
        push(span_dto)

    return span_id_tree


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelSpan],
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        parent_span = spans_idx[span_id]

        parent_span.spans = dict()

        _connect_tree_dfs(children_spans_id_tree, spans_idx)

        for child_span_id in children_spans_id_tree.keys():
            child_span_name = spans_idx[child_span_id].span_name
            if child_span_name not in parent_span.spans:
                parent_span.spans[child_span_name] = spans_idx[child_span_id]
            else:
                if not isinstance(parent_span.spans[child_span_name], list):
                    parent_span.spans[child_span_name] = [
                        parent_span.spans[child_span_name]
                    ]

                parent_span.spans[child_span_name].append(spans_idx[child_span_id])

        if len(parent_span.spans) == 0:
            parent_span.spans = None


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    def _get_incremental(span: OTelFlatSpan):
        _costs = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _costs

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("incremental", {})
                .get("total", 0.0)
            ),
        }

    def _get_cumulative(span: OTelFlatSpan):
        _costs = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _costs

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("costs", {})
                .get("cumulative", {})
                .get("total", 0.0)
            ),
        }

    def _accumulate(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set_cumulative(span: OTelFlatSpan, costs: dict):
        if span.attributes is None:
            span.attributes = {}

        if (
            costs.get("prompt", 0.0) != 0.0
            or costs.get("completion", 0.0) != 0.0
            or costs.get("total", 0.0) != 0.0
        ):
            if "ag" not in span.attributes or not isinstance(
                span.attributes["ag"],
                dict,
            ):
                span.attributes["ag"] = {}

            if "metrics" not in span.attributes["ag"] or not isinstance(
                span.attributes["ag"]["metrics"],
                dict,
            ):
                span.attributes["ag"]["metrics"] = {}

            if "costs" not in span.attributes["ag"]["metrics"] or not isinstance(
                span.attributes["ag"]["metrics"]["costs"],
                dict,
            ):
                span.attributes["ag"]["metrics"]["costs"] = {}

            span.attributes["ag"]["metrics"]["costs"]["cumulative"] = costs

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        _get_incremental,
        _get_cumulative,
        _accumulate,
        _set_cumulative,
    )


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
) -> None:
    def _get_incremental(span: OTelFlatSpan):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _tokens

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("total", 0.0)
            ),
        }

    def _get_cumulative(span: OTelFlatSpan):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.attributes is None:
            return _tokens

        attr: dict = span.attributes

        return {
            "prompt": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("prompt", 0.0)
            ),
            "completion": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("completion", 0.0)
            ),
            "total": (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("cumulative", {})
                .get("total", 0.0)
            ),
        }

    def _accumulate(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set_cumulative(span: OTelFlatSpan, tokens: dict):
        if span.attributes is None:
            span.attributes = {}

        if (
            tokens.get("prompt", 0.0) != 0.0
            or tokens.get("completion", 0.0) != 0.0
            or tokens.get("total", 0.0) != 0.0
        ):
            if "ag" not in span.attributes or not isinstance(
                span.attributes["ag"],
                dict,
            ):
                span.attributes["ag"] = {}

            if "metrics" not in span.attributes["ag"] or not isinstance(
                span.attributes["ag"]["metrics"],
                dict,
            ):
                span.attributes["ag"]["metrics"] = {}

            if "tokens" not in span.attributes["ag"]["metrics"] or not isinstance(
                span.attributes["ag"]["metrics"]["tokens"],
                dict,
            ):
                span.attributes["ag"]["metrics"]["tokens"] = {}

            span.attributes["ag"]["metrics"]["tokens"]["cumulative"] = tokens

    _cumulate_tree_dfs(
        spans_id_tree,
        spans_idx,
        _get_incremental,
        _get_cumulative,
        _accumulate,
        _set_cumulative,
    )


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelFlatSpan],
    get_incremental,
    get_cumulative,
    accumulate,
    set_cumulative,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        cumulated_metric = get_incremental(spans_idx[span_id])

        _cumulate_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_incremental,
            get_cumulative,
            accumulate,
            set_cumulative,
        )

        for child_span_id in children_spans_id_tree.keys():
            marginal_metric = get_cumulative(spans_idx[child_span_id])
            cumulated_metric = accumulate(cumulated_metric, marginal_metric)

        set_cumulative(spans_idx[span_id], cumulated_metric)


TYPES_WITH_COSTS = [
    "embedding",
    "query",
    "completion",
    "chat",
    "rerank",
]


def calculate_costs(span_idx: Dict[str, OTelFlatSpan]):
    for span in span_idx.values():
        if (
            span.span_type
            and span.span_type.name.lower() in TYPES_WITH_COSTS
            and span.attributes
        ):
            attr: dict = span.attributes
            model = attr.get("ag", {}).get("meta", {}).get("response", {}).get(
                "model"
            ) or attr.get("ag", {}).get("data", {}).get("parameters", {}).get("model")

            prompt_tokens = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("prompt", 0.0)
            )

            completion_tokens = (
                attr.get("ag", {})
                .get("metrics", {})
                .get("tokens", {})
                .get("incremental", {})
                .get("completion", 0.0)
            )

            try:
                costs = cost_calculator.cost_per_token(
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )

                if not costs:
                    continue

                prompt_cost, completion_cost = costs
                total_cost = prompt_cost + completion_cost

                if "ag" not in span.attributes or not isinstance(
                    span.attributes["ag"],
                    dict,
                ):
                    span.attributes["ag"] = {}
                if "metrics" not in span.attributes["ag"] or not isinstance(
                    span.attributes["ag"]["metrics"],
                    dict,
                ):
                    span.attributes["ag"]["metrics"] = {}

                if "costs" not in span.attributes["ag"]["metrics"] or not isinstance(
                    span.attributes["ag"]["metrics"]["costs"],
                    dict,
                ):
                    span.attributes["ag"]["metrics"]["costs"] = {}

                span.attributes["ag"]["metrics"]["costs"]["incremental"] = {
                    "prompt": prompt_cost,
                    "completion": completion_cost,
                    "total": total_cost,
                }

            except Exception:  # pylint: disable=bare-except
                log.warn(
                    "Failed to calculate costs",
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )


# VALUES


def parse_ref_id_to_uuid(
    ref_id: str,
):
    clean_ref_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if ref_id.startswith("0x") and len(ref_id) == (2 + 32):
        ref_id = ref_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_ref_id = str(UUID(ref_id))
    except Exception as e:
        log.error(
            "ref_id must be a UUID, got %s [%s]",
            type(ref_id),
            ref_id,
        )
        raise TypeError() from e

    return clean_ref_id


def parse_ref_slug_to_str(
    ref_slug: str,
):
    clean_ref_slug = None

    try:
        clean_ref_slug = str(ref_slug)
    except Exception as e:
        log.error(
            "ref_slug must be a string, got %s [%s]",
            type(ref_slug),
            ref_slug,
        )
        raise TypeError() from e

    return clean_ref_slug


def parse_ref_version_to_str(
    ref_version: str,
):
    clean_ref_version = None

    try:
        clean_ref_version = str(ref_version)
    except Exception as e:
        log.error(
            "ref_version must be a string, got %s [%s]",
            type(ref_version),
            ref_version,
        )
        raise TypeError() from e

    return clean_ref_version


def parse_evt_name_to_str(
    evt_name: str,
):
    clean_evt_name = None

    try:
        clean_evt_name = str(evt_name)
    except Exception as e:
        log.error(
            "evt_name must be a string, got %s [%s]",
            type(evt_name),
            evt_name,
        )
        raise TypeError() from e

    return clean_evt_name


def parse_trace_id_to_uuid(
    trace_id: str,
):
    clean_trace_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if trace_id.startswith("0x") and len(trace_id) == (2 + 32):
        trace_id = trace_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_trace_id = str(UUID(trace_id))
    except Exception as e:
        log.error(
            "trace_id must be a UUID, got %s [%s]",
            type(trace_id),
            trace_id,
        )
        raise TypeError() from e

    return clean_trace_id


def parse_span_id_to_uuid(
    span_id: str,
):
    clean_span_id = None

    # HEX   # 0x31d6cfe04b9011ec
    if span_id.startswith("0x") and len(span_id) == (2 + 16):
        span_id = span_id[2:] + span_id[2:]

    # HEX   # 31d6cfe04b9011ec
    if len(span_id) == 16:
        span_id = span_id + span_id

    # UUID # 31d6cfe0-4b90-11ec-31d6-cfe04b9011ec
    # HEX  # 31d6cfe04b9011ec31d6cfe04b9011ec
    try:
        clean_span_id = str(UUID(span_id))
    except Exception as e:
        log.error(
            "span_id must be a UUID, got %s [%s]",
            type(span_id),
            span_id,
        )
        raise TypeError() from e

    return clean_span_id


def parse_trace_id_from_uuid(
    trace_id: Union[UUID, str],
):
    if isinstance(trace_id, UUID):
        return trace_id.hex

    if isinstance(trace_id, str):
        return UUID(trace_id).hex


def parse_span_id_from_uuid(
    span_id: Union[UUID, str],
):
    if isinstance(span_id, UUID):
        return span_id.hex[16:]

    if isinstance(span_id, str):
        return UUID(span_id).hex[16:]


def parse_span_kind_to_enum(
    span_kind: str,
):
    try:
        return OTelSpanKind(span_kind)

    except ValueError as e:
        log.error(f"Unsupported span_kind value: {span_kind}")

        raise FilteringException(
            f"Unsupported span_kind value: {span_kind}",
        ) from e


def parse_status_code_to_enum(
    status_code: str,
):
    try:
        return OTelStatusCode(status_code)

    except ValueError as e:
        log.error(f"Unsupported status_code value: {status_code}")

        raise FilteringException(
            f"Unsupported status_code value: {status_code}",
        ) from e


def parse_value_to_enum(value: str, enum: type) -> type:
    try:
        return enum(value)
    except ValueError as e:
        raise FilteringException(
            f"Unsupported condition value: '{value}'",
        ) from e


def parse_timestamp_to_datetime(
    ts: Optional[Union[str, int, datetime]],
) -> Optional[datetime]:
    if isinstance(ts, datetime):
        return ts

    if isinstance(ts, str):
        try:
            ts = int(ts)
        except ValueError:
            return datetime.fromisoformat(str(ts))

    if isinstance(ts, int):
        digits = len(str(ts))
        # Heuristic based on digit length
        if digits == 10:  # seconds
            ts *= 1_000_000
        elif digits == 13:  # milliseconds
            ts *= 1_000
        elif digits == 16:  # microseconds
            pass
        elif digits == 19:  # nanoseconds
            ts //= 1_000  # lose some precision, but reasonable fallback
        else:  # assume microseconds
            raise FilteringException(f"Timestamp {ts} is ambiguous.")

        return datetime.fromtimestamp(ts / 1_000_000)

    return None  # or raise TypeError if desired


# CONDITIONS


def _parse_trace_id_condition(condition: Condition) -> None:
    if condition.value is None:
        raise FilteringException(
            "'trace_id' is required and thus never null.",
        )

    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'trace_id' only supports comparison and list operators.",
        )

    if isinstance(condition.value, list):
        condition.value = [parse_trace_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_trace_id_to_uuid(condition.value)


def _parse_span_id_condition(condition: Condition) -> None:
    if condition.value is None:
        raise FilteringException(
            "'span_id' is required and thus never null.",
        )

    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'span_id' only supports comparison and list operators.",
        )

    if isinstance(condition.value, list):
        condition.value = [parse_span_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_span_id_to_uuid(condition.value)


def _parse_parent_id_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'parent_id' only supports comparison and list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [parse_span_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_span_id_to_uuid(condition.value)


def _parse_attributes_condition(condition: Condition) -> None:
    if condition.key is None:
        raise FilteringException(
            "'attributes' key is required and thus never null.",
        )


def _parse_links_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'links' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'links' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'links' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'links' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            for i, v in enumerate(condition.value):
                v: dict

                trace_id = v.get("trace_id")
                span_id = v.get("span_id")

                condition.value[i] = Link(
                    trace_id=parse_trace_id_to_uuid(trace_id) if trace_id else None,
                    span_id=parse_span_id_to_uuid(span_id) if span_id else None,
                ).model_dump(mode="json")
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'links' key must be a string in dot notation.",
            ) from e


def _parse_references_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'references' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'references' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'references' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'references' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            _values = []

            for v in condition.value:
                v: dict

                ref_id = v.get("id")
                ref_slug = v.get("slug")
                ref_version = v.get("version")

                if ref_id:
                    _values.append(
                        Reference(
                            id=parse_ref_id_to_uuid(ref_id),
                        ).model_dump(mode="json", exclude_none=True)
                    )

                if ref_slug:
                    _values.append(
                        Reference(
                            slug=parse_ref_slug_to_str(ref_slug),
                        ).model_dump(mode="json", exclude_none=True)
                    )

                if ref_version:
                    _values.append(
                        Reference(
                            version=parse_ref_version_to_str(ref_version),
                        ).model_dump(mode="json", exclude_none=True)
                    )

            condition.value = _values
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(e)
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'references' key must be a string in dot notation.",
            ) from e


def _parse_events_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'events' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'events' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'events' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'events' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            _values = []

            for v in condition.value:
                v: dict

                name = v.get("name")

                if name:
                    _values.append(dict(name=parse_evt_name_to_str(name)))

            condition.value = _values
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(e)
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'events' key must be a string in dot notation.",
            ) from e


def _parse_enum_field_condition(condition: Condition, enum: type) -> None:
    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison and list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [
            parse_value_to_enum(value, enum) for value in condition.value
        ]
    else:
        condition.value = parse_value_to_enum(condition.value, enum)


def _parse_string_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _S_OPS + _L_OPS + _E_OPS:
        raise FilteringException(
            "'status_message' only supports comparison, string, list, and existence operators.",
        )

    if condition.operator in _S_OPS + _L_OPS and condition.value is None:
        raise FilteringException(
            "'status_message' value is required and thus never null for string and list operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'status_message' value is not supported for existence operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [str(value) for value in condition.value]
    else:
        condition.value = str(condition.value)


def _parse_timestamp_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _N_OPS + _S_OPS + _L_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison, numeric, string, and list operators.",
        )

    if condition.operator in _S_OPS and not isinstance(condition.value, str):
        raise FilteringException(
            f"'{condition.field}' only supports string operators with string values."
        )

    if condition.operator in _S_OPS and isinstance(condition.value, str):
        pass
    elif isinstance(condition.value, list):
        condition.value = [
            parse_timestamp_to_datetime(value) for value in condition.value
        ]
    else:
        condition.value = parse_timestamp_to_datetime(condition.value)


def _parse_uuid_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _L_OPS + _E_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison, list, and existence operators.",
        )

    if condition.operator in _L_OPS and condition.value is None:
        raise FilteringException(
            f"'{condition.field}' value is required and thus never null for list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [parse_trace_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_trace_id_to_uuid(condition.value)


def _parse_fts_field_condition(condition: Condition) -> None:
    if condition.operator != StringOperator.CONTAINS:
        raise FilteringException(
            f"'{condition.field}' only supports full-text search operator: 'contains'.",
        )

    if condition.value is None:
        raise FilteringException(
            f"'{condition.field}' value is required and thus never null for full-text search.",
        )

    if not isinstance(condition.value, str):
        raise FilteringException(
            f"'{condition.field}' value must be a string for full-text search.",
        )


# FILTERING / CONDITION


def parse_filtering(
    filtering: Optional[Filtering] = None,
) -> None:
    if filtering is None:
        return

    for condition in filtering.conditions:
        if isinstance(condition, Filtering):
            parse_filtering(condition)
        elif isinstance(condition, Condition):
            parse_condition(condition)
        else:
            raise FilteringException(
                f"Unsupported condition type '{type(condition)}'.",
            )


def parse_condition(
    condition: Optional[Condition] = None,
) -> None:
    if condition is None:
        return

    if condition.field == Fields.TRACE_ID:
        _parse_trace_id_condition(condition)
    elif condition.field == Fields.TRACE_TYPE:
        _parse_enum_field_condition(condition, TraceType)
    elif condition.field == Fields.SPAN_ID:
        _parse_span_id_condition(condition)
    elif condition.field == Fields.SPAN_TYPE:
        _parse_enum_field_condition(condition, SpanType)
    elif condition.field == Fields.PARENT_ID:
        _parse_parent_id_condition(condition)
    elif condition.field == Fields.SPAN_KIND:
        _parse_enum_field_condition(condition, OTelSpanKind)
    elif condition.field == Fields.SPAN_NAME:
        _parse_string_field_condition(condition)
    elif condition.field == Fields.START_TIME:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.END_TIME:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.STATUS_CODE:
        _parse_enum_field_condition(condition, OTelStatusCode)
    elif condition.field == Fields.STATUS_MESSAGE:
        _parse_string_field_condition(condition)
    elif condition.field == Fields.ATTRIBUTES:
        _parse_attributes_condition(condition)
    elif condition.field == Fields.LINKS:
        _parse_links_condition(condition)
    elif condition.field == Fields.REFERENCES:
        _parse_references_condition(condition)
    elif condition.field == Fields.EVENTS:
        _parse_events_condition(condition)
    elif condition.field == Fields.CREATED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.UPDATED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.DELETED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.CREATED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.UPDATED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.DELETED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.CONTENT:
        _parse_fts_field_condition(condition)
    else:
        # raise FilteringException(
        #     f"Unsupported condition field '{condition.field}'.",
        # )
        log.warning(f"Unsupported condition field: {condition.field}")


# INGEST / QUERY


def parse_ingest(span_dtos: OTelFlatSpans) -> None:
    pass


def parse_query(query: TracingQuery) -> None:
    parse_filtering(query.filtering)


# INVOCATIONS / ANNOTATIONS


def parse_into_attributes(
    *,
    type: Optional[Dict[str, str]] = None,
    flags: Optional[Flags] = None,
    tags: Optional[Tags] = None,
    meta: Optional[Meta] = None,
    data: Optional[Data] = None,
    references: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Attributes:
    attributes = dict(
        ag=(
            dict(
                type=type,
                flags=flags,
                tags=tags,
                meta=meta,
                data=data,
                references=references,
            )
            if type or flags or tags or meta or data or references
            else None
        )
    )

    return attributes  # type: ignore


def parse_from_attributes(
    attributes: Attributes,
) -> Tuple[
    Optional[Dict[str, str]],  # type
    Optional[Flags],  # flags
    Optional[Tags],  # tags
    Optional[Meta],  # meta
    Optional[Data],  # data
    Optional[Dict[str, Dict[str, Any]]],  # references
]:
    # TODO - add error handling
    ag: dict = attributes.get("ag", {})  # type: ignore
    type: dict = ag.get("type", {})  # type: ignore
    flags: dict = ag.get("flags")  # type: ignore
    tags: dict = ag.get("tags")  # type: ignore
    meta: dict = ag.get("meta")  # type: ignore
    data: dict = ag.get("data")  # type: ignore
    references = ag.get("references")  # type: ignore

    return (
        type,
        flags,
        tags,
        meta,
        data,
        references,
    )
