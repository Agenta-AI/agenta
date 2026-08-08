from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class RenderPart(BaseModel):
    """The fixed outbound vocabulary: core's answer to "what to say", never a
    platform call. An adapter maps one part to its own wire shape; it never
    receives an ACP or record payload.

    One part per button, so a grouped multi-option part is never used.
    """

    type: Literal["text", "button", "card"]
    #
    text: Optional[str] = None
    format: Optional[Literal["markdown", "plain", "html"]] = None
    #
    id: Optional[str] = None
    label: Optional[str] = None
    value: Optional[str] = None
    #
    title: Optional[str] = None
    tool: Optional[str] = None
    arguments: Optional[Dict[str, Any]] = None


class RenderItem(BaseModel):
    """One outbox row's worth of content — independently postable and editable."""

    parts: List[RenderPart]
