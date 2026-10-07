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
    # Marks the turn-start indicator, so an adapter and the delivery guard
    # identify it by this flag rather than by its display text. A real answer
    # whose text happens to equal the indicator text must not be mistaken for
    # the indicator.
    indicator: Optional[bool] = None


class RenderChoiceOption(BaseModel):
    """One option behind a rendered choice, regardless of whether it landed
    as buttons or as numbered text -- the outbox reads this to persist the
    thread's pending choice, never the rendered parts themselves."""

    label: str
    token: str


class RenderItem(BaseModel):
    """One outbox row's worth of content — independently postable and editable."""

    parts: List[RenderPart]
    # set only when this item IS a choice -- present whether it rendered as
    # buttons or degraded to numbered text, since the outbox must persist the
    # same pending choice either way.
    choice: Optional[List[RenderChoiceOption]] = None
    # set when the choice is an approval card for a parked session
    # interaction; the outbox stores it with the pending choice
    interaction_id: Optional[str] = None
