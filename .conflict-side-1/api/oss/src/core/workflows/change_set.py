"""The change-set engine: one pure function that applies a delta to a base data tree.

Implements ``docs/design/agent-config-editing/contracts/change-set.md`` (slice S1a). The
contract is authoritative; this module is its executable half.

The engine is dependency-free: plain dicts in, a plain result out, no pydantic, no I/O, no
database. Two wrappers call it. The commit wrapper checks ``base_revision_id`` against the
head and persists; the invoke-override wrapper resolves an immutable revision, applies with
the ``parameters``-only scope policy, and persists nothing.

Three things belong to the wrapper, not here, and the contract says so: the selector
normalization (contract 4.3), the platform-tool rejection (11), the derived commit message
(14), and the enriched error content (12.4), which needs the workspace and the base
revision. The engine produces the machine-readable half of every error; the wrapper adds
the parts that need context it does not have.
"""

from copy import deepcopy
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

__all__ = [
    "ChangeSetError",
    "ChangeSetResult",
    "Reason",
    "Warning",
    "apply_change_set",
    "apply_text_edits",
    "deep_merge",
    "item_key",
    "allow_all",
    "subtree_scope",
    "PARAMETERS_ONLY",
    "AGENT_COMMIT_SCOPE",
    "KEY_FIELDS",
    "FILE_MARKER",
    "PLATFORM_GUIDANCE_START",
    "PLATFORM_GUIDANCE_END",
    "strip_platform_guidance",
    "strip_guidance_from_data",
]


# --------------------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------------------


class Reason:
    """Stable machine-readable reason codes. Contract section 12."""

    # --- retryable: the agent can correct these and send again (12.1) ---
    TARGET_NOT_FOUND = "target_not_found"
    TARGET_TYPE_MISMATCH = "target_type_mismatch"
    INVALID_TARGET_SHAPE = "invalid_target_shape"
    ITEM_ALREADY_EXISTS = "item_already_exists"
    ITEM_NOT_FOUND = "item_not_found"
    ITEM_RENAME_NOT_ALLOWED = "item_rename_not_allowed"
    DUPLICATE_ITEM_KEY = "duplicate_item_key"
    ITEM_KEY_UNDEFINED = "item_key_undefined"
    UNKEYED_COLLECTION = "unkeyed_collection"
    MISSING_OPERATION_VALUE = "missing_operation_value"
    INVALID_OPERATION_SHAPE = "invalid_operation_shape"
    TEXT_NOT_FOUND = "text_not_found"
    TEXT_NOT_UNIQUE = "text_not_unique"
    TEXT_EDITS_OVERLAP = "text_edits_overlap"
    EMPTY_OLD_TEXT = "empty_old_text"
    NO_CHANGE = "no_change"
    SOURCE_NOT_FOUND = "source_not_found"
    SOURCE_UNSUPPORTED = "source_unsupported"
    PLATFORM_TOOL_NOT_COMMITTABLE = "platform_tool_not_committable"
    NON_EMBEDDABLE_REFERENCE = "non_embeddable_reference"
    FINAL_VALIDATION_FAILED = "final_validation_failed"

    # --- non-retryable refusals: the same payload never succeeds (12.2) ---
    OUT_OF_SCOPE = "out_of_scope"
    INVALID_DELTA = "invalid_delta"
    UNKNOWN_OPERATION = "unknown_operation"
    UNRESOLVED_FILE_MARKER = "unresolved_file_marker"
    INVALID_EMBED = "invalid_embed"
    UNKNOWN_MARKER = "unknown_marker"
    VALUE_TOO_DEEP = "value_too_deep"
    TEXT_TOO_LARGE = "text_too_large"
    SOURCE_TOO_LARGE = "source_too_large"


_NOT_RETRYABLE = frozenset(
    {
        Reason.OUT_OF_SCOPE,
        Reason.INVALID_DELTA,
        Reason.UNKNOWN_OPERATION,
        Reason.UNRESOLVED_FILE_MARKER,
        Reason.INVALID_EMBED,
        Reason.UNKNOWN_MARKER,
        Reason.VALUE_TOO_DEEP,
        Reason.TEXT_TOO_LARGE,
        Reason.SOURCE_TOO_LARGE,
    }
)


# Contract 12.3: every retryable error names the next action in one imperative sentence.
# An agent that reads only this line must still know what to do.
NEXT_STEPS: Dict[str, str] = {
    Reason.TARGET_NOT_FOUND: (
        "Call read_config for that part of the configuration and correct the target."
    ),
    Reason.TARGET_TYPE_MISMATCH: (
        "Call read_config for that path to see what type it holds, then use the matching "
        "operation."
    ),
    Reason.INVALID_TARGET_SHAPE: (
        "Fix the last target segment: set / merge / remove / edit_text end with a field "
        "name, add_item ends with a list name, replace_item / remove_item end with "
        "{'list': ..., 'key': ...}."
    ),
    Reason.ITEM_ALREADY_EXISTS: (
        "Use replace_item to overwrite that entry, or add_item with a different key."
    ),
    Reason.ITEM_NOT_FOUND: (
        "Call read_config for that list to see the keys it holds, then retry with a key "
        "from it."
    ),
    Reason.ITEM_RENAME_NOT_ALLOWED: (
        "Send remove_item for the old key, then add_item with the new value."
    ),
    Reason.DUPLICATE_ITEM_KEY: (
        "Remove the duplicate entries with remove_item first, then send this change again."
    ),
    Reason.ITEM_KEY_UNDEFINED: (
        "Give the new entry its key field: name for a skill, an MCP server, or a tool; "
        "path for a file. A gateway tool needs an explicit name."
    ),
    Reason.UNKEYED_COLLECTION: (
        "That list is not addressed by name. Use set to replace the whole list."
    ),
    Reason.MISSING_OPERATION_VALUE: "Add a `value` to the operation and send it again.",
    Reason.INVALID_OPERATION_SHAPE: (
        "Correct the operation to the shape in the tool description and send it again."
    ),
    Reason.TEXT_NOT_FOUND: (
        "Copy old_text from the configuration you read, character for character."
    ),
    Reason.TEXT_NOT_UNIQUE: (
        "Add more surrounding lines to old_text until it appears once, then send the "
        "commit again."
    ),
    Reason.TEXT_EDITS_OVERLAP: (
        "Merge the overlapping edits into one edit, or target separate regions."
    ),
    Reason.EMPTY_OLD_TEXT: "Put the exact text you want to replace in old_text.",
    Reason.NO_CHANGE: (
        "The new text equals the old text. Send the change you actually want, or send "
        "nothing."
    ),
    Reason.SOURCE_NOT_FOUND: (
        "Write the file under .agenta-imports/ first, then send the commit again."
    ),
    Reason.SOURCE_UNSUPPORTED: (
        "That file is not readable as text. Reference a UTF-8 text file."
    ),
    Reason.PLATFORM_TOOL_NOT_COMMITTABLE: (
        "Remove those entries from `tools` and send the commit again."
    ),
    Reason.NON_EMBEDDABLE_REFERENCE: (
        "Remove the embedded reference to that workflow and send the commit again."
    ),
    Reason.FINAL_VALIDATION_FAILED: (
        "Correct the fields listed in `issues` and send the commit again."
    ),
    Reason.VALUE_TOO_DEEP: (
        "Flatten the value: the configuration nests a few levels deep, not hundreds."
    ),
}


OPERATIONS = (
    "set",
    "merge",
    "remove",
    "edit_text",
    "add_item",
    "replace_item",
    "remove_item",
)

VALUE_BEARING = frozenset({"set", "merge", "add_item", "replace_item"})

# Contract 4.1. Only these four lists take a selector and item operations.
KEY_FIELDS: Dict[str, str] = {
    "skills": "name",
    "mcps": "name",
    "files": "path",
    "tools": "__tool_name__",  # computed, see `item_key`
}

_EMBED_KEY = "@ag.embed"

# Contract 6. The runner replaces this marker with the file's text before the API sees the
# call. The engine is pure, so a marker that reaches it means the runner did not run.
FILE_MARKER = "@ag.file"

# Contract 5.6.1. Match tolerance follows what the text IS, by its field name.
# Prose is written by humans and models, so a smart quote from another editor must not
# block an edit. A script's bytes are its meaning, so a normalized match there could
# rewrite a string literal into something that no longer runs. An unknown field is exact:
# fail safe.
_PROSE_FIELDS = frozenset({"agents_md", "body", "description"})
_CODE_FIELDS = frozenset({"content", "script"})

MATCH_MODES = ("auto", "exact")

# Contract 5.6.3.
MAX_TEXT_LENGTH = 200_000  # matches SkillFile.content max_length
# Bounds on the near-miss search, which runs on the way to an error (see `nearest_lines`).
MAX_SCANNED_LINES = 5_000
MAX_SCANNED_LINE_LENGTH = 2_000
MAX_OLD_TEXT_LENGTH = 20_000
MAX_EDITS_PER_OPERATION = 32
MAX_OPERATIONS = 64
MAX_TARGET_SEGMENTS = 12


Segment = Union[str, Dict[str, str]]
Target = Sequence[Segment]
ScopePolicy = Callable[[Target], Optional[str]]


# --------------------------------------------------------------------------------------
# Result
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Warning:
    """One structured warning. Never a bare sentence: the wrapper renders it."""

    code: str
    message: str
    target: Optional[List[Segment]] = None
    operation_index: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.target is not None:
            out["target"] = self.target
        if self.operation_index is not None:
            out["operation_index"] = self.operation_index
        return out


@dataclass(frozen=True)
class ChangeSetResult:
    """What the engine returns. Contract section 8.

    ``changed`` is mandatory before ship, not a convenience: a cornered model commits a
    no-op to manufacture success. The wrapper's own comparison is larger (it covers the
    canonical persisted record); this one only says whether the tree moved.
    """

    data: Dict[str, Any]
    changed: bool
    warnings: List[Warning] = field(default_factory=list)


class WarningCode:
    TEXT_MATCHED_NORMALIZED = "text_matched_normalized"
    TARGET_NORMALIZED = "target_normalized"
    WHOLESALE_LIST_REPLACE = "wholesale_list_replace"
    LEGACY_DUPLICATE_KEY = "legacy_duplicate_key"
    LEGACY_DELTA_FORM = "legacy_delta_form"
    UNADDRESSABLE_EMBED = "unaddressable_embed"
    PLATFORM_GUIDANCE_STRIPPED = "platform_guidance_stripped"


# --------------------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------------------


class ChangeSetError(Exception):
    """One failed operation. It aborts the whole change set; nothing is committed."""

    code = "change_set_rejected"

    def __init__(
        self,
        reason: str,
        message: str,
        *,
        operation_index: Optional[int] = None,
        operation: Optional[str] = None,
        target: Optional[Target] = None,
        next_step: Optional[str] = None,
        **context: Any,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.operation_index = operation_index
        self.operation = operation
        self.target = list(target) if target is not None else None
        # A reason whose next action depends on the policy that refused it cannot come
        # from the table, so a raise site may carry its own sentence.
        self.explicit_next_step = next_step
        self.context = context

    @property
    def retryable(self) -> bool:
        return self.reason not in _NOT_RETRYABLE

    @property
    def next_step(self) -> Optional[str]:
        return self.explicit_next_step or NEXT_STEPS.get(self.reason)

    def to_detail(self) -> Dict[str, Any]:
        """The HTTP 422 ``detail`` body. Contract section 12."""
        reason: Dict[str, Any] = {"code": self.reason, "message": self.message}
        if self.next_step:
            reason["next_step"] = self.next_step
        reason.update(self.context)
        detail: Dict[str, Any] = {
            "code": self.code,
            "message": "No revision was committed.",
            "reason": reason,
            "retryable": self.retryable,
        }
        if self.operation_index is not None:
            detail["operation_index"] = self.operation_index
        if self.operation is not None:
            detail["operation"] = self.operation
        if self.target is not None:
            detail["target"] = self.target
        return detail

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (
            f"ChangeSetError(reason={self.reason!r}, "
            f"operation_index={self.operation_index!r}, message={self.message!r})"
        )


class _Fail(Exception):
    """Internal carrier so helpers can report without knowing the operation index."""

    def __init__(self, reason: str, message: str, **context: Any) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.context = context


# --------------------------------------------------------------------------------------
# Legacy primitives (the engine is the only implementation)
# --------------------------------------------------------------------------------------


def deep_merge(base: dict, patch: dict) -> dict:
    """Today's dict-only recursion. Nested dicts merge; scalars and lists replace.

    The wrapper used to keep its own copy and the two could drift. This is now the only
    implementation in the codebase, so there is nothing left to drift from.
    """
    merged = dict(base)
    for key, value in patch.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = deep_merge(current, value)
        else:
            merged[key] = value
    return merged


def remove_path(tree: dict, path: str) -> None:
    """Today's dotted-path delete. A missing path is a silent no-op."""
    keys = path.split(".")
    node = tree
    for key in keys[:-1]:
        node = node.get(key) if isinstance(node, dict) else None
        if not isinstance(node, dict):
            return
    node.pop(keys[-1], None)


# --------------------------------------------------------------------------------------
# Item identity
# --------------------------------------------------------------------------------------


def _tool_name(entry: Dict[str, Any], *, allow_legacy_fallback: bool) -> Optional[str]:
    """The canonical effective tool name. Contract 4.2."""
    kind = entry.get("type")
    if kind == "gateway":
        name = entry.get("name")
        if name:
            return name
        if not allow_legacy_fallback:
            return None
        integration = entry.get("integration")
        action = entry.get("action")
        if integration and action:
            return f"{integration}__{action}"
        return None
    if kind == "reference":
        return entry.get("name") or entry.get("slug")
    if kind == "platform":
        return entry.get("op")
    return entry.get("name")


def item_key(
    collection: str,
    entry: Any,
    *,
    allow_legacy_fallback: bool = True,
) -> Optional[str]:
    """The addressable key of one list entry, or ``None`` when it has none.

    ``None`` means "not addressable by name". An ``@ag.embed`` entry is the main case: its
    identity lives behind a server-side reference, so it gets no key here.
    """
    if not isinstance(entry, dict):
        return None
    if _EMBED_KEY in entry:
        return None
    if collection == "tools":
        name = _tool_name(entry, allow_legacy_fallback=allow_legacy_fallback)
        # The same guard the keyed branch below applies. A tool entry carries its name in
        # one of four fields, and any of them can hold a number or a null in a tree the
        # caller sent. A non-string key reaches the duplicate report's `join` and raises
        # TypeError, which leaves the caller with a 500 for a payload the engine should
        # refuse. An entry with no usable key is simply not addressable by name.
        return name if isinstance(name, str) and name else None
    key_field = KEY_FIELDS.get(collection)
    if key_field is None:
        return None
    value = entry.get(key_field)
    return value if isinstance(value, str) and value else None


# --------------------------------------------------------------------------------------
# Scope policies
# --------------------------------------------------------------------------------------


def allow_all(target: Target) -> Optional[str]:
    """The human/SDK caller's policy: any target is in scope."""
    return None


def subtree_scope(
    prefix: Sequence[str],
    *,
    refused: Sequence[Sequence[str]] = (),
) -> ScopePolicy:
    """Restrict every target to one subtree, minus any refused sub-paths.

    A target shorter than the prefix is refused: writing it would rewrite the subtree's
    parent.
    """
    wanted = list(prefix)
    blocked = [list(path) for path in refused]

    def policy(target: Target) -> Optional[str]:
        segments = list(target)
        if len(segments) < len(wanted):
            got = ".".join(str(s) for s in segments) or "<empty>"
            return f"the target must sit under '{'.'.join(wanted)}' (got: {got})"
        for depth, expected in enumerate(wanted):
            if segments[depth] != expected:
                return (
                    f"the target must sit under '{'.'.join(wanted)}' "
                    f"(segment {depth} is {_format_segment(segments[depth])})"
                )
        for path in blocked:
            if _plain_prefix(path, segments):
                return (
                    f"'{'.'.join(path)}' is owned by the platform and cannot be changed "
                    "by the agent"
                )
        return None

    policy._prefix = tuple(wanted)  # type: ignore[attr-defined]
    # The refused paths travel with the policy, because a target that sits ABOVE one of
    # them writes it through its value, and only the caller of the policy holds that value.
    policy._refused = tuple(tuple(path) for path in blocked)  # type: ignore[attr-defined]
    # The legacy arm walks the `set` tree only this deep before it asks the policy, so a
    # refused sub-path deeper than the prefix would never be reached and never refused.
    policy._prefix_depth = max(  # type: ignore[attr-defined]
        [len(wanted)] + [len(path) for path in blocked]
    )
    return policy


def _plain_prefix(prefix: Sequence[str], segments: Sequence[Segment]) -> bool:
    if len(segments) < len(prefix):
        return False
    return all(segments[i] == part for i, part in enumerate(prefix))


PARAMETERS_ONLY: ScopePolicy = subtree_scope(["parameters"])

# Contract via read-config.md 11.1: the agent writes its own agent subtree, minus the
# subtrees that decide what it may run. Widening this later is additive; narrowing is not.
AGENT_COMMIT_SCOPE: ScopePolicy = subtree_scope(
    ["parameters", "agent"],
    refused=(
        ["parameters", "agent", "harness", "kind"],
        ["parameters", "agent", "harness", "permissions"],
        ["parameters", "agent", "runner", "permissions"],
        ["parameters", "agent", "sandbox", "kind"],
        ["parameters", "agent", "sandbox", "permissions"],
    ),
)


def _format_segment(segment: Segment) -> str:
    if isinstance(segment, dict):
        return f"{segment.get('list')}[{segment.get('key')!r}]"
    return repr(segment)


# --------------------------------------------------------------------------------------
# The platform-guidance block
# --------------------------------------------------------------------------------------

# The runner appends a fenced block of platform guidance to the instructions file it renders
# into the agent's workspace. The stored configuration never contains it: it is injected at
# render time, on every harness. These two literals are the contract with the runner's
# `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts`, and a test pins them
# so neither side can change the fence alone.
PLATFORM_GUIDANCE_START = "<!-- agenta:platform-guidance:start -->"
PLATFORM_GUIDANCE_END = "<!-- agenta:platform-guidance:end -->"


def strip_platform_guidance(text: str) -> str:
    """Remove every platform-guidance block from one string.

    A model that copies the rendered instructions file back into a commit would otherwise
    store our own guidance as the user's configuration. Removing it is deliberately SILENT
    rather than a refusal: the model did nothing wrong, and an error it has to recover from
    costs a turn to teach it something it cannot act on.

    An unmatched opening fence strips to the end of the string, because whatever follows an
    opener is guidance whose closer was lost. An unmatched CLOSING fence is left alone: it is
    an inert comment without its opener, and deleting text on the strength of it would let a
    stray line remove a user's own content.

    The result is normalized so a stripped value does not carry the hole the block left: the
    whitespace run at each junction collapses to one blank line, and trailing whitespace goes.
    That makes the strip idempotent, so a value that has been through it once is stable.
    """
    if PLATFORM_GUIDANCE_START not in text:
        return text

    kept: List[str] = []
    rest = text
    while True:
        head, opened, tail = rest.partition(PLATFORM_GUIDANCE_START)
        kept.append(head)
        if not opened:
            break
        _, closed, after = tail.partition(PLATFORM_GUIDANCE_END)
        if not closed:
            break
        rest = after

    result = ""
    for piece in kept:
        if not result:
            result = piece
            continue
        left, right = result.rstrip(), piece.lstrip()
        result = f"{left}\n\n{right}" if left and right else (left or right)
    return result.rstrip()


def strip_guidance_from_data(data: Any) -> Tuple[Any, List[Warning]]:
    """Strip the guidance block from a whole configuration tree, outside the delta arms.

    A full-data commit never reaches the engine, and a copied-back instructions file can
    arrive that way as easily as through a delta. Same rule, same warnings, one entry point
    for the wrapper.
    """
    warnings: List[Warning] = []
    return _strip_guidance(data, warnings=warnings, path=[]), warnings


def _strip_guidance(
    value: Any,
    *,
    warnings: List[Warning],
    path: List[str],
    target: Optional[List[Segment]] = None,
    operation_index: Optional[int] = None,
) -> Any:
    """Strip every string in ``value``, warning once per field that carried a block.

    The warning names the field so the removal is visible in the response. Silent to the
    MODEL is the point; silent to the human reading the result is not.
    """
    if isinstance(value, str):
        stripped = strip_platform_guidance(value)
        if stripped != value:
            where = ".".join(path) if path else "the value"
            warnings.append(
                Warning(
                    code=WarningCode.PLATFORM_GUIDANCE_STRIPPED,
                    message=(
                        f"Removed the platform guidance block from {where}. That block is "
                        "added to your instructions file when it is rendered and is never "
                        "part of your stored configuration."
                    ),
                    target=list(target) if target is not None else None,
                    operation_index=operation_index,
                )
            )
        return stripped
    if isinstance(value, dict):
        return {
            key: _strip_guidance(
                child,
                warnings=warnings,
                path=path + [str(key)],
                target=target,
                operation_index=operation_index,
            )
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [
            _strip_guidance(
                child,
                warnings=warnings,
                path=path + [str(index)],
                target=target,
                operation_index=operation_index,
            )
            for index, child in enumerate(value)
        ]
    return value


# --------------------------------------------------------------------------------------
# The @ag.file marker
# --------------------------------------------------------------------------------------


def find_file_markers(value: Any, pointer: str = "") -> List[str]:
    """Every ``@ag.file`` marker inside a value, as JSON Pointers.

    The runner keys one execution-authorization record per marker, so the pointer is the
    identity the engine reports when it finds one that survived.
    """
    found: List[str] = []
    if isinstance(value, dict):
        if FILE_MARKER in value:
            found.append(pointer or "/")
        for key, child in value.items():
            found.extend(find_file_markers(child, f"{pointer}/{_escape(key)}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_file_markers(child, f"{pointer}/{index}"))
    return found


def _escape(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


# Contract 6. Every marker the platform defines. `@ag.references` and `@ag.selector` are
# only meaningful INSIDE an embed, and are checked there.
_REFERENCES_KEY = "@ag.references"
_SELECTOR_KEY = "@ag.selector"
_MARKER_PREFIX = "@ag."
_EMBED_KEYS = frozenset({_REFERENCES_KEY, _SELECTOR_KEY})
_KNOWN_MARKERS = frozenset({_EMBED_KEY, FILE_MARKER, _REFERENCES_KEY, _SELECTOR_KEY})

# Named in every refusal below, because a model that invents a marker has to be shown the
# two real ones rather than told that its guess was wrong.
_VALID_FORMS = (
    "An embed points at another stored artifact: "
    '{"@ag.embed": {"@ag.references": {"workflow_revision": {"id": "..."}}}}, '
    'with an optional {"@ag.selector": {"path": "..."}}. '
    'To pull in the contents of a file from your workspace, use {"@ag.file": "<path>"} '
    "instead, and the runner replaces it with the text before the commit is sent."
)


# A configuration nests a handful of levels: parameters.agent.skills[].files[].content is
# six. The limit is generous against real data and far below Python's recursion limit, so
# every recursive walk below it has stack to spare.
MAX_VALUE_DEPTH = 64


def _reject_deep_values(value: Any) -> None:
    """Refuse a value nested deeper than anything the engine can walk safely.

    ``deep_merge``, the marker walks and the scope walk all recurse over the value, so a
    deeply nested one raised ``RecursionError`` from inside the engine. That is a 500: the
    caller was told the server broke, when what happened is that it sent something the
    server will not accept. It is also the wrong answer to hand an agent, which can correct
    a refusal and cannot correct a crash.

    Measured ITERATIVELY. A recursive depth check is the same stack overflow it exists to
    prevent, one frame earlier.
    """
    stack = [(value, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_VALUE_DEPTH:
            raise _Fail(
                Reason.VALUE_TOO_DEEP,
                f"the value nests more than {MAX_VALUE_DEPTH} levels deep.",
                max_depth=MAX_VALUE_DEPTH,
            )
        if isinstance(node, dict):
            for child in node.values():
                stack.append((child, depth + 1))
        elif isinstance(node, list):
            for child in node:
                stack.append((child, depth + 1))


def _reject_bad_markers(value: Any, pointer: str = "") -> None:
    """Refuse a marker the platform does not define, or an embed that is not one.

    A live session invented ``{"@ag.embed": {"@ag.references": {"file": "/abs/path"}}}`` to
    import a file. Nothing rejected it: the embed resolver skips a reference whose value is
    not an object, so the invented marker resolved to nothing and the literal dict was
    STORED as the configuration value. The agent was told the commit succeeded, and the
    field held a marker instead of the file's text from then on.

    Refusing it here is a storage-integrity rule, not a courtesy: the engine is the last
    place that sees the value before it is written, and a marker it does not understand is
    a value nobody can read back.
    """
    if isinstance(value, list):
        for index, child in enumerate(value):
            _reject_bad_markers(child, f"{pointer}/{index}")
        return
    if not isinstance(value, dict):
        return

    for key, child in value.items():
        if isinstance(key, str) and key.startswith(_MARKER_PREFIX):
            if key not in _KNOWN_MARKERS:
                raise _Fail(
                    Reason.UNKNOWN_MARKER,
                    f"'{key}' at {pointer or '/'} is not a marker this platform defines. "
                    + _VALID_FORMS,
                    pointer=pointer or "/",
                    marker=key,
                )
            if key == _EMBED_KEY:
                _check_embed(child, f"{pointer}/{_escape(key)}")
        _reject_bad_markers(child, f"{pointer}/{_escape(str(key))}")


def _check_embed(embed: Any, pointer: str) -> None:
    """The canonical embed shape, as the resolver in ``core/embeds`` reads it."""
    if not isinstance(embed, dict) or not embed:
        raise _Fail(
            Reason.INVALID_EMBED,
            f"the embed at {pointer} is not an embed. " + _VALID_FORMS,
            pointer=pointer,
        )

    unknown = sorted(key for key in embed if key not in _EMBED_KEYS)
    if unknown:
        raise _Fail(
            Reason.INVALID_EMBED,
            f"the embed at {pointer} carries {', '.join(unknown)}, which an embed does "
            "not hold. " + _VALID_FORMS,
            pointer=pointer,
        )

    references = embed.get(_REFERENCES_KEY)
    if not isinstance(references, dict) or not references:
        raise _Fail(
            Reason.INVALID_EMBED,
            f"the embed at {pointer} has no '{_REFERENCES_KEY}' naming what it points at. "
            + _VALID_FORMS,
            pointer=pointer,
        )

    # A reference is an object identifying a stored artifact. A bare string here is the
    # shape a model reaches for when it means a file path, and it resolves to nothing.
    for kind, reference in references.items():
        if not isinstance(reference, dict) or not reference:
            raise _Fail(
                Reason.INVALID_EMBED,
                f"the reference '{kind}' at {pointer} is not an object identifying a "
                "stored artifact. " + _VALID_FORMS,
                pointer=pointer,
                reference=kind,
            )


def _reject_file_markers(value: Any) -> None:
    markers = find_file_markers(value)
    if not markers:
        return
    raise _Fail(
        Reason.UNRESOLVED_FILE_MARKER,
        f"an '{FILE_MARKER}' marker reached the engine at {', '.join(markers)}. "
        "The runner resolves every marker into text before the API sees the call.",
        pointers=markers,
    )


# --------------------------------------------------------------------------------------
# Target resolution
# --------------------------------------------------------------------------------------


def _validate_segment(segment: Any, position: int) -> None:
    if isinstance(segment, str):
        if not segment:
            raise _Fail(
                Reason.INVALID_TARGET_SHAPE, f"target segment {position} is empty"
            )
        return
    if isinstance(segment, dict):
        if set(segment) != {"list", "key"}:
            raise _Fail(
                Reason.INVALID_TARGET_SHAPE,
                f"target segment {position} must have exactly 'list' and 'key'",
            )
        if not isinstance(segment["list"], str) or not segment["list"]:
            raise _Fail(
                Reason.INVALID_TARGET_SHAPE,
                f"target segment {position} has an empty 'list'",
            )
        if not isinstance(segment["key"], str) or not segment["key"]:
            raise _Fail(
                Reason.INVALID_TARGET_SHAPE,
                f"target segment {position} has an empty 'key'",
            )
        return
    raise _Fail(
        Reason.INVALID_TARGET_SHAPE,
        f"target segment {position} must be a string or a {{list, key}} object",
    )


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


def _find_item(
    node: Any, list_name: str, key: str, *, where: str
) -> Tuple[List[Any], int]:
    """Find the single entry named ``key`` in the list at ``node[list_name]``."""
    if not isinstance(node, dict):
        raise _Fail(
            Reason.TARGET_TYPE_MISMATCH,
            f"{where}: expected an object, found {_type_name(node)}",
        )
    if list_name not in node:
        raise _Fail(Reason.TARGET_NOT_FOUND, f"{where}: '{list_name}' does not exist")
    collection = node[list_name]
    if not isinstance(collection, list):
        raise _Fail(
            Reason.TARGET_TYPE_MISMATCH,
            f"{where}: '{list_name}' is {_type_name(collection)}, not a list",
        )
    matches = [
        index
        for index, entry in enumerate(collection)
        if item_key(list_name, entry) == key
    ]
    if len(matches) > 1:
        raise _Fail(
            Reason.DUPLICATE_ITEM_KEY,
            f"{where}: '{list_name}' holds {len(matches)} entries named {key!r}",
            match_count=len(matches),
        )
    if not matches:
        raise _Fail(
            Reason.ITEM_NOT_FOUND, f"{where}: '{list_name}' has no entry named {key!r}"
        )
    return collection, matches[0]


def _walk(root: Dict[str, Any], segments: Sequence[Segment]) -> Any:
    """Resolve every segment and return the node it addresses. No auto-creation."""
    node: Any = root
    for position, segment in enumerate(segments):
        where = f"target segment {position}"
        if isinstance(segment, str):
            if not isinstance(node, dict):
                raise _Fail(
                    Reason.TARGET_TYPE_MISMATCH,
                    f"{where} ({segment!r}): the parent is {_type_name(node)}, "
                    "not an object",
                )
            if segment not in node:
                raise _Fail(
                    Reason.TARGET_NOT_FOUND, f"{where}: {segment!r} does not exist"
                )
            node = node[segment]
        else:
            collection, index = _find_item(
                node, segment["list"], segment["key"], where=where
            )
            node = collection[index]
    return node


def _walk_creating(root: Dict[str, Any], segments: Sequence[Segment]) -> Any:
    """Like ``_walk``, but a missing plain-string segment is created as ``{}``.

    Contract 5.3. Only `set` uses this, and only for its parents. It never creates through
    a selector: a missing entry is still an error, because inventing a list entry would
    invent an identity. An existing scalar / list / null parent is a type mismatch, never
    an overwrite.
    """
    node: Any = root
    for position, segment in enumerate(segments):
        where = f"target segment {position}"
        if isinstance(segment, str):
            if not isinstance(node, dict):
                raise _Fail(
                    Reason.TARGET_TYPE_MISMATCH,
                    f"{where} ({segment!r}): the parent is {_type_name(node)}, "
                    "not an object",
                )
            if segment not in node:
                node[segment] = {}
            elif not isinstance(node[segment], dict):
                raise _Fail(
                    Reason.TARGET_TYPE_MISMATCH,
                    f"{where}: {segment!r} is {_type_name(node[segment])}, so it cannot "
                    "hold the field you are setting",
                )
            node = node[segment]
        else:
            collection, index = _find_item(
                node, segment["list"], segment["key"], where=where
            )
            node = collection[index]
    return node


# --------------------------------------------------------------------------------------
# edit_text
# --------------------------------------------------------------------------------------

# Contract 5.6.1: every fold is ONE code point to ONE code point. That is what makes the
# byte-exact write true. A length-changing fold (trailing trim, run collapsing, CRLF, NFC)
# would put the match at an offset that does not exist in the original string, and
# recovering the real offsets needs the line-overlay machinery whose corruption risk is
# the reason this design rejected Pi's approach.
_FOLD_MAP = {
    # smart single quotes
    0x2018: "'",
    0x2019: "'",
    0x201A: "'",
    0x201B: "'",
    # smart double quotes
    0x201C: '"',
    0x201D: '"',
    0x201E: '"',
    0x201F: '"',
    # dashes and minus
    0x2010: "-",
    0x2011: "-",
    0x2012: "-",
    0x2013: "-",
    0x2014: "-",
    0x2015: "-",
    0x2212: "-",
    # spaces
    0x00A0: " ",
    0x2002: " ",
    0x2003: " ",
    0x2004: " ",
    0x2005: " ",
    0x2006: " ",
    0x2007: " ",
    0x2008: " ",
    0x2009: " ",
    0x200A: " ",
    0x202F: " ",
    0x205F: " ",
    0x3000: " ",
}


def _fold(text: str) -> str:
    """Length-preserving fold of quotes, dashes, and spaces to their ASCII forms."""
    return text.translate(_FOLD_MAP)


def content_class(field_name: str) -> str:
    """``prose`` or ``code``, from the field's name. Contract 5.6.1.

    An unknown field is ``code``, which means exact matching. Fail safe: a new field that
    nobody classified must not silently gain tolerance.
    """
    if field_name in _PROSE_FIELDS:
        return "prose"
    if field_name in _CODE_FIELDS:
        return "code"
    return "code"


def _count_overlapping(text: str, needle: str) -> int:
    """Every start position, not every non-overlapping occurrence. Contract 5.6.2.

    ``str.count`` reports one occurrence of ``"aa"`` in ``"aaa"``. Two start positions
    exist, so the anchor is ambiguous and must be refused.
    """
    count = 0
    index = text.find(needle)
    while index >= 0:
        count += 1
        index = text.find(needle, index + 1)
    return count


def nearest_lines(text: str, old_text: str, limit: int = 3) -> List[Dict[str, Any]]:
    """The lines of ``text`` most similar to ``old_text``, with their line numbers.

    A failed anchor is nearly always a near miss: stale, reformatted, or mistyped. Handing
    the agent the real lines lets it re-anchor in the same turn instead of spending one on
    another read (contract 12.4).

    It lives in the engine rather than beside the wrapper's other error helpers because it
    needs no context the engine lacks: the target string and the anchor are both in hand
    at the only place that raises ``text_not_found``.
    """
    if not text or not old_text:
        return []
    lines = text.splitlines()
    # This runs on a REFUSAL, so its cost is paid by a call that produces nothing. A field
    # may hold 200_000 characters, and scoring every line of one is a similarity pass per
    # line on the way to an error. The cap keeps a failed anchor cheap; the near miss an
    # agent needs is in the first screens of a field, not at the end of a hundred thousand
    # lines.
    if len(lines) > MAX_SCANNED_LINES:
        return []
    needle = old_text.strip().splitlines()[0] if old_text.strip() else old_text
    # Comparing against a very long line is quadratic in its length, and a minified or
    # single-line file is one such line. Clipping bounds the comparison without moving the
    # answer: the anchor's own first line is what is being matched.
    needle = needle[:MAX_SCANNED_LINE_LENGTH]
    scored: List[Tuple[float, int, str]] = []
    for number, line in enumerate(lines, start=1):
        ratio = SequenceMatcher(None, needle, line[:MAX_SCANNED_LINE_LENGTH]).ratio()
        scored.append((ratio, number, line))
    scored.sort(key=lambda row: (-row[0], row[1]))
    return [
        {"line": number, "text": line, "similarity": round(ratio, 3)}
        for ratio, number, line in scored[:limit]
        if ratio > 0
    ]


def apply_text_edits(
    text: str,
    edits: Sequence[Dict[str, str]],
    *,
    tolerance: str = "code",
) -> Tuple[str, bool]:
    """Apply anchored edits to one string. All or nothing.

    Returns the new text and whether any anchor needed the normalized retry.

    The contract, in order: a non-empty anchor; exactly one occurrence counted WITH
    overlap; every anchor matched against the pre-operation string; no overlapping
    matches; a batch that changes nothing is refused.

    ``tolerance`` is ``prose`` (exact first, then one normalized retry) or ``code``
    (exact only). The write is byte-exact either way: a normalized match still replaces
    the span of the ORIGINAL string, and no byte outside the span is touched.
    """
    if not edits:
        raise _Fail(Reason.INVALID_OPERATION_SHAPE, "edits must hold at least one edit")
    if len(edits) > MAX_EDITS_PER_OPERATION:
        raise _Fail(
            Reason.INVALID_OPERATION_SHAPE,
            f"an edit_text operation takes at most {MAX_EDITS_PER_OPERATION} edits",
        )
    if len(text) > MAX_TEXT_LENGTH:
        raise _Fail(
            Reason.TEXT_TOO_LARGE,
            f"the target string is {len(text)} characters; the limit is "
            f"{MAX_TEXT_LENGTH}",
        )

    folded_text = _fold(text) if tolerance == "prose" else None
    used_normalized = False
    matches: List[Tuple[int, int, str, int]] = []

    for index, edit in enumerate(edits):
        if not isinstance(edit, dict) or set(edit) - {"old_text", "new_text"}:
            raise _Fail(
                Reason.INVALID_OPERATION_SHAPE,
                f"edits[{index}] must hold exactly 'old_text' and 'new_text'",
            )
        old_text = edit.get("old_text")
        new_text = edit.get("new_text")
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            raise _Fail(
                Reason.INVALID_OPERATION_SHAPE,
                f"edits[{index}]: 'old_text' and 'new_text' must be strings",
            )
        if old_text == "":
            raise _Fail(
                Reason.EMPTY_OLD_TEXT,
                f"edits[{index}].old_text must not be empty",
                edit_index=index,
            )
        if len(old_text) > MAX_OLD_TEXT_LENGTH:
            raise _Fail(
                Reason.INVALID_OPERATION_SHAPE,
                f"edits[{index}].old_text is {len(old_text)} characters; the limit is "
                f"{MAX_OLD_TEXT_LENGTH}",
            )

        count = _count_overlapping(text, old_text)
        haystack, needle, normalized = text, old_text, False
        if count == 0 and folded_text is not None:
            folded_old = _fold(old_text)
            folded_count = _count_overlapping(folded_text, folded_old)
            if folded_count:
                haystack, needle, normalized = folded_text, folded_old, True
                count = folded_count

        if count == 0:
            # The near misses ride along, so the agent can re-anchor in this turn instead
            # of spending another one reading the field back (contract 12.4).
            candidates = nearest_lines(text, old_text)
            raise _Fail(
                Reason.TEXT_NOT_FOUND,
                f"edits[{index}].old_text does not occur in the target string. "
                "The text must match exactly, with all whitespace and newlines.",
                edit_index=index,
                **({"nearest_lines": candidates} if candidates else {}),
            )
        if count > 1:
            raise _Fail(
                Reason.TEXT_NOT_UNIQUE,
                f"edits[{index}].old_text matched {count} times.",
                edit_index=index,
                match_count=count,
            )

        # The fold is length-preserving, so a folded offset is the original offset.
        start = haystack.find(needle)
        matches.append((start, len(needle), new_text, index))
        used_normalized = used_normalized or normalized

    matches.sort(key=lambda match: match[0])
    for position in range(1, len(matches)):
        previous, current = matches[position - 1], matches[position]
        if previous[0] + previous[1] > current[0]:
            raise _Fail(
                Reason.TEXT_EDITS_OVERLAP,
                f"edits[{previous[3]}] and edits[{current[3]}] overlap.",
                edit_indexes=[previous[3], current[3]],
            )

    result = text
    for start, length, new_text, _ in reversed(matches):
        result = result[:start] + new_text + result[start + length :]

    # The input is bounded and each anchor is bounded, but the RESULT is not: 32 edits can
    # each grow the field. A field that passes the limit can never be edited again through
    # this operation, because the next call refuses its own input. Refusing the growth here
    # keeps the field editable.
    if len(result) > MAX_TEXT_LENGTH:
        raise _Fail(
            Reason.TEXT_TOO_LARGE,
            f"the edits would leave a string of {len(result)} characters; the limit is "
            f"{MAX_TEXT_LENGTH}",
        )

    if result == text:
        raise _Fail(
            Reason.NO_CHANGE,
            "The edits produced identical content. Nothing would change.",
        )
    return result, used_normalized


# --------------------------------------------------------------------------------------
# Operations
# --------------------------------------------------------------------------------------


def _operation_value(operation: Dict[str, Any]) -> Any:
    if "value" not in operation:
        raise _Fail(Reason.MISSING_OPERATION_VALUE, "the operation needs a 'value'")
    value = operation["value"]
    _reject_file_markers(value)
    _reject_bad_markers(value)
    return value


def _require_field_tail(segments: Sequence[Segment], verb: str) -> None:
    if isinstance(segments[-1], dict):
        raise _Fail(
            Reason.INVALID_TARGET_SHAPE,
            f"'{verb}' addresses an object field, so the last target segment must be a "
            "plain string. Use add_item / replace_item / remove_item for list entries.",
        )


def _require_selector_tail(segments: Sequence[Segment], verb: str) -> None:
    if not isinstance(segments[-1], dict):
        raise _Fail(
            Reason.INVALID_TARGET_SHAPE,
            f"'{verb}' addresses one named list entry, so the last target segment must "
            "be a {list, key} object.",
        )


def _derived_key(list_name: str, value: Any, verb: str) -> str:
    key = item_key(list_name, value, allow_legacy_fallback=False)
    if key is None:
        raise _Fail(
            Reason.ITEM_KEY_UNDEFINED,
            f"'{verb}' cannot derive a key for the new '{list_name}' entry.",
        )
    return key


def _parent_of(
    root: Dict[str, Any], segments: Sequence[Segment], *, create: bool
) -> Any:
    if len(segments) == 1:
        return root
    walker = _walk_creating if create else _walk
    return walker(root, segments[:-1])


def _require_object_parent(parent: Any, field_name: Any) -> Dict[str, Any]:
    if not isinstance(parent, dict):
        raise _Fail(
            Reason.TARGET_TYPE_MISMATCH,
            f"the parent of {field_name!r} is {_type_name(parent)}, not an object",
        )
    return parent


def _apply_operation(
    root: Dict[str, Any],
    operation: Dict[str, Any],
    warnings: List[Warning],
    index: int,
    touched: "_Touched",
) -> None:
    verb = operation.get("operation")
    if verb not in OPERATIONS:
        raise _Fail(
            Reason.UNKNOWN_OPERATION,
            f"unknown operation {verb!r} (known: {', '.join(OPERATIONS)})",
        )

    segments = operation.get("target")
    if not isinstance(segments, list) or not segments:
        raise _Fail(
            Reason.INVALID_TARGET_SHAPE, "the operation needs a non-empty 'target'"
        )
    if len(segments) > MAX_TARGET_SEGMENTS:
        raise _Fail(
            Reason.INVALID_TARGET_SHAPE,
            f"a target takes at most {MAX_TARGET_SEGMENTS} segments",
        )
    for position, segment in enumerate(segments):
        _validate_segment(segment, position)

    if verb in VALUE_BEARING:
        value = _strip_guidance(
            _operation_value(operation),
            warnings=warnings,
            path=[],
            target=segments,
            operation_index=index,
        )
    elif "value" in operation:
        raise _Fail(Reason.INVALID_OPERATION_SHAPE, f"'{verb}' does not take a value")
    else:
        value = None

    if verb == "set":
        _require_field_tail(segments, "set")
        parent = _require_object_parent(
            _parent_of(root, segments, create=True), segments[-1]
        )
        _warn_wholesale(segments[-1], value, warnings, index, segments)
        parent[segments[-1]] = deepcopy(value)
        touched.branch(segments)
        return

    if verb == "merge":
        _require_field_tail(segments, "merge")
        if not isinstance(value, dict):
            raise _Fail(Reason.INVALID_OPERATION_SHAPE, "'merge' takes an object value")
        parent = _require_object_parent(
            _parent_of(root, segments, create=False), segments[-1]
        )
        name = segments[-1]
        if name not in parent:
            raise _Fail(Reason.TARGET_NOT_FOUND, f"{name!r} does not exist")
        current = parent[name]
        if not isinstance(current, dict):
            raise _Fail(
                Reason.TARGET_TYPE_MISMATCH,
                f"'merge' needs an object target; {name!r} is {_type_name(current)}",
            )
        parent[name] = deep_merge(current, deepcopy(value))
        touched.branch(segments)
        return

    if verb == "remove":
        _require_field_tail(segments, "remove")
        parent = _require_object_parent(
            _parent_of(root, segments, create=False), segments[-1]
        )
        name = segments[-1]
        if name not in parent:
            raise _Fail(Reason.TARGET_NOT_FOUND, f"{name!r} does not exist")
        del parent[name]
        touched.branch(segments)
        return

    if verb == "edit_text":
        _require_field_tail(segments, "edit_text")
        mode = operation.get("match_mode", "auto")
        if mode not in MATCH_MODES:
            # Not UNKNOWN_OPERATION: the operation is `edit_text` and it exists. Reporting
            # an unknown OPERATION for a bad modifier told the agent its verb was wrong,
            # and non-retryably, so a one-word fix looked like a dead end.
            raise _Fail(
                Reason.INVALID_OPERATION_SHAPE,
                f"{mode!r} is not a match_mode. The modes are "
                f"{', '.join(repr(m) for m in MATCH_MODES)}.",
                next_step="Set match_mode to 'auto' or 'exact', or leave it out.",
                match_mode=mode,
            )
        edits = operation.get("edits")
        if not isinstance(edits, list):
            raise _Fail(
                Reason.INVALID_OPERATION_SHAPE, "'edit_text' needs an 'edits' list"
            )
        parent = _require_object_parent(
            _parent_of(root, segments, create=False), segments[-1]
        )
        name = segments[-1]
        if name not in parent:
            raise _Fail(Reason.TARGET_NOT_FOUND, f"{name!r} does not exist")
        current = parent[name]
        if not isinstance(current, str):
            raise _Fail(
                Reason.TARGET_TYPE_MISMATCH,
                f"'edit_text' needs a string target; {name!r} is {_type_name(current)}",
            )
        tolerance = "code" if mode == "exact" else content_class(name)
        new_text, normalized = apply_text_edits(current, edits, tolerance=tolerance)
        parent[name] = new_text
        if normalized:
            warnings.append(
                Warning(
                    code=WarningCode.TEXT_MATCHED_NORMALIZED,
                    message=(
                        "An anchor matched only after normalizing quotes, dashes, and "
                        "spaces. The stored text is unchanged outside the replaced span."
                    ),
                    target=list(segments),
                    operation_index=index,
                )
            )
        return

    if verb == "add_item":
        _require_field_tail(segments, "add_item")
        list_name = segments[-1]
        if list_name not in KEY_FIELDS:
            raise _Fail(
                Reason.UNKEYED_COLLECTION,
                f"'{list_name}' is not a name-addressed list "
                f"(known: {', '.join(sorted(KEY_FIELDS))})",
            )
        collection = _walk(root, segments)
        if not isinstance(collection, list):
            raise _Fail(
                Reason.TARGET_TYPE_MISMATCH,
                f"the target is {_type_name(collection)}, not a list",
            )
        key = _derived_key(list_name, value, "add_item")
        if any(item_key(list_name, entry) == key for entry in collection):
            raise _Fail(
                Reason.ITEM_ALREADY_EXISTS,
                f"'{list_name}' already holds an entry named {key!r}.",
            )
        collection.append(deepcopy(value))
        touched.item(segments)
        return

    if verb == "replace_item":
        _require_selector_tail(segments, "replace_item")
        selector = segments[-1]
        list_name, key = selector["list"], selector["key"]
        _require_keyed_list(list_name)
        parent = _parent_of(root, segments, create=False)
        collection, position = _find_item(
            parent, list_name, key, where=f"target segment {len(segments) - 1}"
        )
        new_key = _derived_key(list_name, value, "replace_item")
        if new_key != key:
            raise _Fail(
                Reason.ITEM_RENAME_NOT_ALLOWED,
                f"the target names {key!r} but the value is named {new_key!r}.",
            )
        collection[position] = deepcopy(value)
        touched.item(segments[:-1] + [list_name])
        return

    _require_selector_tail(segments, "remove_item")
    selector = segments[-1]
    _require_keyed_list(selector["list"])
    parent = _parent_of(root, segments, create=False)
    collection, position = _find_item(
        parent,
        selector["list"],
        selector["key"],
        where=f"target segment {len(segments) - 1}",
    )
    del collection[position]
    touched.item(segments[:-1] + [selector["list"]])


def _require_keyed_list(list_name: Any) -> None:
    """Only the four keyed lists are addressed by name. Contract 4.1.

    `add_item` has always said this precisely. Its two siblings went straight to the lookup,
    so selecting an entry of an unkeyed list reported that the list did not exist, or that
    no entry matched. Both are true and neither is the reason, and an agent reading them
    retries the same shape against a list that can never take it.
    """
    if list_name not in KEY_FIELDS:
        raise _Fail(
            Reason.UNKEYED_COLLECTION,
            f"'{list_name}' is not a name-addressed list "
            f"(known: {', '.join(sorted(KEY_FIELDS))})",
        )


def _warn_wholesale(
    name: Any,
    value: Any,
    warnings: List[Warning],
    index: int,
    segments: Sequence[Segment],
) -> None:
    if name in ("tools", "skills", "mcps") and isinstance(value, list):
        warnings.append(
            Warning(
                code=WarningCode.WHOLESALE_LIST_REPLACE,
                message=(
                    f"The change replaced the whole '{name}' list. Use add_item, "
                    "replace_item, or remove_item to change one entry."
                ),
                target=list(segments),
                operation_index=index,
            )
        )


# --------------------------------------------------------------------------------------
# Unique names
# --------------------------------------------------------------------------------------


# A path element is a field name, or one selected list entry as (list name, item key).
# The pair is what keeps two skills' `files` lists apart; without it every nested list in
# a keyed collection collapses onto one path and the siblings overwrite each other.
PathElement = Union[str, Tuple[str, str]]


class _Touched:
    """Which keyed lists an operation could have changed. Contract section 9."""

    def __init__(self) -> None:
        self.item_paths: List[Tuple[PathElement, ...]] = []
        self.branch_paths: List[Tuple[PathElement, ...]] = []

    @staticmethod
    def _plain(segments: Sequence[Segment]) -> Tuple[PathElement, ...]:
        # A selector names ONE entry, so it keeps its key. Dropping the key here is what
        # made an edit to one skill answer for every other skill's nested collections.
        return tuple(
            (s["list"], s["key"]) if isinstance(s, dict) else s for s in segments
        )

    def item(self, segments: Sequence[Segment]) -> None:
        self.item_paths.append(self._plain(segments))

    def branch(self, segments: Sequence[Segment]) -> None:
        path = self._plain(segments)
        self.branch_paths.append(path)
        # Writing INSIDE a selected entry touches the list that entry belongs to: the
        # write can change the entry's own key and collide with a sibling.
        for index, element in enumerate(path):
            if isinstance(element, tuple):
                self.branch_paths.append(path[:index] + (element[0],))


def _entry_identity(list_name: str, entry: Any, index: int) -> str:
    """How one entry of a keyed list is named inside a path.

    An entry with no derivable key (an `@ag.embed`) falls back to its position, so two
    unaddressable siblings still hold separate collections.
    """
    return item_key(list_name, entry) or f"#{index}"


def _collections(
    tree: Any, path: Tuple[PathElement, ...] = ()
) -> Dict[Tuple[PathElement, ...], List[Any]]:
    """Every keyed list in a tree, by its path.

    Entries of a KEYED list carry their key into the path, so a nested list belongs to the
    entry that holds it. Entries of an unkeyed list share their parent's path: no selector
    can address them, so nothing can touch a collection beneath one on its own.
    """
    found: Dict[Tuple[PathElement, ...], List[Any]] = {}
    if isinstance(tree, dict):
        for key, value in tree.items():
            child = path + (key,)
            if key in KEY_FIELDS and isinstance(value, list):
                found[child] = value
                for index, entry in enumerate(value):
                    found.update(
                        _collections(
                            entry,
                            path + ((key, _entry_identity(key, entry, index)),),
                        )
                    )
            else:
                found.update(_collections(value, child))
    elif isinstance(tree, list):
        for entry in tree:
            found.update(_collections(entry, path))
    return found


def _path_text(path: Sequence[PathElement]) -> str:
    return ".".join(
        f"{element[0]}[{element[1]}]" if isinstance(element, tuple) else element
        for element in path
    )


def _path_target(path: Sequence[PathElement]) -> List[Segment]:
    """The path as contract-shaped target segments, so a warning stays addressable."""
    return [
        {"list": element[0], "key": element[1]}
        if isinstance(element, tuple)
        else element
        for element in path
    ]


def _duplicates(list_name: str, entries: Sequence[Any]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for entry in entries:
        key = item_key(list_name, entry)
        if key is not None:
            counts[key] = counts.get(key, 0) + 1
    return {key: count for key, count in counts.items() if count > 1}


def _check_unique_names(
    base: Dict[str, Any],
    result: Dict[str, Any],
    touched: _Touched,
    warnings: List[Warning],
) -> None:
    before = {
        path: _duplicates(path[-1], entries)
        for path, entries in _collections(base).items()
    }
    for path, entries in _collections(result).items():
        after = _duplicates(path[-1], entries)
        if not after:
            continue
        was = before.get(path, {})
        item_touched = any(p == path for p in touched.item_paths)
        branch_touched = any(
            len(p) <= len(path) and path[: len(p)] == p for p in touched.branch_paths
        )
        if item_touched:
            raise _Fail(
                Reason.DUPLICATE_ITEM_KEY,
                f"'{_path_text(path)}' holds duplicate keys: "
                f"{', '.join(sorted(after))}.",
                duplicates=sorted(after),
            )
        grew = [key for key, count in after.items() if count > was.get(key, 0)]
        if branch_touched and grew:
            raise _Fail(
                Reason.DUPLICATE_ITEM_KEY,
                f"the change adds a duplicate key to '{_path_text(path)}': "
                f"{', '.join(sorted(grew))}.",
                duplicates=sorted(grew),
            )
        warnings.append(
            Warning(
                code=WarningCode.LEGACY_DUPLICATE_KEY,
                message=(
                    f"'{_path_text(path)}' already held duplicate keys before this "
                    f"change: {', '.join(sorted(after))}. Entries with a duplicate key "
                    "cannot be addressed by name."
                ),
                target=_path_target(path),
            )
        )


# --------------------------------------------------------------------------------------
# Delta form
# --------------------------------------------------------------------------------------


_LEGACY_FIELDS = ("set", "remove")


def _classify(delta: Dict[str, Any]) -> str:
    if not isinstance(delta, dict):
        raise ChangeSetError(Reason.INVALID_DELTA, "the delta must be an object")
    # FIRST, before anything walks or copies the delta. `deepcopy` and the scope walk are
    # themselves recursive passes over the value, so a guard placed after either of them is
    # a guard the overflow reaches first. One check here covers the legacy `set` and every
    # operation's `value`.
    try:
        _reject_deep_values(delta)
    except _Fail as failure:
        raise ChangeSetError(
            failure.reason, failure.message, **failure.context
        ) from failure

    unknown = set(delta) - {"set", "remove", "operations"}
    if unknown:
        raise ChangeSetError(
            Reason.INVALID_DELTA,
            f"unknown delta fields: {', '.join(sorted(unknown))}",
        )
    # Typed HERE, before either arm touches them. A non-dict `set` reached `deep_merge`,
    # and a `remove` sent as a string was iterated character by character, so each letter
    # became a path to delete. Both produced a crash or a silent nonsense edit where the
    # caller should have been told what shape the field takes.
    patch = delta.get("set")
    if patch is not None and not isinstance(patch, dict):
        raise ChangeSetError(
            Reason.INVALID_DELTA,
            f"'set' must be an object holding the fields to change, not "
            f"{_type_name(patch)}.",
        )
    removals = delta.get("remove")
    if removals is not None:
        if not isinstance(removals, list):
            raise ChangeSetError(
                Reason.INVALID_DELTA,
                f"'remove' must be a list of dotted field paths, not "
                f"{_type_name(removals)}.",
            )
        offenders = [item for item in removals if not isinstance(item, str)]
        if offenders:
            raise ChangeSetError(
                Reason.INVALID_DELTA,
                "every entry in 'remove' must be a dotted field path string.",
            )

    has_legacy = any(delta.get(name) is not None for name in _LEGACY_FIELDS)
    has_ordered = delta.get("operations") is not None
    if has_legacy and has_ordered:
        raise ChangeSetError(
            Reason.INVALID_DELTA,
            "a delta uses either 'set'/'remove' or 'operations', never both.",
        )
    if has_ordered:
        return "ordered"
    if has_legacy:
        return "legacy"
    raise ChangeSetError(
        Reason.INVALID_DELTA,
        "the delta is empty: give 'set'/'remove', or 'operations'.",
    )


def _legacy_scope_targets(delta: Dict[str, Any], depth: int) -> List[Target]:
    targets: List[Target] = []

    def walk(node: Any, path: List[str]) -> None:
        if len(path) >= depth or not isinstance(node, dict) or not node:
            targets.append(list(path))
            return
        for key, value in node.items():
            walk(value, path + [key])

    for key, value in (delta.get("set") or {}).items():
        walk(value, [key])
    for path in delta.get("remove") or []:
        targets.append(path.split("."))
    return targets


def _policy_depth(scope_policy: ScopePolicy) -> int:
    depth = getattr(scope_policy, "_prefix_depth", None)
    return depth if isinstance(depth, int) else 1


_MISSING = object()


def _value_at(tree: Any, path: Sequence[str]) -> Any:
    """What ``tree`` holds at ``path``, or ``_MISSING`` when the path is not there."""
    node = tree
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return _MISSING
        node = node[key]
    return node


def _refused_paths_under(
    scope_policy: ScopePolicy, target: Target
) -> List[Tuple[str, ...]]:
    """Refused paths that lie strictly BELOW this target.

    A selector segment never matches, because no refused path lives inside a list entry.
    """
    segments = list(target)
    found = []
    for path in getattr(scope_policy, "_refused", ()) or ():
        if len(path) <= len(segments):
            continue
        if all(segments[i] == path[i] for i in range(len(segments))):
            found.append(path)
    return found


def _check_scope_value(
    scope_policy: ScopePolicy,
    *,
    target: Target,
    verb: str,
    value: Any,
    base: Dict[str, Any],
    operation_index: Optional[int] = None,
) -> None:
    """Refuse an operation that writes a refused path THROUGH an ancestor target.

    The target check alone asks whether the caller named a refused path. It does not ask
    what the caller writes, so `set` on `parameters.agent.harness` with
    `{"kind": "codex"}` passed while `set` on `parameters.agent.harness.kind` was refused.
    Both change the same stored field.

    The rule is one sentence: whatever the operation would leave at a refused path must
    equal what is stored there now. That keeps the neighbours of a refused key writable,
    which matters because `harness.extras` and `runner.kind` are not refused and sit beside
    keys that are. An outright refusal of the parents would take those away with no gain.

    An omission is a write for `set`, which replaces its target wholesale, and for
    `remove`, which deletes it. It is not a write for `merge`, which leaves absent keys
    alone.
    """
    for path in _refused_paths_under(scope_policy, target):
        stored = _value_at(base or {}, path)
        if verb == "remove":
            written: Any = _MISSING
        else:
            written = _value_at(value, path[len(list(target)) :])
            if verb == "merge" and written is _MISSING:
                written = stored
        if written == stored:
            continue
        raise ChangeSetError(
            Reason.OUT_OF_SCOPE,
            f"this changes '{'.'.join(path)}', which is owned by the platform and "
            "cannot be changed by the agent",
            target=list(target),
            operation_index=operation_index,
            next_step=_scope_next_step(scope_policy),
        )


def _scope_next_step(scope_policy: ScopePolicy) -> str:
    """What to do about a scope refusal, naming the subtree the caller may write.

    The refusal message names the path that was refused; this names the boundary, so the
    two together tell an agent what to send instead.
    """
    prefix = ".".join(getattr(scope_policy, "_prefix", ()) or ())
    if not prefix:
        return "Remove the operation on that path and send the commit again."
    return (
        f"Write only under `{prefix}`. Remove the operation on the path this refusal "
        "names, then send the commit again."
    )


# --------------------------------------------------------------------------------------
# The engine
# --------------------------------------------------------------------------------------


def apply_change_set(
    base: Dict[str, Any],
    delta: Dict[str, Any],
    scope_policy: Optional[ScopePolicy] = None,
    *,
    validate: Optional[Callable[[Dict[str, Any]], Any]] = None,
) -> ChangeSetResult:
    """Apply ``delta`` to ``base``. Contract sections 7 and 8.

    Pure: ``base`` is never modified. On any failure it raises :class:`ChangeSetError` and
    no partial result escapes.
    """
    policy = scope_policy or allow_all
    form = _classify(delta)
    result = deepcopy(base) if base else {}
    warnings: List[Warning] = []
    touched = _Touched()

    if form == "legacy":
        for target in _legacy_scope_targets(delta, _policy_depth(policy)):
            refusal = policy(target)
            if refusal:
                raise ChangeSetError(
                    Reason.OUT_OF_SCOPE,
                    refusal,
                    target=list(target),
                    next_step=_scope_next_step(policy),
                )
        # The legacy `set` is one deep merge at the root, so one check over the whole patch
        # covers every refused path it would write, at any depth.
        _check_scope_value(
            policy,
            target=[],
            verb="merge",
            value=delta.get("set") or {},
            base=base,
        )
        for path in delta.get("remove") or []:
            _check_scope_value(
                policy,
                target=path.split("."),
                verb="remove",
                value=None,
                base=base,
            )
        warnings.append(
            Warning(
                code=WarningCode.LEGACY_DELTA_FORM,
                message=(
                    "This change used the legacy set/remove form. Ordered operations "
                    "change one field or one list entry at a time."
                ),
            )
        )
        # A copy, because `remove_path` mutates the result and `deep_merge` grafts the
        # patch's own sub-dicts into it. Without this the caller's delta is edited in
        # place, and the engine's promise that it touches nothing it was given is false.
        patch = _strip_guidance(
            deepcopy(delta.get("set") or {}),
            warnings=warnings,
            path=[],
        )
        _reject_delta_markers(patch)
        _reject_legacy_bad_markers(patch)
        for name in ("tools", "skills", "mcps"):
            nested = _legacy_list_write(patch, name)
            if nested is not None:
                _warn_wholesale(name, nested, warnings, 0, [name])
        result = deep_merge(result, patch)
        for path in delta.get("remove") or []:
            remove_path(result, path)
        for key in patch:
            touched.branch([key])
        return _finish(base, result, warnings, touched, validate)

    operations = delta["operations"]
    if not isinstance(operations, list) or not operations:
        raise ChangeSetError(
            Reason.INVALID_DELTA, "'operations' must hold at least one operation"
        )
    if len(operations) > MAX_OPERATIONS:
        raise ChangeSetError(
            Reason.INVALID_DELTA,
            f"a delta takes at most {MAX_OPERATIONS} operations",
        )

    # The scope guard runs before anything is applied: a refusal is a policy answer, and it
    # must not depend on how far the change set already got.
    for index, operation in enumerate(operations):
        if not isinstance(operation, dict):
            raise ChangeSetError(
                Reason.INVALID_OPERATION_SHAPE,
                "each operation must be an object",
                operation_index=index,
            )
        target = operation.get("target")
        if isinstance(target, list):
            refusal = policy(target)
            if refusal:
                raise ChangeSetError(
                    Reason.OUT_OF_SCOPE,
                    refusal,
                    operation_index=index,
                    operation=operation.get("operation"),
                    target=target,
                    next_step=_scope_next_step(policy),
                )
            # These four verbs carry or delete a whole subtree, so each can reach a refused
            # path that its target only sits above. `add_item` and `remove_item` change a
            # list entry and `edit_text` changes a string; no refused path lives in either.
            verb = operation.get("operation")
            if verb in ("set", "merge", "remove", "replace_item"):
                _check_scope_value(
                    policy,
                    target=target,
                    verb=verb,
                    value=operation.get("value"),
                    base=base,
                    operation_index=index,
                )

    for index, operation in enumerate(operations):
        try:
            _apply_operation(result, operation, warnings, index, touched)
        except _Fail as failure:
            raise ChangeSetError(
                failure.reason,
                failure.message,
                operation_index=index,
                operation=operation.get("operation"),
                target=operation.get("target"),
                **failure.context,
            ) from None

    return _finish(base, result, warnings, touched, validate)


def _legacy_list_write(patch: Any, name: str) -> Optional[List[Any]]:
    """The value a legacy `set` writes at any depth for one keyed list name."""
    if isinstance(patch, dict):
        for key, value in patch.items():
            if key == name and isinstance(value, list):
                return value
            found = _legacy_list_write(value, name)
            if found is not None:
                return found
    return None


def _reject_legacy_bad_markers(patch: Any) -> None:
    """The same marker rules on the legacy arm, which merges its patch in whole.

    The legacy arm has always been the one that stores a value verbatim, so it is the arm
    an invented marker actually reaches.
    """
    try:
        _reject_bad_markers(patch)
    except _Fail as failure:
        raise ChangeSetError(
            failure.reason, failure.message, **failure.context
        ) from failure


def _reject_delta_markers(patch: Any) -> None:
    markers = find_file_markers(patch)
    if markers:
        raise ChangeSetError(
            Reason.UNRESOLVED_FILE_MARKER,
            f"an '{FILE_MARKER}' marker appeared in a legacy delta at "
            f"{', '.join(markers)}. The legacy form does not carry file references.",
            pointers=markers,
        )


def _finish(
    base: Dict[str, Any],
    result: Dict[str, Any],
    warnings: List[Warning],
    touched: _Touched,
    validate: Optional[Callable[[Dict[str, Any]], Any]],
) -> ChangeSetResult:
    try:
        _check_unique_names(base or {}, result, touched, warnings)
    except _Fail as failure:
        raise ChangeSetError(
            failure.reason, failure.message, **failure.context
        ) from None

    if validate is not None:
        try:
            issues = validate(result)
        except ChangeSetError:
            raise
        except Exception as error:  # noqa: BLE001 - any failure is one reason code
            raise ChangeSetError(
                Reason.FINAL_VALIDATION_FAILED,
                "The finished configuration is not valid.",
                issues=[str(error)],
            ) from error
        if issues:
            raise ChangeSetError(
                Reason.FINAL_VALIDATION_FAILED,
                "The finished configuration is not valid.",
                issues=list(issues),
            )

    return ChangeSetResult(
        data=result,
        changed=result != (base or {}),
        warnings=warnings,
    )
