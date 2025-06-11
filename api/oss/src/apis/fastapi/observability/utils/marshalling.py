from typing import Any, Dict, List, Union
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__file__)


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


def unmarshal_attributes(
    marshalled: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Unmarshals a dictionary of marshalled attributes into a nested dictionary

    Example:
    marshalled = {
        "ag.type": "tree",
        "ag.node.name": "root",
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
