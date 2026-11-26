"""Reads the telemetry docs page for the tests that compare it with the payloads."""

import re
from pathlib import Path

DOCS_PAGE = (
    Path(__file__).resolve().parents[6]
    / "docs/docs/self-host/reference/03-telemetry.mdx"
)


def documented_fields(heading: str) -> set[str]:
    """The backticked names in the first column of the tables under `## <heading>`."""
    text = DOCS_PAGE.read_text()
    section = text.split(f"\n## {heading}\n", 1)[1].split("\n## ", 1)[0]
    return set(re.findall(r"^\| `([^`]+)` \|", section, flags=re.MULTILINE))
