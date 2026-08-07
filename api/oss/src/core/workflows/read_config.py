"""Reading one part of a workflow revision's configuration (slice S2).

Implements the projection half of ``contracts/read-config.md``: resolve a target against a
revision's data, refuse what the agent may not read, and answer fully or not at all.

Pure and synchronous. The service fetches the revision; this module shapes the answer.

The target grammar is the change set's, unchanged, and so is the reason-code vocabulary.
One grammar for read and write is the point: what the agent reads, it can then name in an
operation.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from oss.src.core.workflows.change_set import (
    KEY_FIELDS,
    Reason,
    Segment,
    Target,
    item_key,
)

__all__ = [
    "ReadConfigError",
    "ReadConfigResult",
    "DEFAULT_MAX_BYTES",
    "MAX_MAX_BYTES",
    "MIN_MAX_BYTES",
    "READABLE_ROOTS",
    "project_config",
]


DEFAULT_MAX_BYTES = 65_536
MIN_MAX_BYTES = 1_024
MAX_MAX_BYTES = 262_144

# Contract 8. The read scope is wider than the write scope: reading `uri` helps the agent
# understand itself, and writing it would break it. `url` and `schemas` are server-derived
# and large, and they tell the model nothing it can act on.
READABLE_ROOTS = ("parameters", "uri", "flags")
_UNREADABLE_ROOTS = ("url", "schemas")

_NEXT_STEPS = {
    Reason.TARGET_NOT_FOUND: (
        "Read the parent path to see which fields exist, then retry."
    ),
    Reason.TARGET_TYPE_MISMATCH: (
        "That segment is a scalar, so it has no fields. Read its parent instead."
    ),
    Reason.ITEM_NOT_FOUND: (
        "Read the list itself to see the keys it holds, then retry with one of them."
    ),
    Reason.DUPLICATE_ITEM_KEY: (
        "Two entries share that key, so it does not address one entry. Read the whole "
        "list instead."
    ),
    Reason.UNKEYED_COLLECTION: (
        "That list is not addressed by name. Read the whole list instead."
    ),
    Reason.INVALID_TARGET_SHAPE: (
        "A segment is a field name, or {'list': ..., 'key': ...} for one list entry."
    ),
    Reason.OUT_OF_SCOPE: ("Read `parameters` for the configuration you can change."),
    "output_too_large": (
        "Read one of the paths in `children` instead of the whole value."
    ),
}


class ReadConfigError(Exception):
    """A read the agent must correct. HTTP 422 unless stated otherwise."""

    code = "read_config_rejected"

    def __init__(
        self,
        reason: str,
        message: str,
        *,
        path: Optional[Target] = None,
        children: Optional[Sequence[str]] = None,
        status_code: int = 422,
        **context: Any,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.path = list(path) if path is not None else None
        self.children = list(children) if children is not None else None
        self.status_code = status_code
        self.context = context

    def to_detail(self) -> Dict[str, Any]:
        """The canonical agent-actionable envelope. See `api/AGENTS.md`.

        `retryable` is FALSE for every one of these. It used to be hard-coded true, which
        told the agent to send the identical request again: none of these can succeed on a
        replay, because each one is a fact about the request or about what is stored. The
        way forward is the `next_step`, and that is what the agent should read.
        """
        detail: Dict[str, Any] = {
            "code": self.reason,
            "message": self.message,
            "retryable": False,
        }
        next_step = _NEXT_STEPS.get(self.reason)
        if next_step:
            detail["next_step"] = next_step

        details: Dict[str, Any] = dict(self.context)
        if self.path is not None:
            details["path"] = self.path
        if self.children is not None:
            details["children"] = self.children
        if details:
            detail["details"] = details
        return detail


@dataclass(frozen=True)
class ReadConfigResult:
    path: List[Segment]
    value: Any
    bytes: int
    warnings: List[Dict[str, Any]] = field(default_factory=list)


def _encoded_size(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))


def children_of(value: Any) -> List[str]:
    """The names one level under a value: object fields, or a list's item keys.

    For a list this returns the selector keys the agent may use, so a refusal hands it the
    exact vocabulary for the narrower read.
    """
    if isinstance(value, dict):
        return [key for key in value if key not in _UNREADABLE_ROOTS]
    if isinstance(value, list):
        return []
    return []


def _list_children(list_name: str, entries: Sequence[Any]) -> List[str]:
    keys = [item_key(list_name, entry) for entry in entries]
    return [key for key in keys if key]


def _type_name(value: Any) -> str:
    if value is None:
        return "null"
    return {
        dict: "an object",
        list: "a list",
        str: "a string",
        bool: "a boolean",
        int: "a number",
        float: "a number",
    }.get(type(value), type(value).__name__)


def _check_scope(path: Sequence[Segment]) -> None:
    if not path:
        return
    root = path[0]
    if not isinstance(root, str):
        raise ReadConfigError(
            Reason.INVALID_TARGET_SHAPE,
            "the first segment names a top-level field",
            path=list(path),
        )
    if root in _UNREADABLE_ROOTS:
        raise ReadConfigError(
            Reason.OUT_OF_SCOPE,
            f"'{root}' is server-derived and cannot be read.",
            path=list(path),
        )
    if root not in READABLE_ROOTS:
        raise ReadConfigError(
            Reason.OUT_OF_SCOPE,
            f"'{root}' is not readable (readable: {', '.join(READABLE_ROOTS)}).",
            path=list(path),
        )


def _validate_segment(segment: Any, position: int, path: Sequence[Segment]) -> None:
    if isinstance(segment, str):
        if segment:
            return
        raise ReadConfigError(
            Reason.INVALID_TARGET_SHAPE,
            f"path segment {position} is empty",
            path=list(path),
        )
    if isinstance(segment, dict):
        if set(segment) != {"list", "key"}:
            raise ReadConfigError(
                Reason.INVALID_TARGET_SHAPE,
                f"path segment {position} must have exactly 'list' and 'key'",
                path=list(path),
            )
        if not isinstance(segment["list"], str) or not segment["list"]:
            raise ReadConfigError(
                Reason.INVALID_TARGET_SHAPE,
                f"path segment {position} has an empty 'list'",
                path=list(path),
            )
        if not isinstance(segment["key"], str) or not segment["key"]:
            raise ReadConfigError(
                Reason.INVALID_TARGET_SHAPE,
                f"path segment {position} has an empty 'key'",
                path=list(path),
            )
        return
    raise ReadConfigError(
        Reason.INVALID_TARGET_SHAPE,
        f"path segment {position} must be a string or a {{list, key}} object",
        path=list(path),
    )


def _resolve(data: Dict[str, Any], path: Sequence[Segment]) -> Any:
    node: Any = data
    for position, segment in enumerate(path):
        _validate_segment(segment, position, path)
        walked = list(path[: position + 1])
        if isinstance(segment, str):
            if not isinstance(node, dict):
                raise ReadConfigError(
                    Reason.TARGET_TYPE_MISMATCH,
                    f"segment {position} ({segment!r}): the parent is "
                    f"{_type_name(node)}, not an object",
                    path=walked,
                )
            if segment not in node:
                raise ReadConfigError(
                    Reason.TARGET_NOT_FOUND,
                    f"{segment!r} does not exist",
                    path=walked,
                    children=children_of(node),
                )
            node = node[segment]
        else:
            list_name, key = segment["list"], segment["key"]
            if not isinstance(node, dict) or list_name not in node:
                raise ReadConfigError(
                    Reason.TARGET_NOT_FOUND,
                    f"'{list_name}' does not exist",
                    path=walked,
                    children=children_of(node),
                )
            entries = node[list_name]
            if not isinstance(entries, list):
                raise ReadConfigError(
                    Reason.TARGET_TYPE_MISMATCH,
                    f"'{list_name}' is {_type_name(entries)}, not a list",
                    path=walked,
                )
            if list_name not in KEY_FIELDS:
                raise ReadConfigError(
                    Reason.UNKEYED_COLLECTION,
                    f"'{list_name}' is not addressed by name",
                    path=walked,
                )
            matches = [entry for entry in entries if item_key(list_name, entry) == key]
            if len(matches) > 1:
                raise ReadConfigError(
                    Reason.DUPLICATE_ITEM_KEY,
                    f"'{list_name}' holds {len(matches)} entries named {key!r}",
                    path=walked,
                    match_count=len(matches),
                )
            if not matches:
                raise ReadConfigError(
                    Reason.ITEM_NOT_FOUND,
                    f"'{list_name}' has no entry named {key!r}",
                    path=walked,
                    children=_list_children(list_name, entries),
                )
            node = matches[0]
    return node


def _readable_root_view(data: Dict[str, Any]) -> Dict[str, Any]:
    """The whole-configuration answer, with the server-derived fields dropped.

    The model never gets the raw revision dump: `url` and `schemas` are large and
    unactionable, and shipping them would spend the agent's context on nothing.
    """
    return {key: value for key, value in data.items() if key in READABLE_ROOTS}


def project_config(
    data: Optional[Dict[str, Any]],
    path: Optional[Sequence[Segment]] = None,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> ReadConfigResult:
    """Resolve ``path`` against ``data`` and answer fully, or refuse.

    An absent path means the whole readable configuration.
    """
    if data is None:
        raise ReadConfigError(
            "revision_not_found",
            "The variant has no revision to read.",
            status_code=404,
        )

    segments = list(path or [])
    _check_scope(segments)

    value = _resolve(data, segments) if segments else _readable_root_view(data)

    size = _encoded_size(value)
    if size > max_bytes:
        # Refuse, never truncate: an anchor built from a cut string can match text the
        # agent never saw, and that commits the wrong change.
        raise ReadConfigError(
            "output_too_large",
            f"The value at that path is {size} bytes; the limit is {max_bytes}. "
            "Read a narrower path.",
            path=segments,
            children=_children_for_refusal(value, segments),
            bytes=size,
            limit=max_bytes,
        )

    return ReadConfigResult(path=segments, value=value, bytes=size)


def _children_for_refusal(value: Any, path: Sequence[Segment]) -> List[str]:
    if isinstance(value, list) and path:
        last = path[-1]
        if isinstance(last, str):
            return _list_children(last, value)
    return children_of(value)


def clamp_max_bytes(requested: Optional[int]) -> int:
    if requested is None:
        return DEFAULT_MAX_BYTES
    return max(MIN_MAX_BYTES, min(MAX_MAX_BYTES, requested))


def draft_warning(revision_version: Optional[str]) -> Dict[str, Any]:
    """Contract 10. A draft run reads the committed head, not what it is running."""
    version = f", revision {revision_version}" if revision_version else ""
    return {
        "code": "draft_run",
        "message": (
            "This run executes unsaved playground changes. The values below come from "
            f"the committed head{version}. Your commit will also apply to the committed "
            "head."
        ),
    }
