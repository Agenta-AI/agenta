import agenta as ag
import openai
from agenta.types import FloatParam, TextParam

default_prompt = (
    "Give me 5 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()
ag.config.default(
    temperature=FloatParam(0.9), prompt_template=TextParam(default_prompt)
)


@ag.entrypoint
def generate(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.
    """
    prompt = ag.config.prompt_template.format(country=country, gender=gender)

    chat_completion = openai.ChatCompletion.create(
        model="gpt-3.5-turbo", messages=[{"role": "user", "content": prompt}]
    )
    return chat_completion.choices[0].message.content
