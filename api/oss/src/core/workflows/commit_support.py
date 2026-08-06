"""Wrapper-owned helpers for an ordered-operations commit (slice S1b).

The engine (``change_set.py``) is pure and knows only the data tree. Three jobs need
context it does not have, so the contract gives them to the wrapper
(``contracts/change-set.md`` section 17):

- **Selector normalization** (4.3): forgive the two unambiguous target mistakes.
- **The derived commit message** (14): the model no longer sends one.
- **The platform-tool rejection** (11): the build kit must be uncommittable.

Enriched error content (12.4) was a fourth job here, and it does not belong. The nearest
lines need only the target string and the anchor, so they are raised by the engine itself.
The folder listing needs a workspace listing that never reaches the API at all: the runner
resolves file markers before it builds the request, so nothing here can raise
``source_not_found``.

Everything here is pure and synchronous, so it can run inside the commit transaction.
"""

from typing import Any, List, Optional, Sequence, Tuple

from oss.src.core.workflows.change_set import (
    KEY_FIELDS,
    Warning,
    WarningCode,
    item_key,
)

__all__ = [
    "normalize_operations",
    "derive_commit_message",
    "find_platform_tool_entries",
    "PLATFORM_TOOL_REJECTION",
]


# --------------------------------------------------------------------------------------
# Selector normalization (contract 4.3)
# --------------------------------------------------------------------------------------


def normalize_operations(
    operations: Sequence[Any],
) -> Tuple[List[Any], List[Warning]]:
    """Forgive the two unambiguous selector mistakes, and say so.

    Both mistakes have exactly one sensible reading, so refusing them teaches nothing.
    Anything ambiguous is left alone for the engine to refuse with a precise reason.

    Returns the corrected operations and one warning per correction.
    """
    corrected: List[Any] = []
    warnings: List[Warning] = []

    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            corrected.append(operation)
            continue
        target = operation.get("target")
        if not isinstance(target, list):
            corrected.append(operation)
            continue

        new_target, notes = _normalize_target(target)
        if not notes:
            corrected.append(operation)
            continue

        corrected.append({**operation, "target": new_target})
        for note in notes:
            warnings.append(
                Warning(
                    code=WarningCode.TARGET_NORMALIZED,
                    message=note,
                    target=new_target,
                    operation_index=index,
                )
            )

    return corrected, warnings


def _normalize_target(target: Sequence[Any]) -> Tuple[List[Any], List[str]]:
    notes: List[str] = []
    segments = list(target)

    # Mistake 1: the list name repeated before its own selector. A selector already
    # stands in place of the list's name, so the extra segment is always redundant.
    # It absorbed 12 percent of one model's targets once the teaching left the tool
    # description.
    collapsed: List[Any] = []
    for segment in segments:
        if (
            isinstance(segment, dict)
            and collapsed
            and isinstance(collapsed[-1], str)
            and collapsed[-1] == segment.get("list")
        ):
            removed = collapsed.pop()
            notes.append(
                f"Removed the repeated list name {removed!r} before its selector. "
                "A selector already stands in place of the list's name."
            )
        collapsed.append(segment)
    segments = collapsed

    # Mistake 2: the KEY FIELD in the `list` slot, e.g. {"list": "name", "key": "x"}
    # inside a list position. The enclosing list is unambiguous, so the fix is exact.
    # This vanished when `field` was renamed to `list`; the normalization stays as a belt.
    key_field_names = {"name", "path", "op", "slug"}
    for position, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue
        list_name = segment.get("list")
        if list_name not in key_field_names:
            continue
        enclosing = segments[position - 1] if position > 0 else None
        if isinstance(enclosing, str) and enclosing in KEY_FIELDS:
            segments[position] = {"list": enclosing, "key": segment.get("key")}
            # The enclosing name is now redundant, exactly like mistake 1.
            segments.pop(position - 1)
            notes.append(
                f"Read {{'list': {list_name!r}}} as the list {enclosing!r}. "
                "'list' names the list, not its key field."
            )
            break

    return segments, notes


# --------------------------------------------------------------------------------------
# The derived commit message (contract 14)
# --------------------------------------------------------------------------------------

# A list's name in the singular, for the message. Only the four keyed lists appear.
_SINGULAR = {
    "skills": "skill",
    "mcps": "MCP server",
    "tools": "tool",
    "files": "file",
}

_LEGACY_MESSAGE = "updated configuration"


def derive_commit_message(operations: Optional[Sequence[Any]]) -> str:
    """Build the commit message from the operations. The model never sends one.

    Free text was the site of every argument-corruption failure the usability spike
    measured, and a derived message is always accurate, which serves issues #5187 and
    #5200 better than the model's own words. It is also the audit record: no new column,
    no migration (decision 6, amended).

    It took an ephemeral per-call note (R12) and appended it in parentheses. Nothing could
    ever fill it. The runner deletes that note before it builds the request, deliberately
    (read-config.md 12.3), so the only value that reached this argument was
    ``RevisionCommit.description``: the persisted revision field, which is the exact name
    collision 12.1 exists to prevent. A direct HTTP caller that set it had its description
    copied verbatim into the message beside itself.
    """
    if not operations:
        return _LEGACY_MESSAGE

    clauses = _clauses(operations)
    return "; ".join(clauses) if clauses else _LEGACY_MESSAGE


def _clauses(operations: Sequence[Any]) -> List[str]:
    clauses: List[str] = []
    # Consecutive edit_text operations on ONE field read as one clause with a count;
    # listing them one by one would bury the change in noise.
    pending_edit_field: Optional[str] = None
    pending_edit_count = 0

    def flush() -> None:
        nonlocal pending_edit_field, pending_edit_count
        if pending_edit_field is not None:
            plural = "edit" if pending_edit_count == 1 else "edits"
            clauses.append(
                f"edited {pending_edit_field} ({pending_edit_count} {plural})"
            )
            pending_edit_field = None
            pending_edit_count = 0

    for operation in operations:
        if not isinstance(operation, dict):
            continue
        verb = operation.get("operation")
        target = operation.get("target") or []
        last = target[-1] if target else None

        if verb == "edit_text":
            field_name = last if isinstance(last, str) else "a field"
            edits = operation.get("edits") or []
            if pending_edit_field == field_name:
                pending_edit_count += len(edits) or 1
            else:
                flush()
                pending_edit_field = field_name
                pending_edit_count = len(edits) or 1
            continue

        flush()
        if verb in ("set", "merge", "remove") and isinstance(last, str):
            word = {"set": "set", "merge": "updated", "remove": "removed"}[verb]
            clauses.append(f"{word} {last}")
        elif verb == "add_item" and isinstance(last, str):
            key = item_key(last, operation.get("value"), allow_legacy_fallback=False)
            clauses.append(f"added {_SINGULAR.get(last, 'entry')} {key or ''}".strip())
        elif verb in ("replace_item", "remove_item") and isinstance(last, dict):
            word = "replaced" if verb == "replace_item" else "removed"
            list_name = last.get("list") or ""
            clauses.append(
                f"{word} {_SINGULAR.get(list_name, 'entry')} {last.get('key') or ''}".strip()
            )

    flush()
    return clauses


# --------------------------------------------------------------------------------------
# The platform-tool rejection (contract 11)
# --------------------------------------------------------------------------------------

PLATFORM_TOOL_REJECTION = (
    "These are playground tools, not part of your configuration: {names}."
)


def find_platform_tool_entries(data: Any) -> List[str]:
    """Every ``type: "platform"`` entry in any ``tools`` list, by its op name.

    The playground injects the build kit into the running configuration. Agents commit
    those entries by accident. Rejecting beats silently stripping them: the usability
    spike showed that errors teach and silent corrections do not.
    """
    found: List[str] = []
    _collect_platform_tools(data, found)
    return found


def _collect_platform_tools(node: Any, found: List[str]) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "tools" and isinstance(value, list):
                for entry in value:
                    if isinstance(entry, dict) and entry.get("type") == "platform":
                        name = item_key("tools", entry) or entry.get("op") or "unnamed"
                        if name not in found:
                            found.append(name)
            _collect_platform_tools(value, found)
    elif isinstance(node, list):
        for entry in node:
            _collect_platform_tools(entry, found)
