"""``SkillConfig`` / ``SkillFile`` validation: the single inline-package shape.

A skill is one shape (no discriminator). These lock the name pattern, the required fields, the
length bounds, the default-deny flags, and ``extra="forbid"`` so a stray key never rides the
wire.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents import SkillConfig, SkillFile


def _skill(**overrides):
    base = {
        "name": "release-notes",
        "description": "Draft release notes from a changelog.",
        "body": "Read the changelog, then write release notes.",
    }
    base.update(overrides)
    return base


def test_minimal_skill_defaults():
    skill = SkillConfig(**_skill())
    assert skill.name == "release-notes"
    assert skill.files == []
    assert skill.disable_model_invocation is False
    assert skill.allow_executable_files is False


@pytest.mark.parametrize("name", ["release-notes", "a", "skill1", "a-b-c", "x9"])
def test_valid_skill_names(name):
    assert SkillConfig(**_skill(name=name)).name == name


@pytest.mark.parametrize(
    "name",
    [
        "Release-Notes",  # uppercase
        "release_notes",  # underscore
        "-leading",  # leading hyphen
        "trailing-",  # trailing hyphen
        "double--hyphen",  # consecutive hyphens
        "",  # empty
        "a" * 65,  # too long
    ],
)
def test_invalid_skill_names_rejected(name):
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(name=name))


def test_description_required_and_bounded():
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(description=""))
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(description="x" * 1025))


def test_body_required_and_bounded():
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(body=""))
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(body="x" * 50_001))


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(source="curated"))


def test_skill_file_defaults_and_bounds():
    file = SkillFile(path="scripts/foo.py", content="print(1)")
    assert file.executable is False
    with pytest.raises(ValidationError):
        SkillFile(path="", content="x")
    with pytest.raises(ValidationError):
        SkillFile(path="x", content="y" * 200_001)


def test_skill_file_extra_forbidden():
    with pytest.raises(ValidationError):
        SkillFile(path="a", content="b", mode="0755")


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",  # absolute
        "../escape.py",  # parent traversal
        "scripts/../../escape.py",  # traversal mid-path
        "\\windows\\path",  # backslash absolute
        "scripts\\foo.py",  # backslash separator
        "SKILL.md",  # would clobber the composed frontmatter
        "skill.md",  # ...case-insensitive
        "Skill.MD",
    ],
)
def test_skill_file_path_validated_on_the_model(path):
    # The safe-path rule rides the model itself, so a *direct* construction (not just the
    # parsing helper) rejects an unsafe path. This is the bypass the validator closes.
    with pytest.raises(ValidationError):
        SkillFile(path=path, content="x")
    with pytest.raises(ValidationError):
        SkillConfig(**_skill(files=[{"path": path, "content": "x"}]))


@pytest.mark.parametrize(
    "path", ["scripts/foo.py", "references/notes.md", "a.txt", "nested/skill.md"]
)
def test_skill_file_safe_paths_accepted_on_the_model(path):
    # A nested `skill.md` (not at the dir root) is fine; only the root SKILL.md is reserved.
    assert SkillFile(path=path, content="x").path == path


def test_to_wire_minimal_omits_optional_flags():
    wire = SkillConfig(**_skill()).to_wire()
    assert wire == {
        "name": "release-notes",
        "description": "Draft release notes from a changelog.",
        "body": "Read the changelog, then write release notes.",
    }
    assert "files" not in wire
    assert "disableModelInvocation" not in wire
    assert "allowExecutableFiles" not in wire


def test_to_wire_carries_files_and_flags_camelcase():
    wire = SkillConfig(
        **_skill(
            files=[
                {"path": "scripts/foo.py", "content": "print(1)", "executable": True}
            ],
            disable_model_invocation=True,
            allow_executable_files=True,
        )
    ).to_wire()
    assert wire["files"] == [
        {"path": "scripts/foo.py", "content": "print(1)", "executable": True}
    ]
    assert wire["disableModelInvocation"] is True
    assert wire["allowExecutableFiles"] is True
