"""Boundary normalisation of a fetched capability declaration
(`capabilities.md` §4). Applied identically to a first-party adapter's own
dict and to a bridge's `bridge.hello` payload — one function, one place this
logic exists.
"""

import copy
from typing import Any, Dict

from oss.src.core.channels.dtos import ChannelCapabilities

# Sane non-zero ceilings. A declared 0 is read as "unset", never as a real
# functional zero (buttons.max: 0 would mean "buttons never work").
_DEFAULT_BUTTONS_MAX = 25
_DEFAULT_TEXT_MAX_CHARS = 3000
_DEFAULT_FILE_MAX_BYTES = 1024 * 1024 * 1024  # 1 GiB

# Absurd-value ceilings. Declared values above these are clamped, not
# rejected — under-declaring degrades, over-declaring fails at send time.
_CEILING_BUTTONS_MAX = 100
_CEILING_TEXT_MAX_CHARS = 40000  # Slack's own total-message ceiling
_CEILING_FILE_MAX_BYTES = 10 * 1024 * 1024 * 1024  # 10 GiB


def _clamp_numeric(
    container: Dict[str, Any], field: str, *, default: int, ceiling: int
) -> None:
    """Zero -> default; anything above the ceiling -> ceiling. In place."""

    value = container.get(field)
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return

    if value <= 0:
        container[field] = default
    elif value > ceiling:
        container[field] = ceiling


def normalise_capabilities(raw: Dict[str, Any]) -> ChannelCapabilities:
    """The boundary normaliser (capabilities.md §4).

    - A declared maximum of zero becomes the field's default, never a
      functional zero.
    - Absurd values are clamped to a sane ceiling.
    - Unknown keys are dropped under a must-ignore rule — pydantic's own
      default `extra="ignore"` behaviour on every nested model handles this,
      so no explicit filtering step is needed here.
    - `identity.keys` passes through untouched: it is data the declaration
      commits to, never clamped, reordered, or defaulted away. An empty
      `"thread": []` is a meaningful declared value, not an absent one.

    Trust-bearing flags (anything core uses to decide what to attempt) are
    not stamped here — that is a decision for the caller that knows whether
    the source is a bridge (capabilities.md §4's "never read from the wire
    as-is"); this function only clamps and defaults shared numeric ceilings.
    """

    data = copy.deepcopy(raw) if isinstance(raw, dict) else {}

    rendering = data.get("rendering")
    if isinstance(rendering, dict):
        buttons = rendering.get("buttons")
        if isinstance(buttons, dict):
            _clamp_numeric(
                buttons,
                "max",
                default=_DEFAULT_BUTTONS_MAX,
                ceiling=_CEILING_BUTTONS_MAX,
            )

        text = rendering.get("text")
        if isinstance(text, dict):
            _clamp_numeric(
                text,
                "max_chars",
                default=_DEFAULT_TEXT_MAX_CHARS,
                ceiling=_CEILING_TEXT_MAX_CHARS,
            )

        files = rendering.get("files")
        if isinstance(files, dict):
            for direction in ("send", "receive"):
                block = files.get(direction)
                if isinstance(block, dict):
                    _clamp_numeric(
                        block,
                        "max_bytes",
                        default=_DEFAULT_FILE_MAX_BYTES,
                        ceiling=_CEILING_FILE_MAX_BYTES,
                    )

    return ChannelCapabilities.model_validate(data)
