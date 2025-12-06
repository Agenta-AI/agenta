from typing import Dict, List, Optional

import agenta as ag
import litellm
from agenta.sdk.litellm import mockllm
from agenta.sdk.types import Message, PromptTemplate
from fastapi import HTTPException
from pydantic import BaseModel, Field

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

    provider_settings = ag.SecretsManager.get_provider_settings(
        config.prompt.llm_config.model
    )

    if not provider_settings:
        raise HTTPException(
            status_code=424,
            detail=f"Credentials not found for model {config.prompt.llm_config.model}. Please configure them under settings.",
        )

    provider_settings = _apply_responses_bridge_if_needed(
        formatted_prompt, provider_settings
    )

    openai_kwargs = formatted_prompt.to_openai_kwargs()
    if messages is not None:
        openai_kwargs["messages"].extend(messages)

    with mockllm.user_aws_credentials_from(provider_settings):
        response = await mockllm.acompletion(
            **{
                k: v for k, v in openai_kwargs.items() if k != "model"
            },  # we should use the model_name from provider_settings
            **provider_settings,
        )

    return response.choices[0].message.model_dump(exclude_none=True)
