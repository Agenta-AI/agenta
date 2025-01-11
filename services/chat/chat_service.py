from typing import Dict, List, Optional
from fastapi import HTTPException

import agenta as ag
import litellm
from agenta.sdk.types import PromptTemplate, Message
from pydantic import BaseModel, Field

litellm.drop_params = True
litellm.callbacks = [ag.callbacks.litellm_handler()]

ag.init()


class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {country}?",
        )
    )


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    messages: List[Message],
    inputs: Optional[Dict[str, str]] = None,
):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    if config.prompt.input_keys is not None:
        required_keys = set(config.prompt.input_keys)
        provided_keys = set(inputs.keys())

        if required_keys != provided_keys:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid inputs. Expected: {sorted(required_keys)}, got: {sorted(provided_keys)}",
            )

    if inputs is not None:
        formatted_prompt = config.prompt.format(**inputs)
    else:
        formatted_prompt = config.prompt
    openai_kwargs = formatted_prompt.to_openai_kwargs()

    if messages is not None:
        openai_kwargs["messages"].extend(messages)

    response = await litellm.acompletion(**openai_kwargs)

    return response.choices[0].message
