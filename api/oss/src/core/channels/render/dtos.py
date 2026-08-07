from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel


class RenderPart(BaseModel):
    """The fixed outbound vocabulary (specs-wp5.md 'Out of scope'): core's

    answer to "what to say", never a platform call. An adapter (WP6) maps one
    part to its own wire shape; it never receives an ACP or record payload.

    One part per button (matching the contract suite's `post_message`
    fixture, `tests/.../channels/contract/fakes.py`, which counts
    `item.get("type") == "button"` across the whole `content` list) — a
    grouped multi-option part would not be visible to that count.
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
