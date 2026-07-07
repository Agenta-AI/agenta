"""Errors raised while parsing skill configuration."""

from __future__ import annotations

from typing import Any, Optional


class SkillError(RuntimeError):
    """Base error for the agent skills subsystem."""


class SkillValidationError(SkillError):
    def __init__(
        self,
        message: str,
        *,
        index: Optional[int] = None,
        value: Any = None,
    ) -> None:
        super().__init__(message)
        self.index = index
        self.value = value
