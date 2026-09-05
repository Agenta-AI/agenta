"""Strict parsing of inline skill configuration.

Parses a raw ``skills`` list (entries are either :class:`SkillTemplate` or plain dicts, the
latter being the post-embed-resolution shape) into validated :class:`SkillTemplate` objects.

The actual rules — the name pattern, field bounds, and the safe-relative-file-path /
``SKILL.md`` checks — live on the Pydantic models (:mod:`.models`), so *every* construction path
(including a direct ``SkillTemplate(...)``) enforces them. This module only adapts the model's
:class:`~pydantic.ValidationError` into a :class:`SkillValidationError` that carries the
offending list index.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from pydantic import ValidationError

from agenta.sdk.utils.embeds import OBJECT_KEY, has_embed_markers

from .errors import SkillValidationError
from .models import SkillTemplate


def _unresolved_embed_message(value: Any) -> str | None:
    """Return an error message if ``value`` still contains an unresolved embed, else ``None``."""
    if not has_embed_markers(value):
        return None
    if isinstance(value, Mapping) and OBJECT_KEY in value:
        return (
            "Skill entry is an unresolved @ag.embed reference. Embeds resolve server-side "
            "before parsing; this usually means resolution was opted out (flags.resolve=False) "
            "or no resolver ran. Resolve embeds first, or pass an inline skill package."
        )
    return (
        "Skill entry contains an unresolved embed token. Embeds resolve server-side before "
        "parsing; this usually means resolution was opted out (flags.resolve=False) or no "
        "resolver ran. Resolve embeds first, or pass an inline skill package."
    )


def parse_skill_template(value: SkillTemplate | Mapping[str, Any]) -> SkillTemplate:
    message = _unresolved_embed_message(value)
    if message is not None:
        raise SkillValidationError(message, value=value)
    try:
        return SkillTemplate.model_validate(value)
    except ValidationError as exc:
        raise SkillValidationError(
            "Invalid skill configuration: "
            f"{exc.errors(include_url=False, include_input=False)}",
            value=value,
        ) from exc


def parse_skill_templates(
    values: Sequence[SkillTemplate | Mapping[str, Any]],
) -> list[SkillTemplate]:
    parsed: list[SkillTemplate] = []
    for index, value in enumerate(values):
        try:
            parsed.append(parse_skill_template(value))
        except SkillValidationError as exc:
            raise SkillValidationError(
                str(exc),
                index=index,
                value=value,
            ) from exc
    return parsed
