from typing import Dict

import agenta as ag
import litellm
from agenta.sdk.litellm import mockllm
from agenta.sdk.types import PromptTemplate
from fastapi import HTTPException
from pydantic import BaseModel, Field

litellm.drop_params = True
mockllm.litellm = litellm

ag.init()
litellm.callbacks = [ag.callbacks.litellm_handler()]


class MyConfig(BaseModel):
    prompt: PromptTemplate = Field(
        default=PromptTemplate(
            system_prompt="You are an expert in geography",
            user_prompt="What is the capital of {{country}}?",
        )
    )


def _apply_responses_bridge_if_needed(
    formatted_prompt: PromptTemplate, provider_settings: Dict
) -> Dict:
    """
    Checks if web_search_preview tool is present and applies responses bridge if needed.

    If a web_search_preview tool is detected, this function modifies the provider_settings
    to use the responses bridge by prepending 'openai/responses/' to the model name.

    Args:
        formatted_prompt: The formatted prompt template containing LLM config and tools
        provider_settings: The provider settings dictionary that may be modified

    Returns:
        The provider_settings dictionary, potentially modified to use responses bridge
    """
    tools = formatted_prompt.llm_config.tools
    if tools:
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") in [
                "web_search_preview",
                "code_execution",
                "mcp",
            ]:
                model_val = provider_settings.get("model")
                if model_val and "/" not in model_val:
                    provider_settings["model"] = f"openai/responses/{model_val}"
    return provider_settings


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

    provider_settings = ag.SecretsManager.get_provider_settings(
        config.prompt.llm_config.model
    )

    if not provider_settings:
        raise HTTPException(
            status_code=424,
            detail=f"Credentials not found for model {config.prompt.llm_config.model}. Please configure them under settings.",
        )

    formatted_prompt = config.prompt.format(**inputs)

    provider_settings = _apply_responses_bridge_if_needed(
        formatted_prompt, provider_settings
    )

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v
                for k, v in formatted_prompt.to_openai_kwargs().items()
                if k != "model"
            },
            **provider_settings,
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
