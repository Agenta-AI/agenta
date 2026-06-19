"""Typed errors for the agent runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .dtos import HarnessType
from .tools.errors import ToolResolutionError

__all__ = ["UnsupportedHarnessError", "ToolResolutionError"]

if TYPE_CHECKING:
    from .interfaces import Backend


class UnsupportedHarnessError(RuntimeError):
    """Raised when a harness is asked to run on a backend that cannot drive it."""

    def __init__(self, harness: HarnessType, backend: "Backend") -> None:
        supported = ", ".join(sorted(h.value for h in backend.supported_harnesses))
        super().__init__(
            f"{type(backend).__name__} cannot drive harness '{harness.value}'; "
            f"it supports: {supported or '(none)'}"
        )
        self.harness = harness
        self.backend = backend
