from typing import List, Dict, OrderedDict

from agenta_backend.core.observability.dtos import SpanCreateDTO, SpanDTO


def parse_span_dtos_to_span_idx(
    span_dtos: List[SpanCreateDTO],
) -> Dict[str, SpanCreateDTO]:

    span_idx = {span_dto.node.id: span_dto for span_dto in span_dtos}

    return span_idx


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, SpanCreateDTO],
) -> OrderedDict:

    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: SpanCreateDTO) -> None:
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
    spans_idx: Dict[str, SpanCreateDTO],
) -> None:

    def _get_unit(span: SpanCreateDTO):
        if span.metrics is not None:
            return span.metrics.get("unit.costs.total", 0.0)

        return 0.0

    def _get_acc(span: SpanCreateDTO):
        if span.metrics is not None:
            return span.metrics.get("acc.costs.total", 0.0)

        return 0.0

    def _acc(a: float, b: float):
        return a + b

    def _set(span: SpanCreateDTO, cost: float):
        if span.metrics is None:
            span.metrics = {}

        if cost != 0.0:
            span.metrics["acc.costs.total"] = cost

    _cumulate_tree_dfs(spans_id_tree, spans_idx, _get_unit, _get_acc, _acc, _set)


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:

    def _get_unit(span: SpanCreateDTO):
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

    def _get_acc(span: SpanCreateDTO):
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

    def _set(span: SpanCreateDTO, tokens: dict):
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
    spans_idx: Dict[str, SpanCreateDTO],
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
