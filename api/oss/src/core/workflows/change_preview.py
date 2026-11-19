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


class _ListGroup:
    """The operations that change items of one keyed list, by item key."""

    def __init__(self, path: List[Segment]) -> None:
        self.path = path  # the list itself: the parent path plus the list name
        self.indexes: List[int] = []
        self.by_key: Dict[str, List[int]] = {}
        self.fields: Dict[str, List[List[Segment]]] = {}


def _groups(
    operations: Sequence[Dict[str, Any]],
) -> List[Tuple[List[Segment], List[int], Optional[_ListGroup]]]:
    """Each changed path once, in the order the operations first name it. A path through
    a keyed list item is grouped under that list, because an operation can change an
    item's key (a rename) and the item is then compared by key across the whole list."""
    found: Dict[str, Tuple[List[Segment], List[int], Optional[_ListGroup]]] = {}
    for index, operation in enumerate(operations):
        path = _address(operation)
        position = next(
            (n for n, segment in enumerate(path) if isinstance(segment, dict)), None
        )
        if position is None:
            key = json.dumps(path, sort_keys=True)
            found.setdefault(key, (path, [], None))[1].append(index)
            continue
        selector = path[position]
        list_path = path[:position] + [selector["list"]]
        key = json.dumps(list_path, sort_keys=True)
        group = found.setdefault(key, (list_path, [], _ListGroup(list_path)))[2]
        found[key][1].append(index)
        group.by_key.setdefault(selector["key"], []).append(index)
        if position < len(path) - 1:
            group.fields.setdefault(selector["key"], []).append(path[position + 1 :])
    return list(found.values())


def _keyed(list_name: str, entries: Any) -> Optional[Dict[str, Any]]:
    """The entries of a list by key, or None when an entry has no key or a key repeats
    (then only the whole list can be compared)."""
    if not isinstance(entries, list):
        return None
    keyed: Dict[str, Any] = {}
    for entry in entries:
        key = item_key(list_name, entry)
        if key is None or key in keyed:
            return None
        keyed[key] = entry
    return keyed


def _list_changes(
    base: Dict[str, Any],
    result: Dict[str, Any],
    group: _ListGroup,
    indexes: List[int],
) -> List[Dict[str, Any]]:
    """The item changes of one keyed list: added, removed and changed items by key. A
    changed item whose operations named fields inside it shows those fields, when they
    are all that changed in it."""
    old_list, new_list = _value_at(base, group.path), _value_at(result, group.path)
    list_name = group.path[-1]
    old_items = _keyed(list_name, [] if old_list is _MISSING else old_list)
    new_items = _keyed(list_name, [] if new_list is _MISSING else new_list)
    if old_items is None or new_items is None:
        change = _change(old_list, new_list, group.path, indexes)
        return [change] if change else []

    changes: List[Dict[str, Any]] = []
    for key in [*old_items, *(k for k in new_items if k not in old_items)]:
        old, new = old_items.get(key, _MISSING), new_items.get(key, _MISSING)
        item_path = group.path[:-1] + [{"list": list_name, "key": key}]
        # An item no operation named (the new key of a rename) belongs to the list's.
        item_indexes = group.by_key.get(key) or indexes
        fields = _unique(group.fields.get(key, []))
        if _only_fields_changed(group, key, old, new, fields):
            changes.extend(
                change
                for field in fields
                if (
                    change := _change(
                        _value_at(old, field),
                        _value_at(new, field),
                        item_path + field,
                        item_indexes,
                    )
                )
            )
            continue
        change = _change(old, new, item_path, item_indexes)
        if change:
            changes.append(change)
    return changes


def _unique(paths: List[List[Segment]]) -> List[List[Segment]]:
    seen: Dict[str, List[Segment]] = {}
    for path in paths:
        seen.setdefault(json.dumps(path, sort_keys=True), path)
    return list(seen.values())


def _only_fields_changed(
    group: _ListGroup, key: str, old: Any, new: Any, fields: List[List[Segment]]
) -> bool:
    """Whether the item's change is shown field by field: every operation on the item
    named a field inside it, and the item differs only at those top-level fields."""
    if not fields or len(group.fields[key]) != len(group.by_key[key]):
        return False
    if not isinstance(old, dict) or not isinstance(new, dict):
        return False
    names = {field[0] for field in fields if isinstance(field[0], str)}
    return {k: v for k, v in old.items() if k not in names} == {
        k: v for k, v in new.items() if k not in names
    }


def _value_at(root: Dict[str, Any], path: List[Segment]) -> Any:
    try:
        return resolve_target(root, path)
    except LookupError:
        return _MISSING


def _size(value: Any) -> int:
    """The UTF-8 size of a value's JSON, in bytes."""
    return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))


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
    old: Any, new: Any, path: List[Segment], indexes: List[int]
) -> Optional[Dict[str, Any]]:
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
    found: List[Dict[str, Any]] = []
    for path, indexes, group in _groups(operations):
        if group is not None:
            found.extend(_list_changes(base, result, group, indexes))
            continue
        change = _change(_value_at(base, path), _value_at(result, path), path, indexes)
        if change:
            found.append(change)
    for change in found:
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
