import traceback
from copy import deepcopy
from collections import OrderedDict
from typing import Any, Dict, Union, Optional

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def remove_trace_prefix(
    mapping_dict: Optional[Dict] = None, settings_values: Optional[Dict] = None
) -> Dict:
    """
    Modify the values of the mapping dictionary to remove 'trace.' prefix if it exists.

    Args:
        mapping_dict (Optional[Dict]): A dictionary containing the mapping values.
        settings_values (Optional[Dict]): A dictionary with keys like "answer_key",
                                          "contexts_key", "question_key" to override
                                          specific mapping values.

    Returns:
        Dict: A dictionary with the 'trace.' prefix removed from any string values.

    Raises:
        ValueError: If neither `mapping_dict` nor `settings_values` is provided.

    """

    if mapping_dict is None and settings_values is None:
        raise ValueError("No mapping dictionary or settings values provided")

    # Determine which dictionary to use
    if settings_values:
        mapping_values = {
            "answer_key": settings_values.get("answer_key"),
            "contexts_key": settings_values.get("contexts_key"),
            "question_key": settings_values.get("question_key"),
        }
    elif mapping_dict:
        mapping_values = mapping_dict
    else:
        mapping_values = {}

    # Update the mapping by removing the 'trace.' prefix from string values
    updated_mapping_dict = {
        key: value.replace("trace.", "") if isinstance(value, str) else value
        for key, value in mapping_values.items()
        if value is not None
    }

    return updated_mapping_dict


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
        if span.get("parent_span_id") is None:
            tree[span["id"]] = OrderedDict()
            index[span["id"]] = tree[span["id"]]
        elif span.get("parent_span_id") in index:
            index[span["parent_span_id"]][span["id"]] = OrderedDict()
            index[span["id"]] = index[span["parent_span_id"]][span["id"]]
        else:
            log.error("The parent span id should have been in the tracing tree.")

    for span in sorted(trace["spans"], key=lambda span: span["start_time"]):
        push(span)

    return tree


def _make_nested_nodes_tree(tree: dict):
    """
    Creates a nested tree structure from a flat list of nodes.

    Args:
        tree: {tree: {nodes: List[Node]}}

    Returns:
        tree: {[node_id]: tree(node_id)} # recursive
            e.g. {node_id_0: {node_id_0_0: {}, node_id_0_1: {}}}
            for:
                node_id_0
                    node_id_0_0
                    node_id_0_1
    """

    ordered_tree = OrderedDict()

    def add_node(node: Union[dict, list], parent_tree: dict):
        """
        Recursively adds a node and its children to the parent tree.
        """
        if isinstance(node, list):
            # If node is a list, process each item as a child node
            for child_node in node:
                add_node(child_node, parent_tree)
            return

        # If the node is a dictionary, proceed with its normal structure
        node_id = node["node"]["id"]
        parent_tree[node_id] = OrderedDict()

        # If there are child nodes, recursively add them
        if "nodes" in node and node["nodes"]:
            child_nodes = node["nodes"]
            if isinstance(child_nodes, list):
                # If child nodes are a list, iterate over each one
                for child_node in child_nodes:
                    add_node(child_node, parent_tree[node_id])
            elif isinstance(child_nodes, dict):
                # If child nodes are a dictionary, add them recursively
                for child_key, child_node in child_nodes.items():
                    add_node(child_node, parent_tree[node_id])

    # Process the top-level nodes
    for node in tree["nodes"]:
        add_node(node, ordered_tree)

    return ordered_tree


def _make_nodes_ids(ordered_dict: OrderedDict):
    """
    Recursively converts an OrderedDict to a plain dict.

    Args:
        ordered_dict (OrderedDict): The OrderedDict to convert.

    Returns:
        dict: A plain dictionary representation of the OrderedDict.
    """

    if isinstance(ordered_dict, OrderedDict):
        return {key: _make_nodes_ids(value) for key, value in ordered_dict.items()}
    return ordered_dict


def _build_nodes_tree(nodes_id: dict, tree_nodes: list):
    """
    Recursively builds a dictionary of node keys from a dictionary of nodes.

    Args:
        nodes_id (dict): The dictionary representing the nodes.
        tree_nodes (list): List[Node]

    Returns:
        List[dict]: A list of dictionary of unique node keys with their corresponding details from trace_tree.
    """

    def gather_nodes(nodes: list):
        result = {}
        stack = nodes[:]
        while stack:
            current = stack.pop()
            if isinstance(current, list):
                # If current is a list, process each item as a child node
                stack.extend(current)  # Add each item of the list to the stack
                continue  # Skip the rest of the logic for this item since it's a list

            node_id = current["node"]["id"]
            result[node_id] = current
            if "nodes" in current and current["nodes"] is not None:
                # If there are child nodes, add them to the stack for further processing
                child_nodes = current["nodes"]
                if isinstance(child_nodes, list):
                    stack.extend(
                        child_nodes
                    )  # If the child nodes are a list, add each to the stack
                elif isinstance(child_nodes, dict):
                    stack.extend(
                        child_nodes.values()
                    )  # If child nodes are a dict, add the values to the stack
        return result

    def extract_node_details(node_id: str, nodes: dict):
        """
        Helper function to extract relevant details for a node.
        """

        node_data = nodes.get(node_id, {})
        return {
            "lifecycle": node_data.get("lifecycle", {}),
            "root": node_data.get("root", {}),
            "tree": node_data.get("tree", {}),
            "node": node_data.get("node", {}),
            "parent": node_data.get("parent", None),
            "time": node_data.get("time", {}),
            "data": node_data.get("data"),
            "metrics": node_data.get("metrics"),
            "meta": node_data.get("meta"),
        }

    def recursive_flatten(current_nodes_id: dict, result: dict, nodes: dict):
        """
        Recursive function to flatten nodes into an ordered dictionary.
        """

        for node_id, child_nodes in current_nodes_id.items():
            # Add the current node details to the result
            result[node_id] = extract_node_details(node_id, nodes)

            # Recursively process child nodes
            if child_nodes:
                if isinstance(child_nodes, list):
                    for child_node in child_nodes:
                        recursive_flatten(
                            {child_node["node"]["id"]: child_node}, result, nodes
                        )
                elif isinstance(child_nodes, dict):
                    recursive_flatten(child_nodes, result, nodes)

    # Initialize the ordered dictionary and start the recursion
    ordered_result = dict()
    nodes = gather_nodes(nodes=tree_nodes)
    recursive_flatten(current_nodes_id=nodes_id, result=ordered_result, nodes=nodes)

    return list(ordered_result.values())


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

            span = {k: spans_index[id].get(k, None) for k in INCLUDED_KEYS}

            if TRACE_DEFAULT_KEY in span["outputs"]:
                span["outputs"] = span["outputs"][TRACE_DEFAULT_KEY]

            span.update({"spans": _make_spans_tree(children, spans_index)})

            if count[key] > 1:
                spans_tree[key].append(span)
            else:
                spans_tree[key] = span

    except Exception as e:
        log.error(e)
        log.error(traceback.format_exc())

    return spans_tree


def process_distributed_trace_into_trace_tree(trace: Any, version: str):
    """
    Creates trace tree from flat trace

    Args:
        trace: {trace_id : str, spans: List[Span]}

    Returns:
        trace: {trace_id: str, spans: spans_tree}
    """

    if version == "3.0":
        tree = trace  # swap trace name to tree
        trace_id = tree.get("nodes", [{}])[0].get("root", {}).get("id")
        spans_id_tree = _make_nested_nodes_tree(tree=tree)
        nodes_ids = _make_nodes_ids(ordered_dict=spans_id_tree)
        spans = _build_nodes_tree(nodes_id=nodes_ids, tree_nodes=tree["nodes"])

    elif version == "2.0":
        trace_id = trace["trace_id"]
        spans_id_tree = _make_spans_id_tree(trace)
        spans_index = {span["id"]: span for span in trace["spans"]}
        spans = _make_spans_tree(deepcopy(spans_id_tree), spans_index)

    else:
        trace_id = None
        spans = []

    trace = {"trace_id": trace_id, "spans": spans}

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


# --------------------------------------------------------------- #
# ------- HELPER FUNCTIONS TO GET FIELD VALUE FROM TRACE -------  #
# --------------------------------------------------------------- #


def get_field_value_from_trace_tree(
    tree: Dict[str, Any], field: str, version: str
) -> Dict[str, Any]:
    if version == "2.0":
        return get_field_value_from_trace_tree_v2(tree=tree, field=field)

    elif version == "3.0":
        return get_field_value_from_trace_tree_v3(trace_data=tree, key=field)

    return None


def get_field_value_from_trace_tree_v2(
    tree: Dict[str, Any],
    field: str,
):
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
    except Exception:
        log.error(f"Error retrieving trace value from key: {traceback.format_exc()}")
        return None


def get_field_value_from_trace_tree_v3(trace_data: Dict[str, any], key: str):
    """
    Retrieves a nested value from the trace data based on a hierarchical key.

    Args:
        trace_data (dict): A dictionary containing the trace_id and a list of node dictionaries in the trace data.
        key (str): The hierarchical key (e.g., "rag.retriever.internals.prompt").

    Returns:
        The value associated with the specified key, or None if not found.
    """

    try:
        # Parse the hierarchical key
        key_parts = key.split(".")

        # Start with the root node name
        current_name = key_parts.pop(0)

        # Find the root node
        current_node = next(
            (
                node
                for node in trace_data["spans"]
                if node["node"]["name"] == current_name
            ),
            None,
        )
        if not current_node:
            return None

        # Traverse the hierarchy
        for part in key_parts:
            if part in current_node:  # If the part is a direct key in the current node
                current_node = current_node[part]
            elif (
                "data" in current_node and part in current_node["data"]
            ):  # Check inside "data"
                current_node = current_node["data"][part]
            elif (
                "metrics" in current_node and part in current_node["metrics"]
            ):  # Check inside "metrics"
                current_node = current_node["metrics"][part]
            elif (
                "meta" in current_node
                and current_node["meta"]
                and part in current_node["meta"]
            ):  # Check inside "meta"
                current_node = current_node["meta"][part]
            else:  # Traverse to child node if it matches the "name"
                child_node = next(
                    (
                        node
                        for node in trace_data["spans"]
                        if node["node"]["name"] == part
                        and node["parent"]
                        and node["parent"]["id"] == current_node["node"]["id"]
                    ),
                    None,
                )
                if not child_node:
                    return None

                current_node = child_node

        return current_node

    except Exception:
        log.error(f"Error retrieving trace value from key: {traceback.format_exc()}")
        return None


# ---------------------------------------------------------------------- #
# ------- END OF HELPER FUNCTIONS TO GET FIELD VALUE FROM TRACE -------  #
# ---------------------------------------------------------------------- #
