import agenta as ag
from agenta.types import MultipleChoiceParam
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage
import openai
import replicate

prompts = {
    "human_prompt": """What is the capital of {text}. Answer in one word that contains only aphabetical letters and without a dot at the end.
Remove dots, spaces, return to line, tab space characters and all invisible non printable before the word.
Remove dots, spaces, return to line, tab space characters and all invisible non printable after the word.
Remove all Carriage Return (ASCII 13, \r ) Line Feed (ASCII 10, \n ) characters.
ANSWER IN ONE SINGLE WORD WITHOUT ANY POSSIBLE INVISIBLE CHARACTER!!!.
REMOVE ALL NEWLINE CHARACTER, LINE BREAK, ENDOF LINE (EOL) OR "\n",""",
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


def call_llm(model, temperature, prompt_system, prompt_human, **kwargs):
    if model in CHAT_LLM_GPT:
        chat = ChatOpenAI(
            model=model,
            temperature=temperature,
            max_tokens=kwargs["maximum_length"],
            model_kwargs={
                "stop": kwargs["stop_sequence"],
                "top_p": kwargs["top_p"],
                "frequency_penalty": kwargs["frequence_penalty"],
                "presence_penalty": kwargs["presence_penalty"],
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
    if model.startswith("replicate"):
        output = replicate.run(
            replicate_dict[model],
            input={
                "prompt": prompt_human,
                "system_prompt": prompt_system,
                "max_new_tokens": kwargs["maximum_length"],
                "temperature": temperature,
                "top_p": kwargs["top_p"],
                "repetition_penalty": kwargs["frequence_penalty"],
            },
        )

    return "".join(list(output))


@ag.post
def generate(
    inputs: ag.DictInput = ag.DictInput(default_keys=["text"]),
    temperature: ag.FloatParam = 0.9,
    model: MultipleChoiceParam = ag.MultipleChoiceParam(
        "gpt-3.5-turbo",
        CHAT_LLM_GPT + list(replicate_dict.keys()),
    ),
    maximum_length: ag.IntParam = ag.IntParam(100, 0, 4000),
    prompt_system: ag.TextParam = prompts["system_prompt"],
    prompt_human: ag.TextParam = prompts["human_prompt"],
    stop_sequence: ag.TextParam = "\n",
    top_p: ag.FloatParam = 0.9,
    frequence_penalty: ag.FloatParam = 0.0,
    presence_penalty: ag.FloatParam = 0.0,
) -> str:
    try:
        prompt_human = PromptTemplate(
            input_variables=list(inputs.keys()), template=prompt_human
        ).format(**inputs)
    except Exception as e:
        prompt_human = prompt_human
    try:
        prompt_system = PromptTemplate(
            input_variables=list(inputs.keys()), template=prompt_system
        ).format(**inputs)
    except Exception as e:
        prompt_system = prompt_system

    outputs = call_llm(
        model=model,
        temperature=temperature,
        prompt_system=prompt_system,
        prompt_human=prompt_human,
        maximum_length=int(maximum_length),
        stop_sequence=stop_sequence,
        top_p=top_p,
        frequence_penalty=frequence_penalty,
        presence_penalty=presence_penalty,
    )
    return str(outputs)
