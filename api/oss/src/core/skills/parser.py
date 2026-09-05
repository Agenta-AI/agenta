"""SKILL.md folder parsing for the skill registry import pipeline (WP-A4).

Pure functions over an extracted directory tree — no network, no DB. The
validation contract mirrors the SDK's `SkillTemplate` exactly
(`sdks/python/agenta/sdk/agents/skills/models.py`); anything this parser
accepts must construct a `SkillTemplate` without a ValidationError.

Layout detection order (`scan_tree`):
1. `.claude-plugin/marketplace.json` — a Claude plugin marketplace; each
   plugin's `skills/` directories are candidates.
2. a root `SKILL.md` — the tree IS one skill.
3. glob `**/SKILL.md` — a multi-skill repo; every directory holding a
   SKILL.md is a candidate (the invalid-upload recovery case).
"""

import json
import re
from pathlib import Path
from typing import Optional, List, Tuple

import yaml
from pydantic import BaseModel

# Mirrors of the SDK contract — keep in lockstep with
# sdks/python/agenta/sdk/agents/skills/models.py.
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SKILL_NAME_MAX = 64
SKILL_DESCRIPTION_MAX = 1_024
SKILL_BODY_MAX = 50_000
SKILL_FILE_PATH_MAX = 255
SKILL_FILE_CONTENT_MAX = 200_000

SKILL_MD = "SKILL.md"
MARKETPLACE_MANIFEST = ".claude-plugin/marketplace.json"


class SkillIssue(BaseModel):
    # Stable lower-snake-case cause, per the agent-actionable error contract.
    code: str
    message: str
    path: Optional[str] = None


class ParsedSkillFile(BaseModel):
    path: str
    content: str
    # Executables NEVER survive import — declared intent is recorded as a
    # warning instead (trust gate, ux-plan §Import).
    executable: bool = False


class ParsedSkill(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    body: Optional[str] = None
    disable_model_invocation: Optional[bool] = None
    files: List[ParsedSkillFile] = []


class ScanCandidate(BaseModel):
    path_in_repo: str
    valid: bool = False
    skill: Optional[ParsedSkill] = None
    issues: List[SkillIssue] = []
    warnings: List[SkillIssue] = []


class ScanResult(BaseModel):
    layout: str = "none"  # marketplace | single | multi | none
    candidates: List[ScanCandidate] = []
    issues: List[SkillIssue] = []


def _split_frontmatter(text: str) -> Tuple[dict, str, Optional[SkillIssue]]:
    if not text.startswith("---"):
        return {}, text, None

    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, flags=re.DOTALL)
    if not match:
        return (
            {},
            text,
            SkillIssue(
                code="frontmatter_unterminated",
                message="SKILL.md opens a frontmatter block that never closes.",
            ),
        )

    try:
        loaded = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        return (
            {},
            text[match.end() :],
            SkillIssue(
                code="frontmatter_invalid_yaml",
                message=f"SKILL.md frontmatter is not valid YAML: {e}",
            ),
        )

    frontmatter = loaded if isinstance(loaded, dict) else {}
    return frontmatter, text[match.end() :], None


def _validate_file_path(rel_path: str) -> Optional[SkillIssue]:
    # The four SDK path rules, in the SDK's spirit: reject anything that could
    # escape the skill directory or collide with the composed SKILL.md.
    if not rel_path or len(rel_path) > SKILL_FILE_PATH_MAX:
        return SkillIssue(
            code="file_path_invalid",
            message=f"File path must be 1-{SKILL_FILE_PATH_MAX} characters.",
            path=rel_path,
        )
    if rel_path.startswith("/") or re.match(r"^[A-Za-z]:", rel_path):
        return SkillIssue(
            code="file_path_absolute",
            message="Bundled file paths must be relative.",
            path=rel_path,
        )
    if "\\" in rel_path:
        return SkillIssue(
            code="file_path_backslash",
            message="Bundled file paths must use forward slashes.",
            path=rel_path,
        )
    if any(segment == ".." for segment in rel_path.split("/")):
        return SkillIssue(
            code="file_path_traversal",
            message="Bundled file paths may not contain '..' segments.",
            path=rel_path,
        )
    if rel_path.lower() == SKILL_MD.lower():
        return SkillIssue(
            code="file_path_reserved",
            message="A bundled root-level SKILL.md is reserved for the composed frontmatter.",
            path=rel_path,
        )
    return None


def parse_skill_dir(root: Path, *, path_in_repo: str = ".") -> ScanCandidate:
    """Parse one directory expected to hold a SKILL.md skill."""
    candidate = ScanCandidate(path_in_repo=path_in_repo)

    skill_md = root / SKILL_MD
    if not skill_md.is_file():
        candidate.issues.append(
            SkillIssue(
                code="skill_md_missing",
                message="No SKILL.md at the root of this folder.",
                path=path_in_repo,
            )
        )
        return candidate

    try:
        raw = skill_md.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        candidate.issues.append(
            SkillIssue(
                code="skill_md_not_text",
                message="SKILL.md is not valid UTF-8 text.",
                path=path_in_repo,
            )
        )
        return candidate

    frontmatter, body, frontmatter_issue = _split_frontmatter(raw)
    if frontmatter_issue:
        candidate.issues.append(frontmatter_issue)

    skill = ParsedSkill(
        name=frontmatter.get("name"),
        description=frontmatter.get("description"),
        body=body.strip() or None,
        disable_model_invocation=frontmatter.get("disable-model-invocation"),
    )

    if not skill.name or not SKILL_NAME_PATTERN.match(skill.name or ""):
        candidate.issues.append(
            SkillIssue(
                code="name_invalid",
                message="Frontmatter `name` must be kebab-case (a-z, 0-9, hyphens).",
            )
        )
    elif len(skill.name) > SKILL_NAME_MAX:
        candidate.issues.append(
            SkillIssue(
                code="name_too_long",
                message=f"`name` must be at most {SKILL_NAME_MAX} characters.",
            )
        )

    if not skill.description:
        candidate.issues.append(
            SkillIssue(
                code="description_missing",
                message="Frontmatter `description` is required — it is what the model reads to pick the skill.",
            )
        )
    elif len(skill.description) > SKILL_DESCRIPTION_MAX:
        candidate.issues.append(
            SkillIssue(
                code="description_too_long",
                message=f"`description` must be at most {SKILL_DESCRIPTION_MAX} characters.",
            )
        )

    if not skill.body:
        candidate.issues.append(
            SkillIssue(
                code="body_missing",
                message="SKILL.md has no body below the frontmatter.",
            )
        )
    elif len(skill.body) > SKILL_BODY_MAX:
        candidate.issues.append(
            SkillIssue(
                code="body_too_long",
                message=f"SKILL.md body must be at most {SKILL_BODY_MAX} characters.",
            )
        )

    for file_path in sorted(p for p in root.rglob("*") if p.is_file()):
        if file_path == skill_md:
            continue

        rel_path = file_path.relative_to(root).as_posix()

        path_issue = _validate_file_path(rel_path)
        if path_issue:
            candidate.issues.append(path_issue)
            continue

        content_bytes = file_path.read_bytes()
        if len(content_bytes) > SKILL_FILE_CONTENT_MAX:
            candidate.warnings.append(
                SkillIssue(
                    code="file_too_large",
                    message=f"Skipped — bundled files are capped at {SKILL_FILE_CONTENT_MAX // 1000} KB.",
                    path=rel_path,
                )
            )
            continue

        try:
            content = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            candidate.warnings.append(
                SkillIssue(
                    code="file_not_text",
                    message="Skipped — bundled files are text only.",
                    path=rel_path,
                )
            )
            continue

        if file_path.stat().st_mode & 0o111:
            candidate.warnings.append(
                SkillIssue(
                    code="executable_disabled",
                    message="Imported with the executable bit removed (executables never survive import).",
                    path=rel_path,
                )
            )

        skill.files.append(
            ParsedSkillFile(path=rel_path, content=content, executable=False)
        )

    candidate.skill = skill
    candidate.valid = not candidate.issues
    return candidate


def _marketplace_skill_dirs(root: Path) -> List[Path]:
    manifest_path = root / MARKETPLACE_MANIFEST
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    plugins = manifest.get("plugins")
    if not isinstance(plugins, list):
        return []

    dirs: List[Path] = []
    for plugin in plugins:
        if not isinstance(plugin, dict):
            continue
        source = plugin.get("source")
        plugin_root = root
        if isinstance(source, str) and source.strip("./"):
            plugin_root = (root / source.strip("./")).resolve()
            if (
                root.resolve() not in plugin_root.parents
                and plugin_root != root.resolve()
            ):
                continue
        skills_root = plugin_root / "skills"
        if skills_root.is_dir():
            dirs.extend(
                sorted(p.parent for p in skills_root.rglob(SKILL_MD) if p.is_file())
            )
    return dirs


def scan_tree(root: Path) -> ScanResult:
    """Detect the layout of an extracted tree and parse every skill candidate."""
    root = Path(root)

    if (root / MARKETPLACE_MANIFEST).is_file():
        skill_dirs = _marketplace_skill_dirs(root)
        return ScanResult(
            layout="marketplace",
            candidates=[
                parse_skill_dir(d, path_in_repo=d.relative_to(root).as_posix())
                for d in skill_dirs
            ],
        )

    if (root / SKILL_MD).is_file():
        return ScanResult(
            layout="single",
            candidates=[parse_skill_dir(root, path_in_repo=".")],
        )

    nested = sorted(p.parent for p in root.rglob(SKILL_MD) if p.is_file())
    if nested:
        return ScanResult(
            layout="multi",
            candidates=[
                parse_skill_dir(d, path_in_repo=d.relative_to(root).as_posix())
                for d in nested
            ],
            issues=[
                SkillIssue(
                    code="skill_md_missing",
                    message="No SKILL.md at the root of this folder.",
                )
            ],
        )

    return ScanResult(
        layout="none",
        issues=[
            SkillIssue(
                code="no_skills_found",
                message="No SKILL.md found anywhere in this folder.",
            )
        ],
    )
