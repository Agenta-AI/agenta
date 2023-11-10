import agenta as ag
from openai import OpenAI

client = OpenAI()
import json

default_prompt = """You are a world class algorithm for extracting information in structured formats. Extract information and create a valid JSON from the following input: {text}"""
function_json_string = """
{
    "name": "extract_information",
    "description": "Extract information from user-provided text",
    "parameters": {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "The text to extract information from"
            }
        }
    }
}
"""

ag.init()
ag.config.default(
    temperature=ag.FloatParam(0.9),
    prompt_template=ag.TextParam(default_prompt),
    function_json=ag.TextParam(function_json_string),
)


@ag.entrypoint
def generate(
    text: str,
) -> str:
    messages = [
        {
            "role": "user",
            "content": ag.config.prompt_template.format(text=text),
        },
    ]

    function = json.loads(ag.config.function_json)

    response = client.chat.completions.create(model="gpt-3.5-turbo-0613",
    messages=messages,
    temperature=ag.config.temperature,
    functions=[function])

    output = str(response["choices"][0]["message"]["function_call"])
    return output
