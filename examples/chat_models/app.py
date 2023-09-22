import agenta as ag
import openai
import replicate
from agenta.types import MultipleChoiceParam
from langchain.chains import LLMChain
from langchain.chat_models import ChatOpenAI
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.schema import HumanMessage, SystemMessage

ag.init()

prompts = {
    "human_prompt": """What is the capital of {text}""",
    "system_prompt": "You are an expert in geography.",
}


replicate_dict = {
    "replicate/llama-2-7b-chat": "a16z-infra/llama-2-7b-chat:4f0b260b6a13eb53a6b1891f089d57c08f41003ae79458be5011303d81a394dc",
    "replicate/llama-2-70b-chat": "replicate/llama-2-70b-chat:2c1608e18606fad2812020dc541930f2d0495ce32eee50074220b87300bc16e1",
    "replicate/llama-2-13b-chat": "a16z-infra/llama-2-13b-chat:2a7f981751ec7fdf87b5b91ad4db53683a98082e9ff7bfd12c8cd5ea85980a52",
}

# ChatGpt 3.5 models
CHAT_LLM_GPT = [
    "gpt-3.5-turbo-16k-0613",
    "gpt-3.5-turbo-16k",
    "gpt-3.5-turbo-0613",
    "gpt-3.5-turbo-0301",
    "gpt-3.5-turbo",
    "gpt-4",
]

ag.config.default(
    temperature=ag.FloatParam(0.9),
    model=MultipleChoiceParam(
        "gpt-3.5-turbo", CHAT_LLM_GPT + list(replicate_dict.keys())
    ),
    maximum_length=ag.IntParam(100, 0, 4000),
    prompt_system=ag.TextParam(prompts["system_prompt"]),
    prompt_human=ag.TextParam(prompts["human_prompt"]),
    stop_sequence=ag.TextParam(""),
    top_p=ag.FloatParam(0.9),
    frequence_penalty=ag.FloatParam(0.0),
    presence_penalty=ag.FloatParam(0.0),
)


def call_llm(prompt_system, prompt_human):
    if ag.config.model in CHAT_LLM_GPT:
        chat = ChatOpenAI(
            model=ag.config.model,
            temperature=ag.config.temperature,
            max_tokens=ag.config.maximum_length,
            model_kwargs={
                "stop": ag.config.stop_sequence,
                "top_p": ag.config.top_p,
                "frequency_penalty": ag.config.frequence_penalty,
                "presence_penalty": ag.config.presence_penalty,
            },
        )
        messages = [
            SystemMessage(content=prompt_system),
            HumanMessage(content=prompt_human),
        ]
        output = chat(
            messages,
        ).content

    # replicate
    if ag.config.model.startswith("replicate"):
        output = replicate.run(
            replicate_dict[ag.config.model],
            input={
                "prompt": prompt_human,
                "system_prompt": ag.config.prompt_system,
                "max_new_tokens": ag.config.maximum_length,
                "temperature": ag.config.temperature,
                "top_p": ag.config.top_p,
                "repetition_penalty": ag.config.frequence_penalty,
            },
        )

    return "".join(list(output))


@ag.entrypoint
def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["text"]),
) -> str:
    try:
        prompt_human = PromptTemplate(
            input_variables=list(inputs.keys()), template=ag.config.prompt_human
        ).format(**inputs)
    except Exception:
        prompt_human = ag.config.prompt_human
    try:
        prompt_system = PromptTemplate(
            input_variables=list(inputs.keys()), template=ag.config.prompt_system
        ).format(**inputs)
    except Exception:
        prompt_system = ag.config.prompt_system

    outputs = call_llm(
        prompt_system=prompt_system,
        prompt_human=prompt_human,
    )
    return str(outputs)
