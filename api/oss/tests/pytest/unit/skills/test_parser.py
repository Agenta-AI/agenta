"""SKILL.md parser (WP-A4): layout detection, the SDK contract, trust gates.

Fixture cases map to the mockups' upload states: clean (1d), nested multi /
no-root recovery (1e), oversized/binary skips (1e warnings)."""

import os
from pathlib import Path

from oss.src.core.skills.parser import (
    parse_skill_dir,
    scan_tree,
    SKILL_FILE_CONTENT_MAX,
)


def _write_skill(
    root: Path,
    *,
    name: str = "meeting-notes",
    description: str = "How we structure meeting summaries.",
    body: str = "Summaries have four sections.",
) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n---\n{body}\n",
        encoding="utf-8",
    )
    return root


def test_clean_skill_parses_with_files(tmp_path):
    root = _write_skill(tmp_path / "skill")
    (root / "templates").mkdir()
    (root / "templates" / "summary.md").write_text("template", encoding="utf-8")

    candidate = parse_skill_dir(root)

    assert candidate.valid
    assert candidate.skill.name == "meeting-notes"
    assert candidate.skill.body == "Summaries have four sections."
    assert [f.path for f in candidate.skill.files] == ["templates/summary.md"]
    assert candidate.warnings == []


def test_missing_root_skill_md_recovers_nested_skills(tmp_path):
    _write_skill(tmp_path / "meeting-notes", name="meeting-notes")
    _write_skill(tmp_path / "weekly-report", name="weekly-report")

    result = scan_tree(tmp_path)

    assert result.layout == "multi"
    assert [i.code for i in result.issues] == ["skill_md_missing"]
    assert sorted(c.path_in_repo for c in result.candidates) == [
        "meeting-notes",
        "weekly-report",
    ]
    assert all(c.valid for c in result.candidates)


def test_single_and_empty_layouts(tmp_path):
    empty = scan_tree(tmp_path)
    assert empty.layout == "none"
    assert [i.code for i in empty.issues] == ["no_skills_found"]

    _write_skill(tmp_path)
    single = scan_tree(tmp_path)
    assert single.layout == "single"
    assert single.candidates[0].valid


def test_marketplace_layout(tmp_path):
    (tmp_path / ".claude-plugin").mkdir()
    (tmp_path / ".claude-plugin" / "marketplace.json").write_text(
        '{"plugins": [{"name": "p", "source": "./plugin-a"}]}',
        encoding="utf-8",
    )
    _write_skill(tmp_path / "plugin-a" / "skills" / "docx", name="docx")

    result = scan_tree(tmp_path)

    assert result.layout == "marketplace"
    assert [c.path_in_repo for c in result.candidates] == ["plugin-a/skills/docx"]
    assert result.candidates[0].valid


def test_sdk_contract_violations_are_issues(tmp_path):
    root = tmp_path / "bad"
    root.mkdir()
    (root / "SKILL.md").write_text(
        "---\nname: Not Kebab\n---\n",
        encoding="utf-8",
    )

    candidate = parse_skill_dir(root)

    codes = {i.code for i in candidate.issues}
    assert codes == {"name_invalid", "description_missing", "body_missing"}
    assert not candidate.valid


def test_trust_gates_skip_binary_oversized_and_disarm_executables(tmp_path):
    root = _write_skill(tmp_path / "skill")
    (root / "demo.bin").write_bytes(b"\xff\xfe\x00binary")
    (root / "huge.md").write_text("x" * (SKILL_FILE_CONTENT_MAX + 1), encoding="utf-8")
    script = root / "run.sh"
    script.write_text("echo hi", encoding="utf-8")
    os.chmod(script, 0o755)

    candidate = parse_skill_dir(root)

    assert candidate.valid  # warnings never block
    warning_codes = sorted(w.code for w in candidate.warnings)
    assert warning_codes == ["executable_disabled", "file_not_text", "file_too_large"]
    kept = {f.path for f in candidate.skill.files}
    assert kept == {"run.sh"}
    assert all(f.executable is False for f in candidate.skill.files)


def test_reserved_and_unsafe_paths_are_rejected():
    # Pure-validator check: a case-insensitive filesystem (macOS) collapses a
    # skill.md fixture into SKILL.md, so the rules are asserted directly.
    from oss.src.core.skills.parser import _validate_file_path

    cases = {
        "/etc/passwd": "file_path_absolute",
        "C:whatever": "file_path_absolute",
        "sub\\notes.md": "file_path_backslash",
        "../escape.md": "file_path_traversal",
        "a/../b.md": "file_path_traversal",
        "skill.md": "file_path_reserved",
        "SKILL.MD": "file_path_reserved",
        "x" * 300: "file_path_invalid",
    }
    for path, expected in cases.items():
        issue = _validate_file_path(path)
        assert issue is not None and issue.code == expected, path

    assert _validate_file_path("sub/SKILL.md") is None  # nested is allowed
    assert _validate_file_path("templates/summary.md") is None


def test_parsed_skill_constructs_sdk_template(tmp_path):
    """Anything the parser accepts must survive the SDK model unmodified."""
    from agenta.sdk.agents.skills.models import SkillTemplate

    root = _write_skill(tmp_path / "skill")
    (root / "ref.md").write_text("reference", encoding="utf-8")

    candidate = parse_skill_dir(root)
    assert candidate.valid

    template = SkillTemplate(
        name=candidate.skill.name,
        description=candidate.skill.description,
        body=candidate.skill.body,
        files=[f.model_dump() for f in candidate.skill.files],
    )
    assert template.name == "meeting-notes"
