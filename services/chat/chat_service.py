from typing import Dict, List, Optional, Union

from pydantic import BaseModel, Field
from fastapi import HTTPException
import litellm

import agenta as ag

from agenta.sdk.types import PromptTemplate, Message
from agenta.sdk.litellm import mockllm


litellm.drop_params = True
litellm.callbacks = [ag.callbacks.litellm_handler()]

mockllm.litellm = litellm

ag.init()


class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are a helpful customer service chatbot. Please help the user with their query.\nUse the following context if available:\n<context>{{context}}</context>",
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

    api_key = ag.SecretsManager.get_api_key_for_model(config.prompt.llm_config.model)

    if not api_key:
        raise ValueError(
            f"API key not found for model {config.prompt.llm_config.model}"
        )

    response = await mockllm.acompletion(
        **{
            "api_key": api_key,
            **openai_kwargs,
        }
    )

    return response.choices[0].message.model_dump(exclude_none=True)
