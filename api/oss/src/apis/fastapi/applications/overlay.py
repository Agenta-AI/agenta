"""Read-only overlays attached to application inspect/fetch responses."""

from typing import Any, Dict

from oss.src.core.workflows import build_kit as _build_kit

DEFAULT_BUILD_KIT_OPS = _build_kit.DEFAULT_BUILD_KIT_OPS


def build_agent_template_overlay() -> Dict[str, Any]:
    """Build the playground-only agent-template overlay from platform-owned sources."""
    return _build_kit.build_agent_template_overlay()
