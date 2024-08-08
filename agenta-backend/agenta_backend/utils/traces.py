import logging
import traceback
from collections import OrderedDict
from copy import deepcopy

from typing import Any, Dict

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


INCLUDED_KEYS = ["start_time", "end_time", "inputs", "internals", "outputs"]

TRACE_DEFAULT_KEY = "__default__"


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

            span = {k: spans_index[id][k] for k in INCLUDED_KEYS}

            if TRACE_DEFAULT_KEY in span["outputs"]:
                span["outputs"] = span["outputs"][TRACE_DEFAULT_KEY]

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


SPECIAL_KEYS = [
    "inputs",
    "internals",
    "outputs",
]

SPANS_KEY = "spans"


def _parse_field_part(part):
    key = part
    idx = None

    # Check if part is indexed, if so split it
    if "[" in part and "]" in part:
        key = part.split("[")[0]
        idx = int(part.split("[")[1].split("]")[0])

    return key, idx


def get_field_value_from_trace_tree(tree: Dict[str, Any], field: str) -> Dict[str, Any]:
    """
    Retrieve the value of the key from the trace tree.

    Args:
        tree (Dict[str, Any]): The nested dictionary to retrieve the value from.
            i.e. inline trace
            e.g. tree["spans"]["rag"]["spans"]["retriever"]["internals"]["prompt"]
        key (str): The dot-separated key to access the value.
            e.g. rag.summarizer[0].outputs.report

    Returns:
        Dict[str, Any]: The retrieved value or None if the key does not exist or an error occurs.
    """
    separate_by_spans_key = True

    parts = field.split(".")

    try:
        for part in parts:
            # by default, expects something like 'retriever'
            key, idx = _parse_field_part(part)

            # before 'SPECIAL_KEYS', spans are nested within a 'spans' key
            # e.g. trace["spans"]["rag"]["spans"]["retriever"]...
            if key in SPECIAL_KEYS:
                separate_by_spans_key = False

            # after 'SPECIAL_KEYS', it is a normal dict.
            # e.g. trace[...]["internals"]["prompt"]
            if separate_by_spans_key:
                tree = tree[SPANS_KEY]

            tree = tree[key]

            if idx is not None:
                tree = tree[idx]

        return tree

    # Suppress all Exception and leave Exception management to the caller.
    except Exception as e:
        logger.error(f"Error retrieving trace value from key: {traceback.format_exc()}")
        return None
