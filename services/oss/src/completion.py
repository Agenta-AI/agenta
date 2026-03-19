from typing import Dict

from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.engines.running.handlers import completion_v0
from agenta.sdk.types import PromptTemplate


# Create isolated completion app with its own OpenAPI schema
completion_app = ag.create_app()


class CompletionConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


@ag.route("/", app=completion_app)
async def completion(
    inputs: Dict[str, str],
):
    config = ag.ConfigManager.get_from_route(schema=CompletionConfig)

    return await completion_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
    )
