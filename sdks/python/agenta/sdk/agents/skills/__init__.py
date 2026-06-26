"""Public skill configuration API.

A skill is one inline shape (:class:`SkillConfig`); references to skills that live elsewhere
ride the existing ``@ag.embed`` mechanism and resolve into this same shape before the runner.
"""

from .errors import SkillConfigurationError, SkillError
from .models import SkillConfig, SkillFile
from .parsing import parse_skill_config, parse_skill_configs
from .wire import skill_to_wire, skills_to_wire

__all__ = [
    "SkillConfig",
    "SkillFile",
    "parse_skill_config",
    "parse_skill_configs",
    "skill_to_wire",
    "skills_to_wire",
    "SkillError",
    "SkillConfigurationError",
]
