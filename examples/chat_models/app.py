import agenta as ag
from agenta.types import MultipleChoiceParam
from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate
from langchain.chat_models import ChatOpenAI
from langchain.schema import (
    HumanMessage,
)
import openai
import replicate

prompts = {
    "chat": {
        "input_prompt": """What is the capital of {text}. Answer in one word that contains only aphabetical letters and without a dot at the end.
Remove dots, spaces, return to line, tab space characters and all invisible non printable before the word.
Remove dots, spaces, return to line, tab space characters and all invisible non printable after the word.
Remove all Carriage Return (ASCII 13, \r ) Line Feed (ASCII 10, \n ) characters.
ANSWER IN ONE SINGLE WORD WITHOUT ANY POSSIBLE INVISIBLE CHARACTER!!!.
REMOVE ALL NEWLINE CHARACTER, LINE BREAK, ENDOF LINE (EOL) OR "\n",""",
        "output_prompt": "{text}",
    }
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


def call_llm(model, temperature, prompt, **kwargs):
    # import ipdb
    # ipdb.set_trace()
    if model == "text-davinci-003":
        llm = OpenAI(model=model, temperature=temperature)
        chain = LLMChain(llm=llm, prompt=prompt)
        output = chain.run(**kwargs)
    elif model in CHAT_LLM_GPT:
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
        messages = [HumanMessage(content=prompt.format(text=kwargs["text"]))]
        output = chat(
            messages,
        ).content

    # replicate
    if model == "replicate":
        print("\n\n Input", prompt.format(text=kwargs["text"]))
        output = replicate.run(
            "a16z-infra/llama-2-7b-chat:4f0b260b6a13eb53a6b1891f089d57c08f41003ae79458be5011303d81a394dc",
            input={"prompt": prompt.format(text=kwargs["text"])},
            max_new_tokens=kwargs["maximum_length"],
            temperature=temperature,
            top_p=kwargs["top_p"],
            repetition_penalty=kwargs["frequence_penalty"],
        )

    return "".join(list(output))


@ag.post
def generate(
    transcript: str,
    # ----- ChatGPT 3.5 Params -----
    temperature: ag.FloatParam = 0.9,
    model: MultipleChoiceParam = MultipleChoiceParam(
        "gpt-3.5-turbo",
        CHAT_LLM_GPT + ["replicate"],
    ),
    # Min 1000, Max 4000
    maximum_length: ag.FloatParam = 3000,
    stop_sequence: ag.TextParam = "\n",
    top_p: ag.FloatParam = 0.9,
    frequence_penalty: ag.FloatParam = 0.0,
    presence_penalty: ag.FloatParam = 0.0,
    prompt_chunks: ag.TextParam = prompts["chat"]["input_prompt"],
    prompt_final: ag.TextParam = prompts["chat"]["output_prompt"],
) -> str:
    transcript_chunks = [
        transcript[i : i + int(maximum_length)]
        for i in range(0, len(transcript), int(maximum_length))
    ]

    outputs = []
    prompt = PromptTemplate(
        input_variables=["text"],
        template=prompt_chunks,
    )

    for chunk in transcript_chunks:
        outputs.append(
            call_llm(
                model=model,
                temperature=temperature,
                prompt=prompt,
                text=chunk,
                maximum_length=int(maximum_length),
                stop_sequence=stop_sequence,
                top_p=top_p,
                frequence_penalty=frequence_penalty,
                presence_penalty=presence_penalty,
            )
        )

    outputs = "\n".join(outputs)
    return str(outputs)
