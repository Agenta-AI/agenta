"""Canonical inline-skill declarations for the neutral agent config.

A skill is one shape: an inline package (the SKILL.md frontmatter fields, a Markdown body,
and optional bundled files). There is no ``source``/``type`` discriminator and no "curated"
variant; a skill that lives elsewhere is referenced through ``@ag.embed`` and resolves,
server-side and before the runner, into a value of exactly this shape.
"""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Harness skill-name rule (Pi/Claude/OpenCode/Antigravity): lowercase, digits, single
# hyphens, <=64 chars.
_SKILL_NAME = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")


def _validate_safe_skill_file_path(path: str) -> str:
    """Reject a bundled-file ``path`` that is absolute, escapes the skill dir, or collides with
    the composed ``SKILL.md``. Enforced on the model itself (not only in ``parsing.py``) so every
    construction path — direct ``SkillFile(...)`` / ``SkillTemplate(...)`` included — is safe."""
    if path.startswith("/") or path.startswith("\\"):
        raise ValueError(
            f"Skill file path must be relative, got absolute path: {path!r}"
        )
    # Reject backslash separators outright: they are not a valid relative POSIX path and a
    # `\\` segment would not be caught by the PurePosixPath parts check below.
    if "\\" in path:
        raise ValueError(
            f"Skill file path must use '/' separators, got backslash: {path!r}"
        )
    parts = PurePosixPath(path).parts
    if ".." in parts:
        raise ValueError(
            f"Skill file path must not escape the skill directory: {path!r}"
        )
    # A bundled file at the skill-dir root named SKILL.md (case-insensitive) would overwrite the
    # frontmatter the runner composes from name/description.
    if len(parts) == 1 and parts[0].lower() == "skill.md":
        raise ValueError(
            f"Skill file path may not be SKILL.md (reserved for the composed frontmatter): {path!r}"
        )
    return path


class SkillFile(BaseModel):
    """One bundled file laid beside SKILL.md, by relative path. ``content`` is inline text
    (UTF-8); a future ``uri`` variant can reference blob storage for binary assets. ``path`` is
    validated to a safe relative path (no leading ``/``, no ``..``, not ``SKILL.md``) so a file
    cannot escape the skill dir or clobber the composed frontmatter on materialize. ``content`` is
    untrusted author code; see the proposal's Security section."""

    model_config = ConfigDict(extra="forbid")

    path: str = Field(
        min_length=1, max_length=255
    )  # safe relative path, e.g. "scripts/foo.py"
    content: str = Field(max_length=200_000)  # UTF-8 (binary -> a later uri variant)
    executable: bool = False  # chmod +x only if policy allows it

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str) -> str:
        return _validate_safe_skill_file_path(value)

    def to_wire(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "content": self.content,
            "executable": self.executable,
        }


class SkillTemplate(BaseModel):
    """An inline skill package. The SKILL.md frontmatter + body and any bundled files ride the
    wire as content; the runner materializes them into a skill dir at run time. ``name`` and
    ``description`` are the two portable frontmatter fields; ``body`` is this skill's own
    SKILL.md Markdown content written after the composed frontmatter.

    To reference a skill instead of writing it inline, place an ``@ag.embed`` object in the
    ``skills`` list (or in any field below). The embed resolves, server-side and before the
    runner, into a value of exactly this shape."""

    model_config = ConfigDict(extra="forbid")

    name: str = _SKILL_NAME
    description: str = Field(
        min_length=1, max_length=1024
    )  # the trigger; required everywhere
    body: str = Field(
        min_length=1, max_length=50_000
    )  # this skill's SKILL.md content after frontmatter
    files: List[SkillFile] = Field(default_factory=list)  # bundled scripts / references
    disable_model_invocation: bool = (
        False  # Pi/Claude: hide from prompt, only /skill:name
    )
    allow_executable_files: bool = False  # default deny; sandbox policy must also allow

    def to_wire(self) -> Dict[str, Any]:
        """Serialize to the ``WireSkill`` shape (camelCase to match ``protocol.ts``). Optional
        flags and ``files`` are emitted only when set so a minimal skill stays minimal on the
        wire."""
        wire: Dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "body": self.body,
        }
        if self.files:
            wire["files"] = [file.to_wire() for file in self.files]
        if self.disable_model_invocation:
            wire["disableModelInvocation"] = True
        if self.allow_executable_files:
            wire["allowExecutableFiles"] = True
        return wire
