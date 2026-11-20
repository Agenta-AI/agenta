"""Errors raised while parsing skill configuration."""

from __future__ import annotations

from ..config_errors import ConfigEntryError


class SkillError(RuntimeError):
    """Base error for the agent skills subsystem."""


class SkillValidationError(SkillError, ConfigEntryError):
    """A ``skills`` entry the runtime cannot parse."""
