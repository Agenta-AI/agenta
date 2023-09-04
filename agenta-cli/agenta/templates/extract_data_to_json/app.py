import agenta as ag
import openai
from langchain.chat_models import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.chains.openai_functions import create_structured_output_chain

default_prompt = """Create a valid JSON with the text: {text}"""


@ag.post
def generate(
    text: str,
    temperature: ag.FloatParam = 0.9,
    prompt_template: ag.TextParam = default_prompt,
) -> str:
    messages = [
        {
            "role": "user",
            "content": f"You are a world class algorithm for extracting information in structured formats. Extract information and create a valid JSON from the following input: {text}",
        },
    ]

    prompt = {
        "name": "extract_information",
        "description": "Extract information from user-provided text",
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to extract information from",
                }
            },
        },
    }

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo-0613",
        messages=messages,
        functions=[prompt],
    )

    output = response["choices"][0]["message"]["content"]
    return output
