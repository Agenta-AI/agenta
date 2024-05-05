import agenta as ag
import litellm

litellm.drop_params = True

ag.init()

prompts = {
    "system_prompt": "You are an expert in finding the best activity for people having free time. Activities should not necessary fun activities. Be creative!",
    "user_prompt": """What can I do today knowing that I live in {country},
I am {marital_status} and I have {duration} free time?
I am not interested in activities like: {not_desired_activities}
    """,
}

provider_models = {
    "Mistral AI": [
        "mistral/mistral-tiny",
        "mistral/mistral-small",
        "mistral/mistral-medium",
        "mistral/mistral-large-latest",
    ],
    "Open AI": [
        "gpt-3.5-turbo-16k-0613",
        "gpt-3.5-turbo-16k",
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo-0613",
        "gpt-3.5-turbo-0301",
        "gpt-3.5-turbo",
        "gpt-4",
        "gpt-4-1106-preview",
    ],
    "Cohere": [
        "command-nightly",
    ],
}

GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]

ag.config.default(
    temperature=ag.FloatParam(default=1, minval=0.0, maxval=2.0),
    model=ag.GroupedMultipleChoiceParam(
        default="gpt-3.5-turbo", choices=provider_models
    ),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(prompts["system_prompt"]),
    prompt_user=ag.TextParam(prompts["user_prompt"]),
    top_p=ag.FloatParam(1),
    frequence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    presence_penalty=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    force_json=ag.BinaryParam(False),
)


@ag.entrypoint
async def generate(
    inputs: ag.DictInput = ag.DictInput(
        default_keys=["country", "marital_status", "duration", "not_desired_activities"]
    ),
):
    try:
        prompt_user = ag.config.prompt_user.format(**inputs)
    except Exception as e:
        prompt_user = ag.config.prompt_user
    try:
        prompt_system = ag.config.prompt_system.format(**inputs)
    except Exception as e:
        prompt_system = ag.config.prompt_system

    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None

    if ag.config.force_json and ag.config.model not in GPT_FORMAT_RESPONSE:
        raise ValueError(
            "Model {} does not support JSON response format".format(ag.config.model)
        )

    print("model: ", ag.config.model)
    response_format = (
        {"type": "json_object"}
        if ag.config.force_json and ag.config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )

    completion_params = {
        "model": ag.config.model,
        "messages": [
            {"content": prompt_system, "role": "system"},
            {"content": prompt_user, "role": "user"},
        ],
        "temperature": ag.config.temperature,
        "max_tokens": max_tokens,
        "top_p": ag.config.top_p,
        "response_format": response_format,
    }

    # Include frequency_penalty and presence_penalty only if supported
    if ag.config.model in GPT_FORMAT_RESPONSE:
        completion_params["frequency_penalty"] = ag.config.frequence_penalty
        completion_params["presence_penalty"] = ag.config.presence_penalty

    response = await litellm.acompletion(**completion_params)

    token_usage = response.usage.dict()
    return {
        "message": response.choices[0].message.content,
        **{"usage": token_usage},
        "cost": ag.calculate_token_usage(ag.config.model, token_usage),
    }
