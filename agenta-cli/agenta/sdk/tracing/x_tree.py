from typing import Dict
from collections import OrderedDict


from agenta.sdk.utils.logging import log


def make_spans_id_tree(
    spans: Dict[str, dict],
):
    tree = OrderedDict()
    index = {}

    def push(span) -> None:
        if span["parent_span_id"] is None:
            tree[span["id"]] = OrderedDict()
            index[span["id"]] = tree[span["id"]]
        elif span["parent_span_id"] in index:
            index[span["parent_span_id"]][span["id"]] = OrderedDict()
            index[span["id"]] = index[span["parent_span_id"]][span["id"]]
        else:
            log.error("The parent span id should have been in the tracing tree.")

    for span in sorted(spans.values(), key=lambda span: span["start_time"]):
        push(span)

    return tree


def cumulate_costs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
):
    def _get(span):
        return span["cost"]

    def _acc(a, b):
        return a + b

    def _set(span, cost):
        span["cost"] = cost

    _visit_tree_dfs(spans_id_tree, spans_idx, _get, _acc, _set)


def cumulate_tokens(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
):
    def _get(span):
        return span["tokens"]

    def _acc(a, b):
        return {
            "prompt_tokens": a["prompt_tokens"] + b["prompt_tokens"],
            "completion_tokens": a["completion_tokens"] + b["completion_tokens"],
            "total_tokens": a["total_tokens"] + b["total_tokens"],
        }

    def _set(span, tokens):
        span["tokens"] = tokens

    _visit_tree_dfs(spans_id_tree, spans_idx, _get, _acc, _set)


def _visit_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
    get_metric,
    accumulate_metric,
    set_metric,
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        cumulated_metric = get_metric(spans_idx[span_id])

        _visit_tree_dfs(
            children_spans_id_tree,
            spans_idx,
            get_metric,
            accumulate_metric,
            set_metric,
        )

        for child_span_id in children_spans_id_tree.keys():
            child_metric = get_metric(spans_idx[child_span_id])
            cumulated_metric = accumulate_metric(cumulated_metric, child_metric)

        set_metric(spans_idx[span_id], cumulated_metric)
