"""Attribute and AG-namespace helpers for tracing payloads."""

from copy import deepcopy
from re import match
from typing import Any, Dict, Optional, Tuple, Union

from oss.src.core.shared.dtos import Data, Flags, Meta, Tags
from oss.src.core.tracing.dtos import (
    AgAttributes,
    AgDataAttributes,
    AgMetricEntryAttributes,
    AgMetricsAttributes,
    AgTypeAttributes,
    Attributes,
    OTelAttributes,
)

URL_SAFE = r"^[a-zA-Z0-9_-]+$"

REFERENCE_KEYS = [
    "testcase",
    "testset",
    "testset_variant",
    "testset_revision",
    "query",
    "query_variant",
    "query_revision",
    "workflow",
    "workflow_variant",
    "workflow_revision",
    "application",
    "application_variant",
    "application_revision",
    "evaluator",
    "evaluator_variant",
    "evaluator_revision",
    "environment",
    "environment_variant",
    "environment_revision",
    "snippet",
    "snippet_variant",
    "snippet_revision",
]


def ensure_nested_dict(d: dict, *keys: str) -> dict:
    for key in keys:
        if key not in d or not isinstance(d[key], dict):
            d[key] = {}
        d = d[key]
    return d


def initialize_ag_attributes(attributes: Optional[dict]) -> dict:
    if not attributes or not isinstance(attributes, dict):
        attributes = {}

    ag = deepcopy(attributes.get("ag", {})) or {}
    unsupported = deepcopy(ag.get("unsupported", {})) or {}
    cleaned_ag = {}

    type_dict = ensure_nested_dict(ag, "type")
    cleaned_type = {
        key: type_dict.get(key, None) for key in AgTypeAttributes.model_fields
    }
    for key in type_dict:
        if key not in AgTypeAttributes.model_fields:
            unsupported.setdefault("type", {})[key] = type_dict[key]
    cleaned_ag["type"] = cleaned_type

    data_dict = ensure_nested_dict(ag, "data")
    cleaned_data = {
        key: data_dict.get(key, None) for key in AgDataAttributes.model_fields
    }
    for key in data_dict:
        if key not in AgDataAttributes.model_fields:
            unsupported.setdefault("data", {})[key] = data_dict[key]
    cleaned_ag["data"] = cleaned_data

    metrics_dict = ensure_nested_dict(ag, "metrics")
    cleaned_metrics = {}
    for metric_key in AgMetricsAttributes.model_fields:
        raw_entry = ensure_nested_dict(metrics_dict, metric_key)
        cleaned_entry = {
            subkey: raw_entry.get(subkey, None)
            for subkey in AgMetricEntryAttributes.model_fields
        }
        cleaned_metrics[metric_key] = cleaned_entry
        for subkey in list(raw_entry.keys()):
            if subkey not in AgMetricEntryAttributes.model_fields:
                unsupported.setdefault("metrics", {}).setdefault(metric_key, {})[
                    subkey
                ] = raw_entry[subkey]

    for metric_key in list(metrics_dict.keys()):
        if metric_key not in AgMetricsAttributes.model_fields:
            unsupported.setdefault("metrics", {})[metric_key] = metrics_dict[metric_key]

    cleaned_ag["metrics"] = cleaned_metrics

    references_dict = ensure_nested_dict(ag, "references")
    cleaned_references = {}
    if isinstance(references_dict, dict):
        for key in references_dict:
            if key in REFERENCE_KEYS:
                entry: Dict[str, Optional[str]] = dict()
                if references_dict[key].get("id") is not None:
                    entry["id"] = str(references_dict[key]["id"])
                if references_dict[key].get("slug") is not None:
                    entry["slug"] = str(references_dict[key]["slug"])
                    if entry["slug"] and not match(URL_SAFE, entry["slug"]):
                        entry["slug"] = None
                if references_dict[key].get("version") is not None:
                    entry["version"] = str(references_dict[key]["version"])
                cleaned_references[key] = entry
    cleaned_ag["references"] = cleaned_references or None

    session_dict = ag.get("session")
    if session_dict and isinstance(session_dict, dict):
        cleaned_session = {}
        if "id" in session_dict:
            cleaned_session["id"] = session_dict["id"]
        cleaned_ag["session"] = cleaned_session if cleaned_session else None
    else:
        cleaned_ag["session"] = None

    user_dict = ag.get("user")
    if user_dict and isinstance(user_dict, dict):
        cleaned_user = {}
        if "id" in user_dict:
            cleaned_user["id"] = user_dict["id"]
        cleaned_ag["user"] = cleaned_user if cleaned_user else None
    else:
        cleaned_ag["user"] = None

    for key in ["flags", "tags", "meta", "exception", "hashes"]:
        cleaned_ag[key] = ag.get(key, None)

    if "meta" in cleaned_ag and cleaned_ag["meta"] is not None:
        if "configuration" in cleaned_ag["meta"]:
            if cleaned_ag["data"]["parameters"] is None:
                cleaned_ag["data"]["parameters"] = cleaned_ag["meta"]["configuration"]
            del cleaned_ag["meta"]["configuration"]
            if not cleaned_ag["meta"]:
                cleaned_ag["meta"] = None

    for key in ag:
        if key not in AgAttributes.model_fields:
            if key == "refs":
                continue
            unsupported[key] = ag[key]

    cleaned_ag["unsupported"] = unsupported or None
    cleaned_ag = AgAttributes(**cleaned_ag).model_dump(mode="json", exclude_none=True)
    attributes["ag"] = cleaned_ag
    return attributes


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
