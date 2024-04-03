import agenta as ag
from openai import AsyncOpenAI

client = AsyncOpenAI()


prompt_1 = "Determine the three main topics that a user would ask about based on this documentation page {context_1}"
prompt_2 = "Create 10 Question and Answers based on the following topics {topics} and the documentation page {context_1} "

CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k-0613",
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-1106",
    "gpt-3.5-turbo-061`3",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo",
    "gpt-4",
    "gpt-4-1106-preview",
]

ag.init()
ag.config.default(
    temperature_1=ag.FloatParam(default=1, minval=0.0, maxval=2.0),
    model_1=ag.MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens_1=ag.IntParam(-1, -1, 4000),
    prompt_user_1=ag.TextParam(prompt_1),
    top_p_1=ag.FloatParam(1),
    frequence_penalty_1=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    presence_penalty_1=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    temperature_2=ag.FloatParam(default=1, minval=0.0, maxval=2.0),
    model_2=ag.MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens_2=ag.IntParam(-1, -1, 4000),
    prompt_user_2=ag.TextParam(prompt_2),
    top_p_2=ag.FloatParam(1),
    frequence_penalty_2=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
    presence_penalty_2=ag.FloatParam(default=0.0, minval=-2.0, maxval=2.0),
)


@ag.span(type="llm_request")
async def llm_call(
    prompt: str,
    model: str,
    temperature: float,
    max_tokens: int,
    top_p: float,
    frequency_penalty: float,
    presence_penalty: float,
):
    response = await client.chat.completions.create(
        model=model,
        messages=[{"content": prompt, "role": "user"}],
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        frequency_penalty=frequency_penalty,
        presence_penalty=presence_penalty,
    )
    ag.tracing.set_span_attribute(
        "model_config", {"model": model, "temperature": temperature}
    )
    tokens_usage = response.usage.dict()  # type: ignore
    return {
        "cost": ag.calculate_token_usage(model, tokens_usage),
        "message": response.choices[0].message.content,
        "usage": tokens_usage,
    }


@ag.span(type="llm_request")
async def finalize_wrapper(context_1: str, max_tokens: int, llm_response: str):
    prompt = ag.config.prompt_user_2.format(topics=llm_response, context_1=context_1)
    response = await llm_call(
        prompt=prompt,
        model=ag.config.model_2,
        temperature=ag.config.temperature_2,
        max_tokens=max_tokens,
        top_p=ag.config.top_p_2,
        frequency_penalty=ag.config.frequence_penalty_2,
        presence_penalty=ag.config.presence_penalty_2,
    )
    return response


@ag.span(type="llm_request")
async def wrapper(context_1: str, max_tokens: int):
    prompt = ag.config.prompt_user_1.format(context_1=context_1)

    response = await llm_call(
        prompt=prompt,
        model=ag.config.model_1,
        temperature=ag.config.temperature_1,
        max_tokens=max_tokens,
        top_p=ag.config.top_p_1,
        frequency_penalty=ag.config.frequence_penalty_1,
        presence_penalty=ag.config.presence_penalty_1,
    )
    final_response = await finalize_wrapper(
        context_1=context_1,
        max_tokens=max_tokens,
        llm_response=response["message"],
    )
    return final_response


@ag.entrypoint
async def generate(context_1: str):
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.
    """

    max_tokens = ag.config.max_tokens_1 if ag.config.max_tokens_1 != -1 else None
    response = await wrapper(context_1=context_1, max_tokens=max_tokens)
    return {
        "message": response["message"],
        "usage": response["usage"],
        "cost": response["cost"],
    }
