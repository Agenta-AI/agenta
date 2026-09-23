"""The ``agenta-apps`` skill, assembled from ``skill/sections/*.md``.

``skill/SKILL.md`` is checked in so the text is readable in git and reviewable in a diff; a
unit test asserts it equals ``render_skill_md()``. The one generated section
(``06-starters.md``, the starter table) is rendered from the bundle so it can never list a
starter that does not exist. Regenerate both with::

    uv run --no-sync python -m oss.src.core.apps.assembly

The catalogue entry (``static_catalog.py``) wraps ``AGENTA_APPS_SKILL``: the body is the
assembled text after the front matter, and every starter's ``SKILL.md`` rides along under
``references/starters/`` so the agent can read a starter's config keys without a tool call.
``list_starters`` stays the live discovery path (it also sees agent-authored starters).
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from agenta.sdk.agents.skills.models import SkillFile, SkillTemplate

from oss.src.core.apps.service import (
    BUNDLE_STARTERS_DIR,
    STARTER_SKILL_FILENAME,
    AppsService,
    StarterInfo,
)

SKILL_DIR = Path(__file__).parent / "skill"
SECTIONS_DIR = SKILL_DIR / "sections"
SKILL_MD_PATH = SKILL_DIR / "SKILL.md"
STARTERS_SECTION = "06-starters.md"

AGENTA_APPS_SKILL_NAME = "agenta-apps"
AGENTA_APPS_SLUG = "__ag__agenta_apps"
AGENTA_APPS_DESCRIPTION = (
    "How to give the person a small interactive page in the drive: a board, checklist, "
    "queue, form, table or dashboard. Read it when the ask is for something to look at "
    "and touch rather than a reply. Covers picking a starter with create_app, the app "
    "folder layout, and the window.agenta bridge for hand-written apps."
)

# The instruction text (everything but the generated table) stays small: it is read on every
# app request, next to the person's own instructions.
BODY_BUDGET_BYTES = 4608
TOTAL_BUDGET_BYTES = 6 * 1024


def render_starters_table(starters: List[StarterInfo]) -> str:
    lines = [
        "",
        "## Starters",
        "",
        "| Starter | Use when | Config keys | Data files | Access |",
        "|---|---|---|---|---|",
    ]
    for s in starters:
        lines.append(
            f"| `{s.ref}` | {s.when} | {', '.join(s.config_keys) or '-'} | "
            f"{', '.join(s.data_files) or '-'} | {s.access} |"
        )
    lines.append("")
    lines.append(
        "`create_app` copies the starter; `list_starters` shows this table live."
    )
    return "\n".join(lines) + "\n"


def section_files() -> List[Path]:
    return sorted(p for p in SECTIONS_DIR.iterdir() if p.suffix == ".md")


def assemble_body(starters: Optional[List[StarterInfo]] = None) -> str:
    """Sections in filename order; the starters section is rendered, never read."""
    if starters is None:
        starters = AppsService(starters_dir=BUNDLE_STARTERS_DIR).list_bundle_starters()
    parts: List[str] = []
    for path in section_files():
        if path.name == STARTERS_SECTION:
            parts.append(render_starters_table(starters))
        else:
            parts.append(path.read_text(encoding="utf-8"))
    return "".join(parts).rstrip() + "\n"


def instruction_body(starters: Optional[List[StarterInfo]] = None) -> str:
    """The body without the generated table, for the size budget."""
    if starters is None:
        starters = []
    return "".join(
        p.read_text(encoding="utf-8")
        for p in section_files()
        if p.name != STARTERS_SECTION
    )


def render_skill_md(body: Optional[str] = None) -> str:
    body = assemble_body() if body is None else body
    front_matter = (
        "---\n"
        f"name: {AGENTA_APPS_SKILL_NAME}\n"
        "description: >-\n"
        f"  {AGENTA_APPS_DESCRIPTION}\n"
        "---\n"
    )
    return front_matter + body


def starter_reference_files() -> List[SkillFile]:
    files: List[SkillFile] = []
    for path in sorted(BUNDLE_STARTERS_DIR.iterdir()):
        skill = path / STARTER_SKILL_FILENAME
        if skill.is_file():
            files.append(
                SkillFile(
                    path=f"references/starters/{path.name}.md",
                    content=skill.read_text(encoding="utf-8"),
                )
            )
    return files


AGENTA_APPS_SKILL = SkillTemplate(
    name=AGENTA_APPS_SKILL_NAME,
    description=AGENTA_APPS_DESCRIPTION,
    body=assemble_body(),
    files=starter_reference_files(),
)


def write_generated_files() -> None:
    starters = AppsService(starters_dir=BUNDLE_STARTERS_DIR).list_bundle_starters()
    (SECTIONS_DIR / STARTERS_SECTION).write_text(
        render_starters_table(starters), encoding="utf-8"
    )
    SKILL_MD_PATH.write_text(render_skill_md(assemble_body(starters)), encoding="utf-8")


if __name__ == "__main__":
    write_generated_files()
    print(f"wrote {SECTIONS_DIR / STARTERS_SECTION} and {SKILL_MD_PATH}")
