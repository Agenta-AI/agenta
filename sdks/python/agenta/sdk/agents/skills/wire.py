"""Serialization of resolved skills to the runner contract.

By the time the wire is built every entry is a concrete :class:`SkillTemplate` (references
resolved server-side via ``@ag.embed``), so there is one shape to emit: ``WireSkill`` (see
``services/runner/src/protocol.ts``).
"""

from __future__ import annotations

from typing import Any, Dict, Sequence

from .models import SkillTemplate


def skill_to_wire(skill: SkillTemplate) -> Dict[str, Any]:
    return skill.to_wire()


def skills_to_wire(skills: Sequence[SkillTemplate]) -> list[Dict[str, Any]]:
    return [skill_to_wire(skill) for skill in skills]
