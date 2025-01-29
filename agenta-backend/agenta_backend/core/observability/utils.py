from typing import List, Dict, OrderedDict, Callable, Any
from enum import Enum
from uuid import UUID
from datetime import datetime
from traceback import print_exc

from litellm import cost_calculator


from agenta_backend.core.observability.dtos import (
    SpanDTO,
    FilteringDTO,
    ConditionDTO,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    ExistenceOperator,
)

_C_OPS = list(ComparisonOperator)
_N_OPS = list(NumericOperator)
_S_OPS = list(StringOperator)
_L_OPS = list(ListOperator)
_E_OPS = list(ExistenceOperator)

_UUID_OPERATORS = _C_OPS + _L_OPS + _E_OPS
_LITERAL_OPERATORS = _C_OPS + _L_OPS + _E_OPS
_INTEGER_OPERATORS = _C_OPS + _N_OPS + _L_OPS + _E_OPS
_FLOAT_OPERATORS = _N_OPS + _E_OPS
_DATETIME_OPERATORS = _C_OPS + _N_OPS + _S_OPS + _L_OPS + _E_OPS
_STRING_OPERATORS = _S_OPS + _E_OPS


class FilteringException(Exception):
    pass


def _is_uuid_key(key: str) -> bool:
    return (key.startswith("refs.") and key.endswith(".id")) or key in (
        "root.id",
        "tree.id",
        "node.id",
        "parent.id",
    )


def _is_literal_key(key: str) -> bool:
    return (key.startswith("refs.") and key.endswith(".slug")) or key in (
        "tree.type",
        "node.type",
        "node.name",
        "status.code",
        "exception.type",
        "otel.kind",
    )


def _is_integer_key(key: str) -> bool:
    return key.startswith("refs.") and key.endswith(".version")


def _is_float_key(key: str) -> bool:
    return key.startswith(("metrics.unit.", "metrics.acc."))


def _is_datetime_key(key: str) -> bool:
    return key in ("time.start", "time.end", "exception.timestamp")


def _is_string_key(key: str) -> bool:
    return key in ("content")


def parse_filtering_value(
    condition: ConditionDTO,
    to_type: Callable[[str], Any],
    key_type: str,
) -> None:
    try:
        condition.value = to_type(condition.value)
    except ValueError as exc:
        raise FilteringException(
            f"Unexpected value '{condition.value}' "
            f"for {key_type} key '{condition.key}', "
            f"please use a valid {key_type}"
        ) from exc


def parse_filtering_operator(
    condition: ConditionDTO,
    allowed_operators: List[Enum],
    key_type: str,
):
    if condition.operator not in allowed_operators:
        operators = [e.value for e in allowed_operators]

        raise FilteringException(
            f"Unexpected operator '{condition.operator.value}' "
            f"for {key_type} key '{condition.key}', "
            f"please use one of {operators}"
        )


def parse_condition(condition: ConditionDTO) -> None:
    if _is_uuid_key(condition.key):
        parse_filtering_value(condition, UUID, "uuid")
        parse_filtering_operator(condition, _UUID_OPERATORS, "uuid")

    if _is_literal_key(condition.key):
        parse_filtering_value(condition, str, "literal")
        parse_filtering_operator(condition, _LITERAL_OPERATORS, "literal")

    elif _is_integer_key(condition.key):
        parse_filtering_value(condition, int, "integer")
        parse_filtering_operator(condition, _INTEGER_OPERATORS, "integer")

    elif _is_float_key(condition.key):
        parse_filtering_value(condition, float, "float")
        parse_filtering_operator(condition, _FLOAT_OPERATORS, "float")

    elif _is_datetime_key(condition.key):
        parse_filtering_value(condition, datetime.fromisoformat, "datetime")
        parse_filtering_operator(condition, _DATETIME_OPERATORS, "datetime")

    elif _is_string_key(condition.key):
        parse_filtering_value(condition, str, "string")
        parse_filtering_operator(condition, _STRING_OPERATORS, "string")

    else:  # All other keys support any operators (conditionally)
        pass


def parse_filtering(
    filtering: FilteringDTO,
) -> None:
    for condition in filtering.conditions:
        if isinstance(condition, FilteringDTO):
            parse_filtering(condition)
        elif isinstance(condition, ConditionDTO):
            parse_condition(condition)
        else:
            raise ValueError("Invalid filtering request: unexpected JSON format")


def parse_ingest_value(
    attributes: Dict[str, Any],
    to_type: Callable[[str], Any],
    key: str,
) -> None:
    try:
        attributes[key] = to_type(attributes[key])
    except ValueError:
        print_exc()
        print(f"key='{key}' attribute='{attributes[key]}' type='{to_type}'")

        del attributes[key]


def parse_ingest(
    span_dtos: List[SpanDTO],
) -> None:
    for span_dto in span_dtos:
        typecheck = {
            "meta": span_dto.meta,
            "metrics": span_dto.metrics,
            "refs": span_dto.refs,
        }
        for field, attributes in typecheck.items():
            if attributes is not None:
                for key in list(attributes.keys()):
                    scoped_key = f"{field}.{key}"
                    if _is_uuid_key(scoped_key):
                        parse_ingest_value(attributes, UUID, key)
                    elif _is_literal_key(scoped_key):
                        parse_ingest_value(attributes, str, key)
                    elif _is_integer_key(scoped_key):
                        parse_ingest_value(attributes, int, key)
                    elif _is_float_key(scoped_key):
                        parse_ingest_value(attributes, float, key)
                    elif _is_datetime_key(scoped_key):
                        parse_ingest_value(attributes, datetime.fromisoformat, key)
                    elif _is_string_key(scoped_key):
                        parse_ingest_value(attributes, str, key)
                    else:  # All other keys are supported as is
                        pass


def parse_span_dtos_to_span_idx(
    span_dtos: List[SpanDTO],
) -> Dict[str, SpanDTO]:
    span_idx = {span_dto.node.id: span_dto for span_dto in span_dtos}

    return span_idx


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, SpanDTO],
) -> OrderedDict:
    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: SpanDTO) -> None:
        if span_dto.parent is None:
            span_id_tree[span_dto.node.id] = OrderedDict()
            index[span_dto.node.id] = span_id_tree[span_dto.node.id]
        elif span_dto.parent.id in index:
            index[span_dto.parent.id][span_dto.node.id] = OrderedDict()
            index[span_dto.node.id] = index[span_dto.parent.id][span_dto.node.id]

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.time.start):
        push(span_dto)

    return span_id_tree


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
) -> None:
    def _get_unit(span: SpanDTO):
        if span.metrics is not None:
            return span.metrics.get("unit.costs.total", 0.0)

        return 0.0

    def _get_acc(span: SpanDTO):
        if span.metrics is not None:
            return span.metrics.get("acc.costs.total", 0.0)

        return 0.0

    def _acc(a: float, b: float):
        return a + b

    def _set(span: SpanDTO, cost: float):
        if span.metrics is None:
            span.metrics = {}

        if cost != 0.0:
            span.metrics["acc.costs.total"] = cost

    _cumulate_tree_dfs(spans_id_tree, spans_idx, _get_unit, _get_acc, _acc, _set)


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    def _get_unit(span: SpanDTO):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.metrics is not None:
            return {
                "prompt": span.metrics.get("unit.tokens.prompt", 0.0),
                "completion": span.metrics.get("unit.tokens.completion", 0.0),
                "total": span.metrics.get("unit.tokens.total", 0.0),
            }

        return _tokens

    def _get_acc(span: SpanDTO):
        _tokens = {
            "prompt": 0.0,
            "completion": 0.0,
            "total": 0.0,
        }

        if span.metrics is not None:
            return {
                "prompt": span.metrics.get("acc.tokens.prompt", 0.0),
                "completion": span.metrics.get("acc.tokens.completion", 0.0),
                "total": span.metrics.get("acc.tokens.total", 0.0),
            }

        return _tokens

    def _acc(a: dict, b: dict):
        return {
            "prompt": a.get("prompt", 0.0) + b.get("prompt", 0.0),
            "completion": a.get("completion", 0.0) + b.get("completion", 0.0),
            "total": a.get("total", 0.0) + b.get("total", 0.0),
        }

    def _set(span: SpanDTO, tokens: dict):
        if span.metrics is None:
            span.metrics = {}

        if tokens.get("prompt", 0.0) != 0.0:
            span.metrics["acc.tokens.prompt"] = tokens.get("prompt", 0.0)
        if tokens.get("completion", 0.0) != 0.0:
            span.metrics["acc.tokens.completion"] = (
                tokens.get("completion", 0.0)
                if tokens.get("completion", 0.0) != 0.0
                else None
            )
        if tokens.get("total", 0.0) != 0.0:
            span.metrics["acc.tokens.total"] = (
                tokens.get("total", 0.0) if tokens.get("total", 0.0) != 0.0 else None
            )

    _cumulate_tree_dfs(spans_id_tree, spans_idx, _get_unit, _get_acc, _acc, _set)


def _cumulate_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
    get_unit_metric,
    get_acc_metric,
    accumulate_metric,
    set_metric,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        cumulated_metric = get_unit_metric(spans_idx[span_id])

        _cumulate_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_unit_metric,
            get_acc_metric,
            accumulate_metric,
            set_metric,
        )

        for child_span_id in children_spans_id_tree.keys():
            marginal_metric = get_acc_metric(spans_idx[child_span_id])
            cumulated_metric = accumulate_metric(cumulated_metric, marginal_metric)

        set_metric(spans_idx[span_id], cumulated_metric)


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, SpanDTO],
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        parent_span = spans_idx[span_id]

        parent_span.nodes = dict()

        _connect_tree_dfs(children_spans_id_tree, spans_idx)

        for child_span_id in children_spans_id_tree.keys():
            child_span_name = spans_idx[child_span_id].node.name
            if child_span_name not in parent_span.nodes:
                parent_span.nodes[child_span_name] = spans_idx[child_span_id]
            else:
                if not isinstance(parent_span.nodes[child_span_name], list):
                    parent_span.nodes[child_span_name] = [
                        parent_span.nodes[child_span_name]
                    ]

                parent_span.nodes[child_span_name].append(spans_idx[child_span_id])

        if len(parent_span.nodes) == 0:
            parent_span.nodes = None


TYPES_WITH_COSTS = [
    "embedding",
    "query",
    "completion",
    "chat",
    "rerank",
]


def calculate_costs(span_idx: Dict[str, SpanDTO]):
    for span in span_idx.values():
        if (
            span.node.type
            and span.node.type.name.lower() in TYPES_WITH_COSTS
            and span.meta
            and span.metrics
        ):
            model = span.meta.get("response.model") or span.meta.get(
                "configuration.model"
            )
            prompt_tokens = span.metrics.get("unit.tokens.prompt", 0.0)
            completion_tokens = span.metrics.get("unit.tokens.completion", 0.0)

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

                span.metrics["unit.costs.prompt"] = prompt_cost
                span.metrics["unit.costs.completion"] = completion_cost
                span.metrics["unit.costs.total"] = total_cost

            except:  # pylint: disable=bare-except
                print("Failed to calculate costs:")
                print(
                    f"model={model}, prompt_tokens={prompt_tokens}, completion_tokens={completion_tokens}"
                )
