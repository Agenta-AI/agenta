import agenta as ag
from agenta import FloatParam, MessagesInput, MultipleChoiceParam
from openai import AsyncOpenAI


client = AsyncOpenAI()

SYSTEM_PROMPT = "You have expertise in offering technical ideas to startups."
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-16k-0613",
    "gpt-4",
]

ag.init()
ag.config.default(
    temperature=FloatParam(0.2),
    model=MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(SYSTEM_PROMPT),
)


@ag.entrypoint
async def chat(inputs: MessagesInput = MessagesInput()) -> str:
    messages = [{"role": "system", "content": ag.config.prompt_system}] + inputs
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    chat_completion = await client.chat.completions.create(
        model=ag.config.model,
        messages=messages,
        temperature=ag.config.temperature,
        max_tokens=max_tokens,
    )
    token_usage = chat_completion.usage.dict()
    return {
        "message": chat_completion.choices[0].message.content,
        **{"usage": token_usage},
        "cost": ag.calculate_token_usage(ag.config.model, token_usage),
    }
