import os

import openai
from agenta import FloatParam, TextParam, post
from fastapi import Body
from jinja2 import Template

default_prompt = "Give me five cool names for a baby from this country {{country}} with this gender {{gender}}!!!!"


@post
def generate(
    country: str,
    gender: str,
    temperature: FloatParam = FloatParam(0.9),
    prompt_template: TextParam = default_prompt,
) -> str:
    template = Template(prompt_template)
    prompt = template.render(country=country, gender=gender)

    openai.api_key = os.environ.get("OPENAI_API_KEY")  # make sure to set this manually!
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}]
    )

    result = chat_completion.choices[0].message.content
    return result
