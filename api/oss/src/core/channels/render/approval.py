import re
from typing import Any, List, Optional

_SECRET_KEY = re.compile(
    r"(?:^|_)(?:password|passwd|secret|token|api_key|authorization|cookie|private_key)(?:$|_)",
    re.IGNORECASE,
)

# The durable mount root the runner gives a session:
# `.../agenta[/<namespace>]/mounts/<scope id>/<mount id>`, local
# (`/var/lib/agenta/...`) or in a sandbox (`/home/sandbox/agenta/...`). A tool
# argument names files under it with the full server path; the person sees the
# path inside the mount, as the drive shows it.
_SEGMENT = r"[^\s/'\"`]+"
_MOUNT_ROOT = re.compile(
    rf"(?:/{_SEGMENT})*/agenta/(?:{_SEGMENT}/)?mounts/{_SEGMENT}/{_SEGMENT}"
    r"(?:/|(?=[\s'\"`]|$))"
)

_DETAILS_MAX_CHARS = 600
_DETAILS_MAX_DEPTH = 3
_TRUNCATED = "[Truncated. Review the full request in Agenta.]"
_UNAVAILABLE = "Arguments unavailable. Review this request in Agenta before approving."


def redact_approval_arguments(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]"
            if _SECRET_KEY.search(str(key))
            else redact_approval_arguments(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_approval_arguments(item) for item in value]
    return value


def strip_mount_roots(text: str) -> str:
    """`/var/lib/agenta/mounts/<scope>/<mount>/notes/a.md` -> `notes/a.md`,
    also inside a command. Paths outside a mount stay as they are: they name
    what the call touches."""

    return _MOUNT_ROOT.sub("", text)


def approval_label(tool: Any) -> str:
    """The card title's subject. An identifier tool name reads better
    humanized (`discover_tools` -> "Discover tools"). Anything else is the
    harness's own description of the call, often the literal command, and is
    shown verbatim: `.capitalize()` lower-cased the rest of it and `_` became
    a space, so the card showed a command that was not the one being approved
    (QA finding, 2026-09-23)."""

    if not tool:
        return ""
    text = strip_mount_roots(str(tool)[:1000]).strip()
    if re.fullmatch(r"[A-Za-z0-9_]+", text):
        text = text.replace("_", " ").strip().capitalize()
    return text if len(text) <= 160 else text[:159] + "…"


def approval_title(tool: Any, *, heading: str = "Approval needed") -> str:
    label = approval_label(tool)
    return f"{heading}: {label}" if label else heading


def approval_outcome(*, approved: bool, by: Optional[str] = None) -> str:
    """What an answered approval card says in place of "Approval needed"."""

    verdict = "Approved" if approved else "Denied"
    return f"{verdict} by {by}" if by else verdict


def _field_name(key: Any) -> str:
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", str(key))
    words = re.sub(r"[_\-\s]+", " ", words).strip().lower()
    return words[:1].upper() + words[1:] if words else str(key)


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "yes" if value else "no"
    # Only the first characters can be shown; cutting first also bounds the
    # mount-root search on a large file body.
    return strip_mount_roots(str(value)[: 2 * _DETAILS_MAX_CHARS]).strip()


def _field_lines(name: str, value: Any, *, indent: str, depth: int) -> List[str]:
    if isinstance(value, dict):
        nested = _dict_lines(value, indent=indent + "  ", depth=depth + 1)
        return [f"{indent}{name}:", *nested] if nested else []
    if isinstance(value, list):
        items = [item for item in value if not _is_empty(item)]
        if all(not isinstance(item, (dict, list)) for item in items):
            text = ", ".join(t for t in (_scalar(item) for item in items) if t)
            return [f"{indent}{name}: {text}"] if text else []
        if depth >= _DETAILS_MAX_DEPTH:
            return [f"{indent}{name}: …"]
        lines = [f"{indent}{name}:"]
        for item in items:
            if isinstance(item, dict):
                lines.extend(_dict_lines(item, indent=indent + "  ", depth=depth + 1))
            elif isinstance(item, list):
                lines.append(f"{indent}  …")
            else:
                lines.append(f"{indent}  {_scalar(item)}")
        return lines
    text = _scalar(value)
    if not text:
        return []
    if "\n" in text:
        return [f"{indent}{name}:", text]
    return [f"{indent}{name}: {text}"]


def _dict_lines(arguments: dict, *, indent: str, depth: int) -> List[str]:
    if depth > _DETAILS_MAX_DEPTH:
        return [f"{indent}…"]
    lines: List[str] = []
    for key, value in arguments.items():
        if _is_empty(value):
            continue
        lines.extend(_field_lines(_field_name(key), value, indent=indent, depth=depth))
    return lines


def approval_details(arguments: Any) -> str:
    """The tool call's arguments in plain words, one per line ("File path:
    notes/a.md"), with secrets redacted and mount roots removed. Never the raw
    JSON: the person approving is often not technical. Empty when the call has
    no arguments."""

    if not isinstance(arguments, dict):
        return _UNAVAILABLE
    text = "\n".join(
        _dict_lines(redact_approval_arguments(arguments), indent="", depth=0)
    )
    # Reserve room for HTML escaping and the title within provider message limits.
    if len(text) > _DETAILS_MAX_CHARS:
        text = text[:_DETAILS_MAX_CHARS] + "\n" + _TRUNCATED
    return text
