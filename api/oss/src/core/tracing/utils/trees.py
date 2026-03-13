from collections import OrderedDict
from typing import Dict, List, Optional

from litellm import cost_calculator

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Trace, Traces
from oss.src.core.tracing.dtos import (
    OTelFlatSpan,
    OTelSpan,
    OTelSpansTree,
    OTelTraceTree,
    Span,
)

log = get_module_logger(__name__)


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


def calculate_and_propagate_metrics_by_trace(
    span_dtos: List[OTelFlatSpan],
) -> List[OTelFlatSpan]:
    """
    Calculate metrics for each trace independently within a mixed batch.

    Some ingestion requests can carry spans from multiple traces. Metric
    propagation must remain trace-local, so we group by trace_id first and
    process each trace tree separately before flattening back to one list.
    """
    if not span_dtos:
        return span_dtos

    spans_by_trace: Dict[str, List[OTelFlatSpan]] = {}

    for span_dto in span_dtos:
        trace_key = str(span_dto.trace_id)
        spans_by_trace.setdefault(trace_key, []).append(span_dto)

    processed: List[OTelFlatSpan] = []
    for trace_spans in spans_by_trace.values():
        processed.extend(calculate_and_propagate_metrics(trace_spans))

    return processed


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


def trace_map_to_traces(trace_map: OTelTraceTree) -> Traces:
    traces: Traces = []
    for tid, spans_tree in trace_map.items():
        if isinstance(spans_tree, dict):
            spans = spans_tree.get("spans")
        else:
            spans = spans_tree.spans
        traces.append(Trace(trace_id=str(tid), spans=spans))
    return traces


def traces_to_trace_map(traces: Traces) -> OTelTraceTree:
    trace_map: OTelTraceTree = {}
    for trace in traces:
        if not trace.trace_id:
            continue
        trace_map[str(trace.trace_id)] = OTelSpansTree(spans=trace.spans)
    return trace_map


def get_span_from_trace(trace: Optional[Trace], span_id: str) -> Optional[Span]:
    if not trace or not trace.spans:
        return None
    for span in trace.spans.values():
        if isinstance(span, list):
            for item in span:
                if item and item.span_id == span_id:
                    return item
        elif span and span.span_id == span_id:
            return span
    return None
