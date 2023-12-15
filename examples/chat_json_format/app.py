import agenta as ag
from agenta.sdk.types import BinaryParam
from openai import OpenAI

client = OpenAI()

SYSTEM_PROMPT = "You have expertise in offering technical ideas to startups. Responses should be in json."
GPT_FORMAT_RESPONSE = ["gpt-3.5-turbo-1106", "gpt-4-1106-preview"]
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-16k-0613",
    "gpt-4",
] + GPT_FORMAT_RESPONSE

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.2),
    model=ag.MultipleChoiceParam("gpt-3.5-turbo", CHAT_LLM_GPT),
    max_tokens=ag.IntParam(-1, -1, 4000),
    prompt_system=ag.TextParam(SYSTEM_PROMPT),
    force_json_response=BinaryParam(),
)


@ag.entrypoint
def chat(inputs: ag.MessagesInput = ag.MessagesInput()):
    messages = [{"role": "system", "content": ag.config.prompt_system}] + inputs
    max_tokens = ag.config.max_tokens if ag.config.max_tokens != -1 else None
    response_format = (
        {"type": "json_object"}
        if ag.config.force_json_response and ag.config.model in GPT_FORMAT_RESPONSE
        else {"type": "text"}
    )
    chat_completion = client.chat.completions.create(
        model=ag.config.model,
        messages=messages,
        temperature=ag.config.temperature,
        max_tokens=max_tokens,
        response_format=response_format,
    )
    return chat_completion.choices[0].message.content
