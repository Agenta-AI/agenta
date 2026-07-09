"""Template playbooks bundled with the build-an-agent skill.

Each Agenta agent template (changelog writer, issue triager, support router, ...) gets one
playbook file at ``references/agent-templates/<key>.md`` in ``BUILD_AN_AGENT_SKILL``. The
playbook layers the use-case specifics onto the generic build loop; it never repeats the loop
or the config schema (those live in the skill body and ``references/config-schema.md``). The
canonical format is
``docs/design/agent-workflows/projects/agent-templates/playbook-spec.md``.

**One module per category, on purpose.** The playbooks split into six category modules
(``engineering``, ``support``, ``sales``, ``monitoring``, ``knowledge``, ``ops``), each
exporting an ``ENTRIES: list[TemplateEntry]``. Five WP2 authors can each fill one category's
module in parallel without touching the same file. To add a template: append a
``TemplateEntry`` to the right category module's ``ENTRIES`` (its ``body`` is the playbook
Markdown, 1-2 KB, following the exemplar). Nothing here needs editing: ``AGENT_TEMPLATE_ENTRIES``
and the generated ``index.md`` pick it up automatically, so the index can never drift from the
files that exist.
"""

from __future__ import annotations

from typing import List, NamedTuple

from ...skills import SkillFile


class TemplateEntry(NamedTuple):
    """One template playbook. ``key`` is the card key and the ``<key>.md`` filename; ``name``,
    ``category``, and ``match`` render the index row; ``body`` is the playbook Markdown."""

    key: str
    name: str
    category: str
    match: str
    body: str


# Category modules imported after TemplateEntry so each can `from . import TemplateEntry`.
from . import (  # noqa: E402 -- must follow TemplateEntry to avoid a circular import
    engineering,
    knowledge,
    monitoring,
    ops,
    sales,
    support,
)

# The bundled files land under this directory, beside SKILL.md, one playbook per entry.
_REFERENCE_DIR = "references/agent-templates"


def _validate_entries(entries: List[TemplateEntry]) -> None:
    """Guard the invariants the generated index and the drift test rely on: keys must be
    unique (they double as filenames and lookup keys), and ``name``/``match`` must not carry a
    ``|`` or a newline, since both render inside a Markdown table row."""
    seen_keys: set = set()
    for entry in entries:
        if entry.key in seen_keys:
            raise ValueError(f"duplicate TemplateEntry key: {entry.key!r}")
        seen_keys.add(entry.key)
        for field_name in ("name", "match"):
            value = getattr(entry, field_name)
            if "|" in value or "\n" in value:
                raise ValueError(
                    f"TemplateEntry {entry.key!r} field {field_name!r} contains a '|' or "
                    "newline, which breaks the generated Markdown table"
                )


# Ordered across categories; the index renders rows in this order. Each category's ENTRIES is
# owned by its module, so parallel authors never collide.
AGENT_TEMPLATE_ENTRIES: List[TemplateEntry] = [
    *engineering.ENTRIES,
    *support.ENTRIES,
    *sales.ENTRIES,
    *monitoring.ENTRIES,
    *knowledge.ENTRIES,
    *ops.ENTRIES,
]
_validate_entries(AGENT_TEMPLATE_ENTRIES)


def _render_index(entries: List[TemplateEntry]) -> str:
    """Render the match table from the entries, so the index can never drift from the files."""
    lines = [
        "# Agent template playbooks",
        "",
        "Match the user's ask to a row, then read the named playbook file for the full setup.",
        "",
        "| Template | Category | When it matches | Playbook file |",
        "|---|---|---|---|",
    ]
    for entry in entries:
        lines.append(
            f"| {entry.name} | {entry.category} | {entry.match} | "
            f"{_REFERENCE_DIR}/{entry.key}.md |"
        )
    lines.append("")
    lines.append("No match? Use the generic loop in SKILL.md.")
    return "\n".join(lines) + "\n"


def build_agent_template_skill_files() -> List[SkillFile]:
    """The SkillFiles to append to ``BUILD_AN_AGENT_SKILL.files``: the generated index plus one
    playbook per entry. The index is generated from the entries, so it lists exactly the files
    that exist."""
    files = [
        SkillFile(
            path=f"{_REFERENCE_DIR}/index.md",
            content=_render_index(AGENT_TEMPLATE_ENTRIES),
        )
    ]
    for entry in AGENT_TEMPLATE_ENTRIES:
        files.append(
            SkillFile(path=f"{_REFERENCE_DIR}/{entry.key}.md", content=entry.body)
        )
    return files
