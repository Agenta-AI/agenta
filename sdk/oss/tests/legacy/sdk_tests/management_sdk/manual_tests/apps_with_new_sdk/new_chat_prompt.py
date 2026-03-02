from typing import Annotated

import agenta as ag
import litellm
from agenta.sdk.assets import supported_llm_models
from pydantic import BaseModel, Field

litellm.drop_params = True


prompts = {
    "system_prompt": "You are an expert in geography.",
    "user_prompt": """What is the capital of {country}?""",
}

GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]


ag.init(config_fname="config.toml")


class MyConfig(BaseModel):
    temperature: float = Field(default=1, ge=0.0, le=2.0)
    model: Annotated[str, ag.MultipleChoice(choices=supported_llm_models)] = Field(
        default="gpt-3.5-turbo"
    )
    max_tokens: int = Field(default=-1, ge=-1, le=4000)
    prompt_system: str = Field(default=prompts["system_prompt"])
    prompt_user: str = Field(default=prompts["user_prompt"])
    top_p: float = Field(default=1)
    frequence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    force_json: bool = Field(default=False)


@ag.instrument(spankind="llm")
async def llm_call(prompt_system: str, prompt_user: str):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    response_format = (
        {"type": "json_object"}
        if config.force_json and config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )

    max_tokens = config.max_tokens if config.max_tokens != -1 else None

    # Include frequency_penalty and presence_penalty only if supported
    completion_params = {}
    if config.model in GPT_FORMAT_RESPONSE:
        completion_params["frequency_penalty"] = config.frequence_penalty
        completion_params["presence_penalty"] = config.presence_penalty

    response = await litellm.acompletion(
        **{
            "model": config.model,
            "messages": [
                {"content": prompt_system, "role": "system"},
                {"content": prompt_user, "role": "user"},
            ],
            "temperature": config.temperature,
            "max_tokens": max_tokens,
            "top_p": config.top_p,
            "response_format": response_format,
            **completion_params,
        }
    )
    token_usage = response.usage.dict()
    return {
        "message": response.choices[0].message.content,
        "usage": token_usage,
        "cost": litellm.cost_calculator.completion_cost(
            completion_response=response, model=config.model
        ),
    }


@ag.route("/", config_schema=MyConfig)
@ag.instrument()
async def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["country"]),
):
    config = ag.ConfigManager.get_from_route(schema=MyConfig)
    try:
        prompt_user = config.prompt_user.format(**inputs)
    except Exception:
        prompt_user = config.prompt_user
    try:
        prompt_system = config.prompt_system.format(**inputs)
    except Exception:
        prompt_system = config.prompt_system

    # SET MAX TOKENS - via completion()
    if config.force_json and config.model not in GPT_FORMAT_RESPONSE:
        raise ValueError(
            "Model {} does not support JSON response format".format(config.model)
        )

    response = await llm_call(prompt_system=prompt_system, prompt_user=prompt_user)
    return {
        "message": response["message"],
        "usage": response.get("usage", None),
        "cost": response.get("cost", None),
    }
