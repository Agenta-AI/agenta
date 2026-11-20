"""The approval preview of an ordered change set: old and new value per changed path.

The approval card of `edit_agent_config` and `create_agent` shows what a call would change
before the person approves it. The engine is the only thing that knows what an operation
does to a configuration (anchors, normalization, operations that edit what an earlier one
wrote), so the preview is the engine's own result compared with its base, never a copy of
the engine in the browser. Nothing here writes.

The preview rides the approval payload, so it is bounded: a long text becomes a unified
diff, a large value is left out with ``truncated``, and past ``MAX_PREVIEW_BYTES`` the
remaining changes keep only their path, and the changes that do not fit even so are left
out (``truncated`` says so). ``applies`` covers the change-set engine only;
the save's later checks (embeds, the runtime parse) can still refuse a change that applies.
"""

import difflib
import json
from typing import Any, Dict, List, Optional, Sequence

from oss.src.core.workflows.change_set import (
    KEY_FIELDS,
    ChangeSetError,
    item_key,
    resolve_target,
)

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
    """The operations that change one keyed list, and which items they name by key."""

    def __init__(self, path: List[Segment]) -> None:
        self.path = path  # the list itself: the parent path plus the list name
        self.indexes: List[int] = []
        self.by_key: Dict[str, List[int]] = {}
        self.fields: Dict[str, List[List[Segment]]] = {}
        # Keys an operation wrote as a whole item (an add, a replace, a remove).
        self.whole_items: set = set()
        # An operation wrote the whole list: its items are compared as whole items.
        self.whole_list = False


class _Plain:
    """The operations that change one path outside the keyed lists."""

    def __init__(self, path: List[Segment]) -> None:
        self.path = path
        self.indexes: List[int] = []


def _groups(operations: Sequence[Dict[str, Any]]) -> List[Any]:
    """Each changed path once, in the order the operations first name it. A path through
    a keyed list, or a write of a whole keyed list, is grouped under that list: an
    operation can change an item's key (a rename), so its items are compared by key."""
    found: Dict[str, Any] = {}
    for index, operation in enumerate(operations):
        path = _address(operation)
        position = next(
            (n for n, segment in enumerate(path) if isinstance(segment, dict)), None
        )
        if position is None:
            if path and path[-1] in KEY_FIELDS:
                group = found.setdefault(
                    json.dumps(path, sort_keys=True), _ListGroup(path)
                )
                group.whole_list = True
            else:
                group = found.setdefault(json.dumps(path, sort_keys=True), _Plain(path))
            group.indexes.append(index)
            continue
        selector = path[position]
        list_path = path[:position] + [selector["list"]]
        group = found.setdefault(
            json.dumps(list_path, sort_keys=True), _ListGroup(list_path)
        )
        group.indexes.append(index)
        group.by_key.setdefault(selector["key"], []).append(index)
        if position < len(path) - 1:
            group.fields.setdefault(selector["key"], []).append(path[position + 1 :])
        else:
            group.whole_items.add(selector["key"])
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
    base: Dict[str, Any], result: Dict[str, Any], group: _ListGroup
) -> List[Dict[str, Any]]:
    """The item changes of one keyed list: added, removed and changed items by key. A
    changed item whose operations named fields inside it shows those fields, when they
    are all that changed in it."""
    old_list, new_list = _value_at(base, group.path), _value_at(result, group.path)
    list_name = group.path[-1]
    old_items = _keyed(list_name, [] if old_list is _MISSING else old_list)
    new_items = _keyed(list_name, [] if new_list is _MISSING else new_list)
    if (
        old_items is None
        or new_items is None
        # A list added or removed, or kept items in another order: the item diff by
        # key cannot show it, so the whole list is the change.
        or (old_list is _MISSING) != (new_list is _MISSING)
        or [k for k in old_items if k in new_items]
        != [k for k in new_items if k in old_items]
    ):
        change = _change(old_list, new_list, group.path, group.indexes)
        return [change] if change else []

    changes: List[Dict[str, Any]] = []
    for key in [*old_items, *(k for k in new_items if k not in old_items)]:
        old, new = old_items.get(key, _MISSING), new_items.get(key, _MISSING)
        item_path = group.path[:-1] + [{"list": list_name, "key": key}]
        # An item no operation named (the new key of a rename) belongs to the list's.
        item_indexes = group.by_key.get(key) or group.indexes
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
    if not fields or group.whole_list or key in group.whole_items:
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
        detail = _text_diff(old, new)
        # A change of line endings or of the final newline leaves no line in the diff.
        if detail["diff"]:
            return detail
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
    base_revision: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The preview of operations the engine applied: ``base`` is the revision data they
    start from, ``result`` the data the engine returned for all of them. ``operations``
    must be the normalized operations the engine ran, so each path is the one it wrote.
    ``base_revision`` (`{id, version}`) names the base revision of an edit."""
    found: List[Dict[str, Any]] = []
    for group in _groups(operations):
        if isinstance(group, _ListGroup):
            found.extend(_list_changes(base, result, group))
            continue
        old, new = _value_at(base, group.path), _value_at(result, group.path)
        change = _change(old, new, group.path, group.indexes)
        if change:
            found.append(change)

    preview: Dict[str, Any] = {
        "applies": True,
        "operations": [
            {"index": index, "applies": True} for index in range(len(operations))
        ],
        "changes": [],
        "truncated": True,  # counted in the budget; dropped below when nothing is cut
    }
    if base_revision is not None:
        preview["base"] = base_revision
    # Each change costs its size and a separator in the serialized preview.
    budget = MAX_PREVIEW_BYTES - _size(preview)
    truncated = False
    for change in found:
        size = _size(change) + 2
        if size > budget:
            truncated = True
            change = {key: change[key] for key in ("path", "operation_indexes", "kind")}
            size = _size(change) + 2
            if size > budget:
                # Not even the path fits: the rest of the changes are left out.
                break
        budget -= size
        preview["changes"].append(change)
    if not truncated:
        del preview["truncated"]
    return preview


# The tools accept 64 operations at most; a refusal lists no more statuses than that.
MAX_OPERATION_STATUSES = 64
MAX_ERROR_MESSAGE_CHARS = 1_024


def failed_change_preview(
    *,
    operations: Sequence[Dict[str, Any]],
    error: ChangeSetError,
) -> Dict[str, Any]:
    """The preview of a change set the engine refused. One failed operation stops the
    engine. The engine can refuse it in a check that runs before any operation does, so
    the other operations are reported as not checked (``applies`` is null), never as
    applied."""
    failed = error.operation_index
    message = error.message[:MAX_ERROR_MESSAGE_CHARS]
    statuses: List[Dict[str, Any]] = [
        (
            {
                "index": index,
                "applies": False,
                "error": {"code": error.reason, "message": message},
            }
            if index == failed
            else {"index": index, "applies": None}
        )
        for index in range(min(len(operations), MAX_OPERATION_STATUSES))
    ]
    preview: Dict[str, Any] = {"applies": False, "operations": statuses, "changes": []}
    if failed is None or failed >= MAX_OPERATION_STATUSES:
        # Refused as a whole, not at one operation that is listed.
        preview["error"] = {"code": error.reason, "message": message}
    if len(operations) > MAX_OPERATION_STATUSES or len(error.message) > len(message):
        preview["truncated"] = True
    return preview
