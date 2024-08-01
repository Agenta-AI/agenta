import logging
import traceback
from collections import OrderedDict
from copy import deepcopy

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def _make_spans_id_tree(trace):
    """
    Creates spans tree (id only) from flat spans list

    Args:
        trace: {trace_id : str, spans: List[Span]}

    Returns:
        tree: {[span_id]: tree(span_id)} # recursive
            e.g. {span_id_0: {span_id_0_0: {span_id_0_0_0: {}}, span_id_0_1: {}}}
            for:
                span_id_0
                    span_id_0_0
                        span_id_0_0_0
                    span_id_0_1
    """

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
            logging.error("The parent span id should have been in the tracing tree.")

    for span in sorted(trace["spans"], key=lambda span: span["start_time"]):
        push(span)

    return tree


def _make_spans_tree(spans_id_tree, spans_index):
    """
    Recursively collects and organizes span information into a dictionary.
    This function retrieves the current spans tree and extracts detailed data for each span.
    It processes spans in a tree structure, organizing them with their start time, end time, inputs, internals, and outputs.
    If an error occurs, it logs the error message and stack trace.

    Args:
        spans_id_tree: {[span_id]: spans_id_tree(span_id)} # recursive (ids only)
        index: {[span_id]: span}
    Returns:
        spans_tree: {[span_id]: spans_tree(span_id)} # recursive (full span)
    """
    spans_tree = dict()
    count = dict()

    try:
        for idx in spans_id_tree.keys():
            key = spans_index[idx]["name"]

            spans_tree[key] = list()
            count[key] = count.get(key, 0) + 1

        while len(spans_id_tree.keys()):
            id, children = spans_id_tree.popitem(last=False)

            key = spans_index[id]["name"]

            span = {
                "start_time": spans_index[id]["start_time"],
                "end_time": spans_index[id]["end_time"],
                "inputs": spans_index[id]["inputs"],
                "internals": spans_index[id]["internals"],
                "outputs": spans_index[id]["outputs"],
            }

            span.update({"spans": _make_spans_tree(children, spans_index)})

            if count[key] > 1:
                spans_tree[key].append(span)
            else:
                spans_tree[key] = span

    except Exception as e:
        logging.error(e)
        logging.error(traceback.format_exc())

    return spans_tree


def process_distributed_trace_into_trace_tree(trace):
    """
    Creates trace tree from flat trace

    Args:
        trace: {trace_id : str, spans: List[Span]}

    Returns:
        trace: {trace_id: str, spans: spans_tree}
    """

    spans_id_tree = _make_spans_id_tree(trace)
    spans_index = {span["id"]: span for span in trace["spans"]}
    trace = {
        "trace_id": trace["trace_id"],
        "spans": _make_spans_tree(deepcopy(spans_id_tree), spans_index),
    }

    return trace
