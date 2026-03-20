from typing import Dict, Optional

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
    parameters: Optional[Dict] = None,
):
    config = CompletionConfig(**(parameters or {}))

    return await completion_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
    )
