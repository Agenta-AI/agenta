"""The spike harness.

It plays the three layers the model talks to:

- the **runner**: resolves ``$content_from`` markers against a simulated workspace,
  and refuses a path outside the import root;
- the **commit wrapper**: checks ``base_revision_id`` against the head, then applies;
- the **engine**: the real ``apply_change_set`` prototype, unmodified.

The model never sees Python. It sees one tool, its JSON schema, its description (the
instruction document under test), and the tool results the three layers return.
"""

import copy
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from change_set import ChangeSetError, apply_change_set
from tasks import IMPORT_ROOT, WORKSPACE

TOOL_NAME = "commit_workflow_revision"

MARKER = "$content_from"
MARKER_V3 = "@ag.file"
MARKERS = (MARKER, MARKER_V3)

V3_SURFACE = False  # schema advertises {"list": ...} and @ag.file, and message is optional
V4_SURFACE = False  # V3 plus: no value_from at all; the schema documents the item shape


# --------------------------------------------------------------------------------------
# The runner: resolve content markers
# --------------------------------------------------------------------------------------


class RunnerRefusal(Exception):
    def __init__(self, reason: str, message: str, retryable: bool = True, **ctx: Any):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.retryable = retryable
        self.ctx = ctx

    def to_detail(self) -> Dict[str, Any]:
        reason = {"code": self.reason, "message": self.message}
        reason.update(self.ctx)
        return {
            "code": "change_set_rejected",
            "message": "No revision was committed.",
            "reason": reason,
            "retryable": self.retryable,
        }


def resolve_markers(value: Any) -> Any:
    """Replace every ``{"$content_from": path}`` object with the file's text."""
    if isinstance(value, dict):
        found = [m for m in MARKERS if m in value]
        if found and set(value) == {found[0]}:
            path = value[found[0]]
            if not isinstance(path, str) or not path:
                raise RunnerRefusal(
                    "source_invalid",
                    f"'{found[0]}' needs a non-empty workspace path.",
                    retryable=False,
                )
            return _materialize_file(path)
        if found and len(value) > 1:
            raise RunnerRefusal(
                "source_invalid",
                f"An object that carries '{found[0]}' must carry nothing else. "
                f"Found: {sorted(value)}.",
                retryable=False,
            )
        return {key: resolve_markers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_markers(item) for item in value]
    return value


# --------------------------------------------------------------------------------------
# The runner: resolve the contract's `value_from` source
# --------------------------------------------------------------------------------------

RICH_ERRORS = False  # set by the runner: does source_not_found list what does exist?


def _import_folders() -> List[str]:
    return sorted(
        {
            f"{IMPORT_ROOT}{key[len(IMPORT_ROOT):].split('/')[0]}/"
            for key in WORKSPACE
            if key.startswith(IMPORT_ROOT)
        }
    )


def _not_found(path: str) -> "RunnerRefusal":
    ctx: Dict[str, Any] = {"path": path}
    if RICH_ERRORS:
        ctx["folders_under_import_root"] = _import_folders()
    return RunnerRefusal(
        "source_not_found",
        f"The workspace has no file at {path!r}.",
        **ctx,
    )


def _check_root(path: str) -> None:
    if not path.startswith(IMPORT_ROOT):
        raise RunnerRefusal(
            "source_outside_import_root",
            f"The workspace path {path!r} is outside the import root. "
            f"Only files under '{IMPORT_ROOT}' can be imported.",
            import_root=IMPORT_ROOT,
            path=path,
            folders_under_import_root=_import_folders(),
        )


def _split_frontmatter(text: str) -> Tuple[str, Dict[str, str]]:
    if not text.startswith("---\n"):
        return text, {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return text, {}
    meta: Dict[str, str] = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return text[end + 5 :], meta


def _materialize_folder(path: str) -> Dict[str, Any]:
    """The contract's folder source: one workspace folder becomes one skill entry."""
    _check_root(path)
    folder = path.rstrip("/") + "/"
    files = {
        key[len(folder) :]: value
        for key, value in WORKSPACE.items()
        if key.startswith(folder)
    }
    if not files:
        raise _not_found(path)
    if "SKILL.md" not in files:
        raise RunnerRefusal(
            "source_invalid",
            f"The folder {path!r} has no SKILL.md, so it is not a skill folder.",
            retryable=False,
        )
    body, meta = _split_frontmatter(files["SKILL.md"])
    return {
        "name": meta.get("name") or folder.rstrip("/").split("/")[-1],
        "description": meta.get("description", ""),
        "body": body,
        "files": [
            {"path": name, "content": content}
            for name, content in sorted(files.items())
            if name != "SKILL.md"
        ],
    }


def _materialize_file(path: str) -> str:
    _check_root(path)
    if path not in WORKSPACE:
        raise _not_found(path)
    return WORKSPACE[path]


def resolve_value_from(delta: Any) -> Any:
    """Turn every `value_from` on an operation into an inline `value`, then strip it.

    Folder source on `add_item` / `replace_item`; single file on `set`. `merge`,
    `remove`, `edit_text`, and `remove_item` may not carry it at all.
    """
    if not isinstance(delta, dict):
        return delta
    operations = delta.get("operations")
    if not isinstance(operations, list):
        return delta

    out = []
    for operation in operations:
        if not isinstance(operation, dict) or "value_from" not in operation:
            out.append(operation)
            continue
        verb = operation.get("operation")
        if V4_SURFACE:
            raise RunnerRefusal(
                "source_invalid",
                "'value_from' no longer exists. Reference a workspace file inline with "
                '{"@ag.file": "<path>"} in the string position that needs its content.',
                retryable=True,
            )
        source = operation["value_from"]
        if not isinstance(source, dict) or not source.get("path"):
            raise RunnerRefusal(
                "source_invalid",
                "'value_from' needs {\"type\": \"workspace\", \"path\": \"...\"}.",
                retryable=False,
            )
        if verb in ("add_item", "replace_item"):
            value: Any = _materialize_folder(source["path"])
        elif verb == "set":
            value = _materialize_file(source["path"])
        else:
            raise RunnerRefusal(
                "invalid_operation",
                f"'{verb}' does not take 'value_from'. Only set, add_item, and "
                "replace_item do.",
                retryable=False,
            )
        replacement = {k: v for k, v in operation.items() if k != "value_from"}
        replacement["value"] = value
        out.append(replacement)

    return dict(delta, operations=out)


# --------------------------------------------------------------------------------------
# The lenient interface arm: forgive the two target-grammar mistakes every model makes
# --------------------------------------------------------------------------------------

LENIENT = False

# Which field names key which collection, so a selector that names the key field instead
# of the collection can be repaired.
_KEY_FIELD_OF = {"skills": "name", "mcps": "name", "tools": "name", "files": "path"}
_COLLECTION_OF_KEY_FIELD = {"path": "files"}


def _canonical_selector(segment: Any) -> Any:
    """Accept ``{"list": L, "key": K}`` and hand the engine its ``{"field": ...}`` form."""
    if isinstance(segment, dict) and "list" in segment and "field" not in segment:
        out = {"field": segment["list"], "key": segment.get("key")}
        return out if out["key"] is not None else segment
    return segment


def normalize_target(segments: Any) -> Any:
    """Repair the two mistakes the trials showed, without changing anything else.

    1. The list name repeated before its own selector:
       ``["...","skills",{"field":"skills","key":K}]`` -> the string segment is dropped.
    2. The selector's ``field`` holding the KEY field instead of the collection:
       ``["...","files",{"field":"path","key":K}]`` -> ``{"field":"files","key":K}``.
    """
    if not isinstance(segments, list):
        return segments
    out: List[Any] = []
    for segment in [_canonical_selector(x) for x in segments]:
        if (
            isinstance(segment, dict)
            and set(segment) == {"field", "key"}
            and out
            and isinstance(out[-1], str)
        ):
            previous = out[-1]
            field = segment["field"]
            # case 2: the selector names the key field; the previous segment names the list
            if previous in _KEY_FIELD_OF and field == _KEY_FIELD_OF[previous]:
                out.pop()
                out.append({"field": previous, "key": segment["key"]})
                continue
            # case 1: the selector repeats the list name
            if previous == field:
                out.pop()
                out.append(segment)
                continue
        out.append(segment)
    return out


def normalize_delta(delta: Any) -> Any:
    if not isinstance(delta, dict):
        return delta
    if not LENIENT and not V3_SURFACE:
        return delta
    operations = delta.get("operations")
    if not isinstance(operations, list):
        return delta
    return dict(
        delta,
        operations=[
            dict(op, target=normalize_target(op.get("target")))
            if isinstance(op, dict) and "target" in op
            else op
            for op in operations
        ],
    )


def _closest_fragments(text: str, old_text: str, limit: int = 3) -> List[str]:
    """Lines of the target that look like the anchor the model failed to match.

    A `text_not_found` today says only "it does not occur". The trials show the model
    then guesses at whitespace until it runs out of retries. Showing the real lines ends
    that loop.
    """
    import difflib

    wanted = " ".join(old_text.split())[:80].lower()
    if not wanted:
        return []
    lines = text.splitlines()
    scored = []
    for index, line in enumerate(lines):
        candidate = " ".join(line.split()).lower()
        if not candidate:
            continue
        ratio = difflib.SequenceMatcher(None, wanted, candidate).ratio()
        if wanted[:40] in candidate or candidate in wanted or ratio > 0.5:
            window = "\n".join(lines[index : index + 2])
            scored.append((ratio, window))
    scored.sort(reverse=True)
    seen: List[str] = []
    for _, window in scored:
        if window not in seen:
            seen.append(window)
        if len(seen) >= limit:
            break
    return seen


# One instruction sentence per retryable reason code. The v3 document drops all recovery
# guidance, so the errors themselves must carry it.
NEXT_STEP = {
    "target_not_found": "Check the target against the configuration you read. A "
    "{list, key} selector stands in place of the list's own name, so the list name must "
    "not appear as a segment before it.",
    "target_type_mismatch": "Check the target. A {list, key} selector stands in place of "
    "the list's own name; do not write the list name and then a selector.",
    "item_not_found": "Read the list and use one of the keys it actually holds.",
    "item_already_exists": "Use replace_item to change the existing entry, or pick a new "
    "key.",
    "duplicate_item_key": "Two entries share this key. Remove one before editing this "
    "list.",
    "text_not_unique": "Add surrounding lines to the anchor until it occurs exactly once.",
    "text_edits_overlap": "Two anchors share characters. Merge them into one edit.",
    "no_change": "The edits change nothing. Check the anchor and the replacement.",
    "empty_old_text": "old_text must not be empty.",
    "unkeyed_collection": "Only skills, mcps, tools, and files can be addressed by key.",
    "item_key_undefined": "The value needs a 'name' the entry can be addressed by.",
    "invalid_operation": "Fix the shape of the operation and send it again.",
    "final_validation_failed": "The finished configuration is not valid. Read the issues "
    "and correct the change.",
}


def enrich_error(
    detail: Dict[str, Any], delta: Any, config: Dict[str, Any]
) -> Dict[str, Any]:
    """Add the one fact each dead-end error is missing."""
    if not LENIENT:
        return detail
    reason = detail.get("reason") or {}
    code = reason.get("code")
    # Guidance is attached even when the engine calls the code non-retryable.
    # `invalid_operation` covers the rename case, which the agent CAN fix by sending
    # remove_item + add_item, so withholding the sentence there would be wrong.
    if code in NEXT_STEP:
        reason["next_step"] = NEXT_STEP[code]
    if code == "text_not_found":
        index = detail.get("operation_index")
        try:
            operation = delta["operations"][index]
            text = _walk_config(config, operation["target"])
            old_text = operation["edits"][reason.get("edit_index", 0)]["old_text"]
        except Exception:  # noqa: BLE001
            return detail
        if isinstance(text, str):
            candidates = _closest_fragments(text, old_text)
            if candidates:
                reason["nearest_text_in_target"] = candidates
                reason["message"] = (
                    reason.get("message", "")
                    + " These lines of the target look closest; copy one of them "
                    "exactly, line breaks included."
                )
    return detail


def _walk_config(config: Dict[str, Any], segments: Any) -> Any:
    node: Any = config
    for segment in normalize_target(segments):
        if isinstance(segment, str):
            if not isinstance(node, dict) or segment not in node:
                return None
            node = node[segment]
        elif isinstance(segment, dict):
            collection = node.get(segment.get("field")) if isinstance(node, dict) else None
            if not isinstance(collection, list):
                return None
            key_field = _KEY_FIELD_OF.get(segment.get("field"), "name")
            match = [e for e in collection if isinstance(e, dict) and e.get(key_field) == segment.get("key")]
            if len(match) != 1:
                return None
            node = match[0]
    return node


# --------------------------------------------------------------------------------------
# The commit wrapper
# --------------------------------------------------------------------------------------


def run_commit(
    envelope: Any,
    *,
    head_config: Dict[str, Any],
    head_revision_id: str,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """``(new_config_or_None, tool_result_payload)``."""
    if not isinstance(envelope, dict):
        return None, {
            "error": {
                "code": "invalid_request",
                "message": "The tool input must be a JSON object.",
                "retryable": False,
            }
        }
    revision = envelope.get("workflow_revision")
    if not isinstance(revision, dict):
        return None, {
            "error": {
                "code": "invalid_request",
                "message": "The tool input needs a 'workflow_revision' object.",
                "retryable": False,
            }
        }

    base_revision_id = revision.get("base_revision_id")
    if not base_revision_id:
        return None, {
            "error": {
                "code": "missing_base_revision_id",
                "message": "An ordered delta needs 'base_revision_id'. Copy it from the "
                "configuration you read.",
                "retryable": True,
            }
        }
    if base_revision_id != head_revision_id:
        return None, {
            "error": {
                "code": "stale_base_revision",
                "message": "Someone committed while you were working. Re-read the "
                "configuration and send your change again against the new head.",
                "your_base_revision_id": base_revision_id,
                "head_revision_id": head_revision_id,
                "retryable": True,
            }
        }

    delta = revision.get("delta")
    if not isinstance(delta, dict):
        return None, {
            "error": {
                "code": "invalid_request",
                "message": "'workflow_revision.delta' must be an object.",
                "retryable": False,
            }
        }

    delta = normalize_delta(delta)

    try:
        resolved = resolve_markers(resolve_value_from(delta))
    except RunnerRefusal as refusal:
        return None, {"error": refusal.to_detail()}

    try:
        result = apply_change_set(copy.deepcopy(head_config), resolved)
    except ChangeSetError as error:
        return None, {
            "error": enrich_error(error.to_detail(), resolved, head_config)
        }

    return result, {
        "committed": True,
        "revision_id": "019c8a10-0000-7000-8000-0000000000ff",
    }


# --------------------------------------------------------------------------------------
# The tool schema
# --------------------------------------------------------------------------------------

_SEGMENT = {
    "oneOf": [
        {"type": "string", "minLength": 1},
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["SELECTOR_KEY", "key"],
            "properties": {
                "SELECTOR_KEY": {"type": "string", "minLength": 1},
                "key": {"type": "string", "minLength": 1},
            },
        },
    ]
}

_TARGET = {
    "type": "array",
    "minItems": 1,
    "maxItems": 12,
    "items": _SEGMENT,
    "description": "The path to the field or list entry this operation addresses.",
}

_EDITS = {
    "type": "array",
    "minItems": 1,
    "maxItems": 32,
    "items": {
        "type": "object",
        "additionalProperties": False,
        "required": ["old_text", "new_text"],
        "properties": {
            "old_text": {"type": "string", "minLength": 1, "maxLength": 20000},
            "new_text": {"type": "string", "maxLength": 50000},
        },
    },
}

_SOURCE = {
    "type": "object",
    "additionalProperties": False,
    "required": ["type", "path"],
    "properties": {
        "type": {"const": "workspace"},
        "path": {"type": "string", "minLength": 1},
    },
}

_FLAT_OPERATION = {
    "type": "object",
    "additionalProperties": False,
    "required": ["operation", "target"],
    "properties": {
        "operation": {
            "type": "string",
            "enum": [
                "set",
                "merge",
                "remove",
                "edit_text",
                "add_item",
                "replace_item",
                "remove_item",
            ],
        },
        "target": _TARGET,
        "value": {"description": "VALUE_DESCRIPTION"},
        "edits": dict(_EDITS, description="Only for edit_text."),
        "value_from": dict(
            _SOURCE, description="Only for set, add_item, replace_item."
        ),
    },
}


def _member(operation: str, *, target_tail: str, value: bool, edits: bool) -> dict:
    props: Dict[str, Any] = {
        "operation": {"const": operation},
        "target": _TARGET,
    }
    required = ["operation", "target"]
    if value:
        props["value"] = {"description": "VALUE_DESCRIPTION"}
        props["value_from"] = _SOURCE
        required.append("value")
    if edits:
        props["edits"] = _EDITS
        required.append("edits")
    if "value_from" in props:
        required = [item for item in required if item != "value"]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": props,
        "description": target_tail,
    }


_UNION_OPERATION = {
    "oneOf": [
        _member(
            "set",
            target_tail="Replace one field. The last target segment is a field name.",
            value=True,
            edits=False,
        ),
        _member(
            "merge",
            target_tail="Deep-merge an object into one field.",
            value=True,
            edits=False,
        ),
        _member(
            "remove",
            target_tail="Delete one field.",
            value=False,
            edits=False,
        ),
        _member(
            "edit_text",
            target_tail="Replace exact substrings inside one string field.",
            value=False,
            edits=True,
        ),
        _member(
            "add_item",
            target_tail="Append one entry. The last target segment is the list name.",
            value=True,
            edits=False,
        ),
        _member(
            "replace_item",
            target_tail="Replace one named entry. The last segment is {field, key}.",
            value=True,
            edits=False,
        ),
        _member(
            "remove_item",
            target_tail="Delete one named entry. The last segment is {field, key}.",
            value=False,
            edits=False,
        ),
    ]
}


def _strip_value_from(node: Any) -> None:
    """Remove every `value_from` property from a schema tree, in place."""
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict):
            props.pop("value_from", None)
        for child in node.values():
            _strip_value_from(child)
    elif isinstance(node, list):
        for child in node:
            _strip_value_from(child)


def tool_schema(*, union: bool = False) -> Dict[str, Any]:
    operation = _UNION_OPERATION if union else _FLAT_OPERATION
    selector_key = "list" if (V3_SURFACE or V4_SURFACE) else "field"
    blob = json.dumps(operation).replace("SELECTOR_KEY", selector_key)
    if V4_SURFACE:
        # The folder source is gone; the schema documents the item shape instead.
        operation = json.loads(blob)
        _strip_value_from(operation)
        operation = json.loads(
            json.dumps(operation).replace(
                "VALUE_DESCRIPTION", 'The new value. A skills entry is {name, description, body, allow_executable_files (boolean, default false), files: [{path, content, executable (boolean, default false)}]}. A tools entry is {type, name, ...}. An mcps entry is {name, transport, url}.'
            )
        )
    else:
        operation = json.loads(
            blob.replace(
                "VALUE_DESCRIPTION",
                "The new value. Only for set, merge, add_item, replace_item.",
            )
        )
    required = ["base_revision_id", "delta"]
    if not (V3_SURFACE or V4_SURFACE):
        required.append("message")
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["workflow_revision"],
        "properties": {
            "workflow_revision": {
                "type": "object",
                "additionalProperties": False,
                "required": required,
                "properties": {
                    "base_revision_id": {
                        "type": "string",
                        "description": "The revision your change is based on.",
                    },
                    "message": {
                        "type": "string",
                        "description": "The commit message.",
                    },
                    "delta": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["operations"],
                        "properties": {
                            "operations": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": 64,
                                "items": operation,
                            }
                        },
                    },
                },
            }
        },
    }


def read_config_result(config: Dict[str, Any], revision_id: str) -> str:
    return json.dumps(
        {"revision_id": revision_id, "data": config}, indent=2, ensure_ascii=False
    )
