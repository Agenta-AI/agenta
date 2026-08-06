"""``parse_skill_templates``: list-of-dicts -> ``List[SkillTemplate]`` with safe-path validation.

Tolerates entries that are already plain dicts (the post-embed-resolution shape) and rejects
bundled-file paths that are absolute or escape the skill dir. The index is carried on the error
so a caller can point at the offending entry.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import SkillTemplate, parse_skill_template, parse_skill_templates
from agenta.sdk.agents.skills import SkillValidationError


def _skill(**overrides):
    base = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog.",
    }
    base.update(overrides)
    return base


def test_parses_plain_dicts():
    parsed = parse_skill_templates([_skill(), _skill(name="other")])
    assert [s.name for s in parsed] == ["release-notes", "other"]
    assert all(isinstance(s, SkillTemplate) for s in parsed)


def test_passes_through_skill_template_instances():
    skill = SkillTemplate(**_skill())
    assert parse_skill_template(skill).name == "release-notes"


def test_empty_list_is_empty():
    assert parse_skill_templates([]) == []


def test_invalid_name_raises_with_index():
    with pytest.raises(SkillValidationError) as exc:
        parse_skill_templates([_skill(), _skill(name="Bad Name")])
    assert exc.value.index == 1


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
    ],
)
def test_rejects_unsafe_file_paths(path):
    # The model's path validator raises a ValidationError, which the parser wraps into a
    # SkillValidationError (so unsafe paths are rejected on the parsing path too).
    with pytest.raises(SkillValidationError):
        parse_skill_template(_skill(files=[{"path": path, "content": "x"}]))


@pytest.mark.parametrize("path", ["scripts/foo.py", "references/notes.md", "a.txt"])
def test_accepts_safe_relative_file_paths(path):
    skill = parse_skill_template(_skill(files=[{"path": path, "content": "x"}]))
    assert skill.files[0].path == path


def test_unresolved_object_embed_raises_clear_error():
    # A raw @ag.embed reaching strict parsing means resolution was skipped (flags.resolve=False);
    # surface a clear, typed error instead of a confusing extra="forbid" ValidationError dump.
    embed = {
        "@ag.embed": {"@ag.references": {"workflow_revision": {"slug": "my-skill"}}}
    }
    with pytest.raises(SkillValidationError) as exc:
        parse_skill_template(embed)
    assert "unresolved" in str(exc.value).lower()


def test_unresolved_snippet_token_raises_clear_error():
    with pytest.raises(SkillValidationError) as exc:
        parse_skill_templates(
            ["@{{workflow_revision.slug=my-skill, path=parameters.skill}}"]
        )
    assert "unresolved" in str(exc.value).lower()
    assert exc.value.index == 0
