from typing import Dict

from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.workflows.handlers import completion_v0
from agenta.sdk.types import PromptTemplate


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
