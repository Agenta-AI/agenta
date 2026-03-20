from typing import Dict, List, Optional

from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.engines.running.handlers import chat_v0
from agenta.sdk.types import Message, PromptTemplate


# Create isolated chat app with its own OpenAPI schema
chat_app = ag.create_app()


class ChatConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are a helpful customer service chatbot. Please help the user with their query.\nUse the following context if available:\n<context>{{context}}</context>",
        )
    )


@ag.route("/", app=chat_app, flags={"is_chat": True})
async def chat(
    inputs: Optional[Dict[str, str]] = None,
    messages: Optional[List[Message]] = None,
    parameters: Optional[Dict] = None,
):
    if messages is None:
        messages = []

    config = ChatConfig(**(parameters or {}))

    return await chat_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
        messages=messages,
    )
