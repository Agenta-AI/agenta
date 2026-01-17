from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from fastapi import FastAPI

import agenta as ag
from agenta.sdk.workflows.handlers import chat_v0, completion_v0
from agenta.sdk.types import Message, PromptTemplate


ag.init()

# Create main app that will mount sub-applications
app = FastAPI()

# Create isolated chat app with its own OpenAPI schema
chat_app, chat_route = ag.create_app("/chat")


class ChatConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are a helpful customer service chatbot. Please help the user with their query.\nUse the following context if available:\n<context>{{context}}</context>",
        )
    )


@chat_route("/", config_schema=ChatConfig)
async def chat(
    inputs: Optional[Dict[str, str]] = None,
    messages: List[Message] = [],
):
    config = ag.ConfigManager.get_from_route(schema=ChatConfig)

    return await chat_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
        messages=messages,
    )


# Create isolated completion app with its own OpenAPI schema
completion_app, completion_route = ag.create_app("/completion")


class CompletionConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


@completion_route("/", config_schema=CompletionConfig)
async def completion(
    inputs: Dict[str, str],
):
    config = ag.ConfigManager.get_from_route(schema=CompletionConfig)

    return await completion_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
    )


# Mount both apps under their respective paths
app.mount("/chat", chat_app)
app.mount("/completion", completion_app)


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    from uvicorn import run

    run(
        "entrypoints.main:app",
        host="0.0.0.0",
        port=80,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
