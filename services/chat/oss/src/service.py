from typing import Dict, List, Optional

from pydantic import BaseModel, Field
from fastapi import HTTPException
import litellm

import agenta as ag

from agenta.sdk.litellm import mockllm
from agenta.sdk.types import PromptTemplate, Message


litellm.drop_params = True
mockllm.litellm = litellm

ag.init()
litellm.callbacks = [ag.callbacks.litellm_handler()]


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

    provider_settings = ag.SecretsManager.get_provider_settings(
        config.prompt.llm_config.model
    )

    if not provider_settings:
        raise HTTPException(
            status_code=424,
            detail=f"Credentials not found for model {config.prompt.llm_config.model}. Please configure them under settings.",
        )

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v for k, v in openai_kwargs.items() if k != "model"
            },  # we should use the model_name from provider_settings
            **provider_settings,
        )

    return response.choices[0].message.model_dump(exclude_none=True)
