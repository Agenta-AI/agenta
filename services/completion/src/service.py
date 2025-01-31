from typing import Dict

from pydantic import BaseModel, Field
from fastapi import HTTPException
import litellm

import agenta as ag

from agenta.sdk.types import PromptTemplate
from agenta.sdk.litellm import mockllm


litellm.drop_params = True
litellm.callbacks = [ag.callbacks.litellm_handler()]

mockllm.litellm = litellm

ag.init()


class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    inputs: Dict[str, str],
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

    api_key = ag.SecretsManager.get_api_key_for_model(config.prompt.llm_config.model)

    if not api_key:
        raise HTTPException(
            status_code=424,
            detail=f"API key not found for model {config.prompt.llm_config.model}",
        )

    response = await mockllm.acompletion(
        **{
            "api_key": api_key,
            **config.prompt.format(**inputs).to_openai_kwargs(),
        }
    )

    message = response.choices[0].message

    if message.content is not None:
        return message.content
    if hasattr(message, "refusal") and message.refusal is not None:
        return message.refusal
    if hasattr(message, "parsed") and message.parsed is not None:
        return message.parsed
    if hasattr(message, "tool_calls") and message.tool_calls is not None:
        return [tool_call.dict() for tool_call in message.tool_calls]
