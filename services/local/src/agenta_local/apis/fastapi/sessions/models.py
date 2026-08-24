"""Session/turn route models."""

from typing import Any

from pydantic import BaseModel


class SessionCreate(BaseModel):
    agent_revision_id: str
    title: str | None = None


class TextPart(BaseModel):
    type: str
    text: str


class TurnInput(BaseModel):
    content: list[TextPart]


class TurnContext(BaseModel):
    client_turn_id: str | None = None


class TurnRequest(BaseModel):
    input: TurnInput
    context: TurnContext = TurnContext()


def first_text(payload: TurnInput) -> str:
    for part in payload.content:
        if part.type == "text":
            return part.text
    raise ValueError("input.content must include one text part")


def message_dict(message) -> dict[str, Any]:
    return message.model_dump(mode="json")
