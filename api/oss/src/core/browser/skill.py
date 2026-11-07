"""The ``browser`` skill: ``agenta-browser``, one Chromium the agent drives in its own sandbox.

The text is ``skill/SKILL.md`` and the scripts are every file under ``skill/scripts/``, read from
disk so they stay readable in a diff. The entry is ``scripts/agenta-browser.cjs``; it serves the
live view on port 8790, the runner's ``/browser/live`` finds it and the api relays it
(``apis/fastapi/browser/router.py``).
"""

from __future__ import annotations

from pathlib import Path

from agenta.sdk.agents.skills.models import SkillFile, SkillTemplate

SKILL_DIR = Path(__file__).parent / "skill"
SCRIPTS_DIR = SKILL_DIR / "scripts"
SCRIPT_PATH = "scripts/agenta-browser.cjs"

BROWSER_SKILL_NAME = "browser"
BROWSER_SLUG = "__ag__browser"
BROWSER_DESCRIPTION = (
    "Use a real browser in the sandbox for websites that have no connected integration: open "
    "pages, read them as text, click, type and fill forms. Read it before you use a website, "
    "when a site needs a sign-in, or when the person wants to watch or take over the browser."
)


def _script_files() -> list[SkillFile]:
    return [
        SkillFile(
            path=path.relative_to(SKILL_DIR).as_posix(),
            content=path.read_text(encoding="utf-8"),
        )
        for path in sorted(SCRIPTS_DIR.rglob("*.cjs"))
    ]


BROWSER_SKILL = SkillTemplate(
    name=BROWSER_SKILL_NAME,
    description=BROWSER_DESCRIPTION,
    body=(SKILL_DIR / "SKILL.md").read_text(encoding="utf-8"),
    files=_script_files(),
)
