"""Strict parsing of inline skill configuration.

Parses a raw ``skills`` list (entries are either :class:`SkillConfig` or plain dicts, the
latter being the post-embed-resolution shape) into validated :class:`SkillConfig` objects.

The actual rules — the name pattern, field bounds, and the safe-relative-file-path /
``SKILL.md`` checks — live on the Pydantic models (:mod:`.models`), so *every* construction path
(including a direct ``SkillConfig(...)``) enforces them. This module only adapts the model's
:class:`~pydantic.ValidationError` into a :class:`SkillConfigurationError` that carries the
offending list index.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from .errors import SkillConfigurationError
from .models import SkillConfig

# Embed markers the server-side resolver inlines before the runner. If one survives to here,
# resolution was skipped (e.g. `flags.resolve=False`), so we raise a clear, typed error rather
# than letting the strict model dump a confusing `extra="forbid"` ValidationError.
_AG_EMBED_MARKER = "@ag.embed"
_AG_SNIPPET_MARKER = "@{{"


def _unresolved_embed_message(value: Any) -> str | None:
    """Return an error message if ``value`` is still an unresolved embed, else ``None``."""
    if isinstance(value, Mapping) and _AG_EMBED_MARKER in value:
        return (
            "Skill entry is an unresolved @ag.embed reference. Embeds resolve server-side "
            "before parsing; this usually means resolution was opted out (flags.resolve=False) "
            "or no resolver ran. Resolve embeds first, or pass an inline skill package."
        )
    if isinstance(value, str) and (
        _AG_EMBED_MARKER in value or _AG_SNIPPET_MARKER in value
    ):
        return (
            "Skill entry contains an unresolved embed token. Embeds resolve server-side before "
            "parsing; this usually means resolution was opted out (flags.resolve=False) or no "
            "resolver ran. Resolve embeds first, or pass an inline skill package."
        )
    return None


def parse_skill_config(value: SkillConfig | Mapping[str, Any]) -> SkillConfig:
    message = _unresolved_embed_message(value)
    if message is not None:
        raise SkillConfigurationError(message, value=value)
    try:
        return SkillConfig.model_validate(value)
    except ValidationError as exc:
        raise SkillConfigurationError(
            "Invalid skill configuration: "
            f"{exc.errors(include_url=False, include_input=False)}",
            value=value,
        ) from exc


def parse_skill_configs(
    values: Sequence[SkillConfig | Mapping[str, Any]],
) -> list[SkillConfig]:
    parsed: list[SkillConfig] = []
    for index, value in enumerate(values):
        try:
            parsed.append(parse_skill_config(value))
        except SkillConfigurationError as exc:
            raise SkillConfigurationError(
                str(exc),
                index=index,
                value=value,
            ) from exc
    return parsed
