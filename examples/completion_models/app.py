import os
import openai
import replicate
import agenta as ag
from langchain.prompts import PromptTemplate

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
    "text-davinci-003",
    "text-davinci-002",
    "davinci",
    "curie",
    "babbage",
    "ada",
]

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.5),
    model=ag.MultipleChoiceParam(
        "gpt-3.5-turbo",
        CHAT_LLM_GPT + ["replicate"],
    ),
    maximum_length=ag.IntParam(1000, 0, 4000),
    stop_sequence=ag.TextParam(""),
    top_p=ag.FloatParam(0.9),
    frequence_penalty=ag.FloatParam(0.0),
    presence_penalty=ag.FloatParam(0.0),
    prompt_chunks=ag.TextParam(prompts["chat"]["input_prompt"]),
    prompt_final=ag.TextParam(prompts["chat"]["output_prompt"]),
)


def call_llm(model, temperature, prompt, **kwargs):
    if model in CHAT_LLM_GPT:
        prompt = prompts["chat"]["input_prompt"].format(text=kwargs["text"])
        openai.api_key = os.environ.get("OPENAI_API_KEY")
        chat_completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,  # Controls the creativity of the generated response
            max_tokens=kwargs[
                "maximum_length"
            ],  # Controls the maximum length of the generated response
            n=1,  # How many completions to generate
            stop=kwargs["stop_sequence"],
            top_p=kwargs["top_p"],
            frequency_penalty=kwargs["frequence_penalty"],
            presence_penalty=kwargs["presence_penalty"],
        )
        result = chat_completion.choices[0].message.content
        return result
    # replicate
    if model == "replicate":
        output = replicate.run(
            "replicate/llama-7b:ac808388e2e9d8ed35a5bf2eaa7d83f0ad53f9e3df31a42e4eb0a0c3249b3165",
            input={"prompt": prompt.format(text=kwargs["text"])},
            max_new_tokens=kwargs["maximum_length"],
            temperature=temperature,
            top_p=kwargs["top_p"],
            repetition_penalty=kwargs["frequence_penalty"],
        )

        return "".join(list(output))


@ag.entrypoint
def generate(
    transcript: str,
) -> str:
    transcript_chunks = [
        transcript[i : i + int(ag.config.maximum_length)]
        for i in range(0, len(transcript), int(ag.config.maximum_length))
    ]

    outputs = []
    prompt = PromptTemplate(
        input_variables=["text"],
        template=ag.config.prompt_chunks,
    )

    for chunk in transcript_chunks:
        outputs.append(
            call_llm(
                model=ag.config.model,
                temperature=ag.config.temperature,
                prompt=prompt,
                text=chunk,
                maximum_length=int(ag.config.maximum_length),
                stop_sequence=ag.config.stop_sequence,
                top_p=ag.config.top_p,
                frequence_penalty=ag.config.frequence_penalty,
                presence_penalty=ag.config.presence_penalty,
            )
        )

    outputs = "\n".join(outputs)
    return str(outputs)
