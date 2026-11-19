"""The approval preview of an ordered change set: old and new value per changed path.

The approval card of `edit_agent_config` and `create_agent` shows what a call would change
before the person approves it. The engine is the only thing that knows what an operation
does to a configuration (anchors, normalization, operations that edit what an earlier one
wrote), so the preview is the engine's own result compared with its base, never a copy of
the engine in the browser. Nothing here writes.

The preview rides the approval payload, so it is bounded: a long text becomes a unified
diff, a large value is left out with ``truncated``, and past ``MAX_PREVIEW_BYTES`` the
remaining changes keep only their path. ``applies`` covers the change-set engine only;
the save's later checks (embeds, the runtime parse) can still refuse a change that applies.
"""

import difflib
import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

from oss.src.core.workflows.change_set import ChangeSetError, item_key, resolve_target

# A text longer than this (old and new together) is shown as a diff, not as two values.
TEXT_DIFF_MIN_CHARS = 400
# The diff of one text, and any other single value, are cut at these sizes.
MAX_DIFF_CHARS = 16_384
MAX_VALUE_BYTES = 4_096
# The whole preview. 64 operations at most reach it (the tools' own cap).
MAX_PREVIEW_BYTES = 65_536

_MISSING = object()

Segment = Any  # a field name, or a {"list", "key"} selector


def _address(operation: Dict[str, Any]) -> List[Segment]:
    """The path an operation changes. An added item is addressed by its own key, so its
    entry reads like the entry of a removed or replaced item."""
    target = list(operation.get("target") or [])
    if operation.get("operation") == "add_item" and target:
        list_name = target[-1]
        key = item_key(list_name, operation.get("value"))
        if isinstance(list_name, str) and key is not None:
            return target[:-1] + [{"list": list_name, "key": key}]
    return target


def _stable_path(
    base: Dict[str, Any], result: Dict[str, Any], path: List[Segment]
) -> List[Segment]:
    """``path``, or the list it goes through when one of its items does not keep its key.

    An operation can change the key of an item (a `set` of a skill's `name`), or add an
    item that a later operation renames. Its selector then finds the item on one side
    only, or on neither, and the item's change would read as a removal or not show at
    all. The enclosing list is then the changed path: both sides of it exist."""
    for position, segment in enumerate(path):
        if not isinstance(segment, dict):
            continue
        item = path[: position + 1]
        in_base = _value_at(base, item) is not _MISSING
        in_result = _value_at(result, item) is not _MISSING
        last = position == len(path) - 1
        # An item the path ends at may be added or removed; one it goes through must
        # be on both sides.
        if (last and not (in_base or in_result)) or (
            not last and not (in_base and in_result)
        ):
            return path[:position] + [segment["list"]]
    return path


def _addresses(
    base: Dict[str, Any],
    result: Dict[str, Any],
    operations: Sequence[Dict[str, Any]],
) -> List[Tuple[List[Segment], List[int]]]:
    """Each changed path once, in the order the operations first name it, with the indexes
    of the operations that change it."""
    found: Dict[str, Tuple[List[Segment], List[int]]] = {}
    for index, operation in enumerate(operations):
        path = _stable_path(base, result, _address(operation))
        key = json.dumps(path, sort_keys=True)
        if key not in found:
            found[key] = (path, [])
        found[key][1].append(index)
    return list(found.values())


def _value_at(root: Dict[str, Any], path: List[Segment]) -> Any:
    try:
        return resolve_target(root, path)
    except LookupError:
        return _MISSING


def _size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str))


def _text_diff(old: str, new: str) -> Dict[str, Any]:
    lines = list(
        difflib.unified_diff(
            old.splitlines(),
            new.splitlines(),
            fromfile="old",
            tofile="new",
            lineterm="",
            n=3,
        )
    )
    diff = "\n".join(lines)
    detail: Dict[str, Any] = {"diff": diff[:MAX_DIFF_CHARS]}
    if len(diff) > MAX_DIFF_CHARS:
        detail["truncated"] = True
    return detail


def _values(old: Any, new: Any) -> Dict[str, Any]:
    if (
        isinstance(old, str)
        and isinstance(new, str)
        and len(old) + len(new) > TEXT_DIFF_MIN_CHARS
    ):
        return _text_diff(old, new)
    detail: Dict[str, Any] = {}
    for side, value in (("old", old), ("new", new)):
        if value is _MISSING:
            continue
        if _size(value) > MAX_VALUE_BYTES:
            detail["truncated"] = True
        else:
            detail[side] = value
    return detail


def _change(
    base: Dict[str, Any],
    result: Dict[str, Any],
    path: List[Segment],
    indexes: List[int],
) -> Optional[Dict[str, Any]]:
    old, new = _value_at(base, path), _value_at(result, path)
    if old is _MISSING and new is _MISSING:
        # A later operation removed what an earlier one wrote: nothing changes there.
        return None
    if old is not _MISSING and new is not _MISSING and old == new:
        return None
    kind = "added" if old is _MISSING else "removed" if new is _MISSING else "changed"
    return {
        "path": path,
        "operation_indexes": indexes,
        "kind": kind,
        **_values(old, new),
    }


def build_change_preview(
    *,
    base: Dict[str, Any],
    result: Dict[str, Any],
    operations: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """The preview of operations the engine applied: ``base`` is the revision data they
    start from, ``result`` the data the engine returned for all of them. ``operations``
    must be the normalized operations the engine ran, so each path is the one it wrote."""
    changes: List[Dict[str, Any]] = []
    budget = MAX_PREVIEW_BYTES
    truncated = False
    for path, indexes in _addresses(base, result, operations):
        change = _change(base, result, path, indexes)
        if change is None:
            continue
        size = _size(change)
        if size > budget:
            truncated = True
            change = {key: change[key] for key in ("path", "operation_indexes", "kind")}
            size = _size(change)
        budget -= size
        changes.append(change)
    preview: Dict[str, Any] = {
        "applies": True,
        "operations": [
            {"index": index, "applies": True} for index in range(len(operations))
        ],
        "changes": changes,
    }
    if truncated:
        preview["truncated"] = True
    return preview


def failed_change_preview(
    *,
    operations: Sequence[Dict[str, Any]],
    error: ChangeSetError,
) -> Dict[str, Any]:
    """The preview of a change set the engine refused. One failed operation stops the
    engine, so the operations before it apply, the failed one does not, and the ones after
    it were not checked (``applies`` is null)."""
    failed = error.operation_index
    statuses: List[Dict[str, Any]] = []
    for index in range(len(operations)):
        if failed is None or index > failed:
            statuses.append({"index": index, "applies": None})
        elif index < failed:
            statuses.append({"index": index, "applies": True})
        else:
            statuses.append(
                {
                    "index": index,
                    "applies": False,
                    "error": {"code": error.reason, "message": error.message},
                }
            )
    preview: Dict[str, Any] = {"applies": False, "operations": statuses, "changes": []}
    if failed is None:
        # Refused as a whole, not at one operation.
        preview["error"] = {"code": error.reason, "message": error.message}
    return preview
