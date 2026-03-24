from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

import agenta as ag
from agenta.sdk.engines.running.handlers import completion_v0
from agenta.sdk.types import PromptTemplate


class CompletionConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


async def _completion(
    inputs: Dict[str, Any],
    parameters: Optional[Dict] = None,
):
    config = CompletionConfig(**(parameters or {}))

    return await completion_v0(
        parameters=config.model_dump(mode="json", exclude_none=True),
        inputs=inputs,
    )


def create_completion_app():
    app = ag.create_app()
    routed = ag.workflow(uri="agenta:builtin:completion:v0")(_completion)
    ag.route("/", app=app)(routed)
    return app


completion_app = create_completion_app()
completion_v0_app = create_completion_app()
