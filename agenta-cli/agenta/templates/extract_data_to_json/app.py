import agenta as ag
import openai
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


@ag.post
def generate(
    text: str,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
    function_json: ag.TextParam = function_json_string,
) -> str:
    messages = [
        {
            "role": "user",
            "content": prompt_template.format(text=text),
        },
    ]

    function = json.loads(function_json)

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo-0613",
        messages=messages,
        temperature=temperature,
        functions=[function],
    )

    output = str(response["choices"][0]["message"]["function_call"])
    return output
