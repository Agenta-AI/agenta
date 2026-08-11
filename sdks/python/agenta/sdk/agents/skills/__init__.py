"""Public skill configuration API.

A skill is one inline shape (:class:`SkillTemplate`); references to skills that live elsewhere
ride the existing ``@ag.embed`` mechanism and resolve into this same shape before the runner.
"""

from .errors import SkillValidationError, SkillError
from .models import SkillTemplate, SkillFile
from .parsing import parse_skill_template, parse_skill_templates
from .wire import skill_to_wire, skills_to_wire

__all__ = [
    "SkillTemplate",
    "SkillFile",
    "parse_skill_template",
    "parse_skill_templates",
    "skill_to_wire",
    "skills_to_wire",
    "SkillError",
    "SkillValidationError",
]
