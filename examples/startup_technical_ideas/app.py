import agenta as ag
from agenta import FloatParam, MessagesInput, MultipleChoiceParam
from openai import OpenAI

client = OpenAI()

SYSTEM_PROMPT = "You have expertise in offering technical ideas to startups."
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-16k-0613",
    "gpt-4",
]

ag.init(app_name="technical_ideas", base_name="app")
ag.config.default(
    temperature=FloatParam(0.2),
    model=MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(SYSTEM_PROMPT),
)


@ag.entrypoint
def chat(
    messages: MessagesInput = MessagesInput([{"role": "string", "content": "string"}])
) -> str:
    messages = [{"role": "system", "content": ag.config.system_prompt}] + messages
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    chat_completion = client.chat.completions.create(
        model=ag.config.model,
        messages=messages,
        temperature=ag.config.temperature,
        max_tokens=max_tokens,
    )
    return chat_completion.choices[0].message.content
