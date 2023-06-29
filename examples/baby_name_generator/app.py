import os

import openai
from agenta import post
from fastapi import Body
from jinja2 import Template

default_prompt = "Give me five cool names for a baby from this country {{country}} with this gender {{gender}}!!!!"


@post
def generate(body_params: dict = Body(...)) -> str:

    template = Template(body_params['prompt_template'])
    prompt = template.render(country=body_params['country'], gender=body_params['gender'])

    openai.api_key = os.environ.get("OPENAI_API_KEY")  # make sure to set this manually!
    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}])

    result = chat_completion.choices[0].message.content
    return result
