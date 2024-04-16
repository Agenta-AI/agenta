import agenta as ag
import litellm

ag.init()

prompts = {
    "system_prompt": "You are an expert in geography.",
    "user_prompt": """What is the capital of {country}?""",
}

# ChatGPT 3.5 models
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k-0613",
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-1106",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo",
    "gpt-4",
    "gpt-4-1106-preview",
]
GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]
ag.config.default(
    temperature=ag.FloatParam(default=1, minval=0.0, maxval=2.0),
    model=ag.MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(prompts["system_prompt"]),
    prompt_user=ag.TextParam(prompts["user_prompt"]),
    top_p=ag.FloatParam(1),
    frequence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    presence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    force_json=ag.BinaryParam(False),
)


@ag.span(type="llm_request")
async def litellm_call(prompt_system: str, prompt_user: str):
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    if ag.config.force_json and ag.config.model not in GPT_FORMAT_RESPONSE:
        raise ValueError(
            "Model {} does not support JSON response format".format(ag.config.model)
        )
    response_format = (
        {"type": "json_object"}
        if ag.config.force_json and ag.config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )
    response = await litellm.acompletion(
        model=ag.config.model,
        messages=[
            {"content": prompt_system, "role": "system"},
            {"content": prompt_user, "role": "user"},
        ],
        temperature=ag.config.temperature,
        max_tokens=max_tokens,
        top_p=ag.config.top_p,
        frequency_penalty=ag.config.frequence_penalty,
        presence_penalty=ag.config.presence_penalty,
        response_format=response_format,
    )

    tokens_usage = response.usage.dict()
    return {
        "cost": ag.calculate_token_usage(ag.config.model, tokens_usage),
        "message": response.choices[0].message.content,
        "usage": tokens_usage,
    }


@ag.entrypoint
async def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["country"]),
):
    try:
        prompt_user = ag.config.prompt_user.format(**inputs)
    except Exception as e:
        prompt_user = ag.config.prompt_user
    try:
        prompt_system = ag.config.prompt_system.format(**inputs)
    except Exception as e:
        prompt_system = ag.config.prompt_system

    llm_response = await litellm_call(
        prompt_system=prompt_system, prompt_user=prompt_user
    )
    return {
        "message": llm_response["message"],
        "usage": llm_response["usage"],
        "cost": llm_response["cost"],
    }
