import agenta
import agenta as ag
from openai import OpenAI

client = OpenAI()

prompt_1 = "Determine the three main topics that a user would ask about based on this documentation page {context_1}"
prompt_2 = "Create 10 Question and Answers based on the following topics {topics} and the documentation page {context_1} "

ag.init(app_name="test", base_name="app")
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


@ag.entrypoint
async def generate(context_1: str) -> str:
    prompt = ag.config.prompt_user_1.format(context_1=context_1)

    max_tokens = ag.config.max_tokens_1 if ag.config.max_tokens_1 != -1 else None
    response = client.chat.completions.create(
        model=ag.config.model_1,
        messages=[{"content": prompt, "role": "user"}],
        temperature=ag.config.temperature_1,
        max_tokens=max_tokens,
        top_p=ag.config.top_p_1,
        frequency_penalty=ag.config.frequence_penalty_1,
        presence_penalty=ag.config.presence_penalty_1,
    )
    prompt2 = ag.config.prompt_user_2.format(
        topics=response.choices[0].message.content, context_1=context_1
    )
    response = client.chat.completions.create(
        model=ag.config.model_2,
        messages=[{"content": prompt2, "role": "user"}],
        temperature=ag.config.temperature_2,
        max_tokens=max_tokens,
        top_p=ag.config.top_p_2,
        frequency_penalty=ag.config.frequence_penalty_2,
        presence_penalty=ag.config.presence_penalty_2,
    )
    return response.choices[0].message.content
