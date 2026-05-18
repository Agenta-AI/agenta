"""Structured rendering helpers for prompt messages and JSON-like objects.

This module sits one layer above ``render_template``. It knows which fields in
prompt messages and response-format structures may contain templates. It does
not know how handlers call providers or parse model responses.
"""

from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING, Any, Mapping, Optional, Sequence, Union

from pydantic import BaseModel

from agenta.sdk.utils.templating import TemplateMode, render_template

if TYPE_CHECKING:
    from agenta.sdk.utils.types import Message


MessageInput = Union["Message", Mapping[str, Any]]


class StructuredRenderingError(ValueError):
    """Raised when structured message or JSON-like rendering fails.

    ``location`` is a logical data location, not a filesystem path. It points to
    the field that failed to render, such as ``messages[0].content`` or
    ``json_schema.schema.properties.score.description``. Callers use this to
    wrap errors with service-specific exception types while keeping failures
    easy to debug and assert in tests.
    """

    def __init__(
        self,
        *,
        location: str,
        message: str,
        error: Optional[BaseException] = None,
        template: Optional[str] = None,
    ) -> None:
        self.location = location
        self.message = message
        self.error = error
        self.template = template
        super().__init__(f"{location}: {message}")


def _render_string(
    *,
    template: str,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str,
) -> str:
    """Render one string and attach its logical location to any failure."""

    try:
        return render_template(template=template, mode=mode, context=context)
    except Exception as exc:
        raise StructuredRenderingError(
            location=location,
            message=str(exc),
            error=exc,
            template=template,
        ) from exc


def _part_type(part: Any) -> Optional[str]:
    if isinstance(part, Mapping):
        part_type = part.get("type")
        return part_type if isinstance(part_type, str) else None
    return getattr(part, "type", None)


def _part_text(part: Any) -> Any:
    if isinstance(part, Mapping):
        return part.get("text")
    return getattr(part, "text", None)


def _copy_part_with_text(part: Any, text: str) -> Any:
    """Return a copy of a text content part with rendered text.

    Content parts may arrive as plain dicts or Pydantic models. Preserve the
    original shape so callers do not need to normalize messages before passing
    them to the provider.
    """

    if isinstance(part, Mapping):
        new_part = deepcopy(dict(part))
        new_part["text"] = text
        return new_part
    if isinstance(part, BaseModel):
        return part.model_copy(update={"text": text}, deep=True)
    new_part = deepcopy(part)
    setattr(new_part, "text", text)
    return new_part


def _is_message_model(message: Any) -> bool:
    """Detect Agenta-style message models without importing ``Message``.

    ``types.py`` imports this module at runtime. Importing ``Message`` here would
    create a circular import, so we validate the small structural contract this
    renderer needs instead.
    """

    return (
        isinstance(message, BaseModel)
        and hasattr(message, "model_copy")
        and hasattr(message, "role")
        and hasattr(message, "content")
    )


def _render_content_part(
    *,
    template: Any,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str,
) -> Any:
    part_type = _part_type(template)

    if part_type is None:
        raise StructuredRenderingError(
            location=location,
            message="content part must include a string 'type' field",
        )

    if part_type == "text":
        text = _part_text(template)
        if not isinstance(text, str):
            raise StructuredRenderingError(
                location=location,
                message="text content part must include a string 'text' field",
            )
        rendered_text = _render_string(
            template=text,
            mode=mode,
            context=context,
            location=f"{location}.text",
        )
        return _copy_part_with_text(template, rendered_text)

    if part_type in {"image_url", "input_audio", "file", "refusal"}:
        # Non-text parts are provider payloads, not templates. Rendering nested
        # strings inside them could corrupt image URLs, audio, file IDs, base64
        # data, or provider-authored refusal payloads.
        return deepcopy(template)

    raise StructuredRenderingError(
        location=location,
        message=f"unsupported content part type: {part_type}",
    )


def _render_message_content(
    *,
    template: Any,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str,
) -> Any:
    if template is None:
        return None

    if isinstance(template, str):
        return _render_string(
            template=template,
            mode=mode,
            context=context,
            location=location,
        )

    if isinstance(template, list):
        return [
            _render_content_part(
                template=part,
                mode=mode,
                context=context,
                location=f"{location}[{part_index}]",
            )
            for part_index, part in enumerate(template)
        ]

    raise StructuredRenderingError(
        location=location,
        message="content must be None, a string, or a list of known content parts",
    )


def _render_message(
    *,
    template: MessageInput,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str,
) -> MessageInput:
    if _is_message_model(template):
        role = getattr(template, "role", None)
        if not isinstance(role, str):
            raise StructuredRenderingError(
                location=f"{location}.role",
                message="message role must be a string",
            )
        rendered_content = _render_message_content(
            template=template.content,
            mode=mode,
            context=context,
            location=f"{location}.content",
        )
        return template.model_copy(update={"content": rendered_content}, deep=True)

    if not isinstance(template, Mapping):
        raise StructuredRenderingError(
            location=location,
            message="message must be an Agenta Message object or mapping",
        )

    role = template.get("role")
    if not isinstance(role, str):
        raise StructuredRenderingError(
            location=f"{location}.role",
            message="message role must be a string",
        )

    rendered = deepcopy(dict(template))
    rendered["content"] = _render_message_content(
        template=template.get("content"),
        mode=mode,
        context=context,
        location=f"{location}.content",
    )
    return rendered


def render_messages(
    *,
    messages: Sequence[MessageInput],
    mode: TemplateMode,
    context: Mapping[str, Any],
) -> list[MessageInput]:
    """Render text-bearing fields inside prompt messages.

    Supports Agenta ``Message`` objects and dict-like messages. String content
    and text content parts are rendered. Known non-text parts are preserved so
    provider payloads such as images, audio, files, and refusals are not mutated.
    """

    if isinstance(messages, (str, bytes, Mapping)):
        raise StructuredRenderingError(
            location="messages",
            message="messages must be a sequence of Message objects or mappings",
        )
    try:
        message_list = list(messages)
    except TypeError as exc:
        raise StructuredRenderingError(
            location="messages",
            message="messages must be a sequence of Message objects or mappings",
        ) from exc

    return [
        _render_message(
            template=message,
            mode=mode,
            context=context,
            location=f"messages[{message_index}]",
        )
        for message_index, message in enumerate(message_list)
    ]


def render_json_like(
    *,
    json_like: Any,
    mode: TemplateMode,
    context: Mapping[str, Any],
    location: str = "value",
    render_keys: bool = True,
) -> Any:
    """Recursively render strings in a JSON-like structure.

    This is used for response-format objects such as chat/completion
    ``response_format`` and judge ``json_schema``. It renders string values.
    When ``render_keys`` is true, it also renders string keys in mappings. It
    does not validate JSON Schema correctness.
    """

    if isinstance(json_like, str):
        return _render_string(
            template=json_like,
            mode=mode,
            context=context,
            location=location,
        )

    if isinstance(json_like, list):
        return [
            render_json_like(
                json_like=item,
                mode=mode,
                context=context,
                location=f"{location}[{index}]",
                render_keys=render_keys,
            )
            for index, item in enumerate(json_like)
        ]

    if isinstance(json_like, Mapping):
        rendered: dict[Any, Any] = {}
        for key, item in json_like.items():
            rendered_key = key
            if render_keys and isinstance(key, str):
                rendered_key = _render_string(
                    template=key,
                    mode=mode,
                    context=context,
                    location=f"{location}.<key:{key}>",
                )
            if rendered_key in rendered:
                raise StructuredRenderingError(
                    location=f"{location}.<key:{key}>",
                    message=f"rendered key collision for {rendered_key!r}",
                )
            rendered[rendered_key] = render_json_like(
                json_like=item,
                mode=mode,
                context=context,
                location=f"{location}.{rendered_key}",
                render_keys=render_keys,
            )
        return rendered

    return deepcopy(json_like)
