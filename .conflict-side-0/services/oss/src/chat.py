from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.engines.running.handlers import chat_v0
from agenta.sdk.types import Messages, PromptTemplate


class ChatConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are a helpful customer service chatbot. Please help the user with their query.\nUse the following context if available:\n<context>{{context}}</context>",
        )
    )


async def _chat(
    inputs: Dict[str, Any],
    messages: Optional[Messages] = None,
    parameters: Optional[Dict] = None,
):
    if messages is None:
        messages = Messages()

    config = ChatConfig(**(parameters or {}))

    return await chat_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
        messages=messages,
    )


def create_chat_app():
    app = ag.create_app()
    routed = ag.workflow(uri="agenta:builtin:chat:v0")(_chat)
    ag.route("/", app=app, flags={"is_chat": True})(routed)
    return app


chat_v0_app = create_chat_app()
