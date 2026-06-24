"""The seeded default agent config's skill embed must reference at the ARTIFACT level.

A bare ``workflow_revision`` slug matches the revision's own hash slug, not the author-facing
artifact slug, so a no-version ``workflow_revision`` embed 500s when the resolver tries to load
it. The platform default skill (``agenta-getting-started``) must therefore be embedded as
``{"workflow": {"slug": ...}}`` ("use the latest revision of this artifact"). This guard locks
that shape so the live regression that 500'd the seeded skill cannot come back.
"""

from __future__ import annotations

from oss.src.agent.schemas import (
    _DEFAULT_AGENT_CONFIG,
    _DEFAULT_SKILL_SLUG,
)


def _default_skill_embed() -> dict:
    skills = _DEFAULT_AGENT_CONFIG["skills"]
    assert isinstance(skills, list) and len(skills) == 1, (
        "expected exactly one seeded default skill"
    )
    entry = skills[0]
    assert "@ag.embed" in entry, "the seeded skill must be an @ag.embed entry"
    return entry["@ag.embed"]


def test_default_skill_references_at_artifact_level():
    embed = _default_skill_embed()
    references = embed["@ag.references"]

    # Artifact-level reference ("use the latest revision"): a `workflow` key, NOT a bare
    # `workflow_revision` whose no-version slug matches the revision hash slug and 500s.
    assert "workflow" in references, (
        "the embed must reference the ARTIFACT (`workflow`), not a bare `workflow_revision`"
    )
    assert "workflow_revision" not in references, (
        "a bare `workflow_revision` slug (no version) is the shape that 500'd the seeded skill"
    )
    assert references["workflow"] == {"slug": _DEFAULT_SKILL_SLUG}


def test_default_skill_uses_parameters_skill_selector():
    embed = _default_skill_embed()
    # The resolver inlines the stored SkillConfig from this selector path before the runner sees it.
    assert embed["@ag.selector"] == {"path": "parameters.skill"}


def test_default_skill_slug_is_the_canonical_platform_default():
    # The seed references the platform default skill by its stable, author-facing slug.
    assert _DEFAULT_SKILL_SLUG == "agenta-getting-started"
