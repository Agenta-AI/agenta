import agenta as ag
import litellm
from agenta.sdk.assets import supported_llm_models

litellm.drop_params = True


prompts = {
    "system_prompt": "You are an expert in geography.",
    "user_prompt": """What is the capital of {country}?""",
}

GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]


ag.init()
ag.config.default(
    temperature=ag.FloatParam(default=1, minval=0.0, maxval=2.0),
    model=ag.GroupedMultipleChoiceParam(
        default="gpt-3.5-turbo", choices=supported_llm_models
    ),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(prompts["system_prompt"]),
    prompt_user=ag.TextParam(prompts["user_prompt"]),
    top_p=ag.FloatParam(1),
    frequence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    presence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    force_json=ag.BinaryParam(False),
)


@ag.instrument(spankind="llm")
async def llm_call(prompt_system: str, prompt_user: str):
    response_format = (
        {"type": "json_object"}
        if ag.config.force_json and ag.config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None

    # Include frequency_penalty and presence_penalty only if supported
    completion_params = {}
    if ag.config.model in GPT_FORMAT_RESPONSE:
        completion_params["frequency_penalty"] = ag.config.frequence_penalty
        completion_params["presence_penalty"] = ag.config.presence_penalty

    response = await litellm.acompletion(
        **{
            "model": ag.config.model,
            "messages": [
                {"content": prompt_system, "role": "system"},
                {"content": prompt_user, "role": "user"},
            ],
            "temperature": ag.config.temperature,
            "max_tokens": max_tokens,
            "top_p": ag.config.top_p,
            "response_format": response_format,
            **completion_params,
        }
    )
    token_usage = response.usage.dict()
    return {
        "message": response.choices[0].message.content,
        "usage": token_usage,
        "cost": litellm.cost_calculator.completion_cost(
            completion_response=response, model=ag.config.model
        ),
    }


@ag.entrypoint
@ag.instrument()
async def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["country"]),
):
    try:
        prompt_user = ag.config.prompt_user.format(**inputs)
    except Exception:
        prompt_user = ag.config.prompt_user
    try:
        prompt_system = ag.config.prompt_system.format(**inputs)
    except Exception:
        prompt_system = ag.config.prompt_system

    # SET MAX TOKENS - via completion()
    if ag.config.force_json and ag.config.model not in GPT_FORMAT_RESPONSE:
        raise ValueError(
            "Model {} does not support JSON response format".format(ag.config.model)
        )

    response = await llm_call(prompt_system=prompt_system, prompt_user=prompt_user)
    return {
        "message": response["message"],
        "usage": response.get("usage", None),
        "cost": response.get("cost", None),
    }
