"""The error shared by the agent template's list entries: a skill, an MCP server, a tool.

The runtime parses each entry of ``skills``, ``mcps`` and ``tools`` on its own, and a
refused entry fails every run of the agent. The error carries the entry's position and the
problems found inside it, located relative to the entry, so a caller can name the field to
fix (``skills[0].body is required``) instead of echoing the parser's message.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional, Sequence, Tuple, Union

from pydantic import ValidationError


@dataclass(frozen=True)
class ConfigIssue:
    """One problem inside one entry. ``loc`` is relative to the entry, e.g. ``("body",)``."""

    loc: Tuple[Union[str, int], ...]
    missing: bool
    message: str

    def describe(self, field: str) -> str:
        """The problem under ``field``, e.g. ``skills[0].body is required``."""
        path = field + "".join(
            f"[{part}]" if isinstance(part, int) else f".{part}" for part in self.loc
        )
        if self.missing:
            return f"{path} is required"
        return f"{path} is invalid: {self.message}"


def config_issues(
    error: ValidationError, *, tag: Optional[str] = None
) -> Tuple[ConfigIssue, ...]:
    """The problems pydantic found in one entry.

    ``tag`` is the entry's union tag, when the entry is parsed as a tagged union: pydantic
    puts each problem under it, and it is the entry's own ``type``, not a field of it.
    """
    issues = []
    for problem in error.errors(include_url=False, include_input=False):
        loc = tuple(problem["loc"])
        if tag is not None and loc and loc[0] == tag:
            loc = loc[1:]
        issues.append(
            ConfigIssue(
                loc=loc,
                missing=problem["type"] == "missing",
                message=problem["msg"],
            )
        )
    return tuple(issues)


class ConfigEntryError(RuntimeError):
    """An entry of an agent template list that the runtime cannot parse."""

    def __init__(
        self,
        message: str,
        *,
        index: Optional[int] = None,
        value: Any = None,
        issues: Sequence[ConfigIssue] = (),
    ) -> None:
        super().__init__(message)
        self.index = index
        self.value = value
        self.issues = tuple(issues)

    def describe(self, field: str) -> List[str]:
        """One line per problem under ``field``, the entry's own path.

        An entry refused for a reason pydantic did not locate (an unresolved embed, a
        duplicate entry, an unknown shape) is one line with the parser's message.
        """
        if self.issues:
            return [issue.describe(field) for issue in self.issues]
        return [f"{field} is invalid: {self}"]
