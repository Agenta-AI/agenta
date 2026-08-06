import agenta as ag
from openai import OpenAI
from pydantic import BaseModel, Field

client = OpenAI()

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()


class BabyConfig(BaseModel):
    temperature: float = Field(default=0.2)
    prompt_template: str = Field(default=default_prompt)


@ag.route("/", config_schema=BabyConfig)
def generate(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.
    """
    config = ag.ConfigManager.get_from_route(schema=BabyConfig)
    prompt = config.prompt_template.format(country=country, gender=gender)

    chat_completion = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
        temperature=config.temperature,
    )
    token_usage = chat_completion.usage.dict()
    return {
        "message": chat_completion.choices[0].message.content,
        **{"usage": token_usage},
        "cost": ag.calculate_token_usage("gpt-3.5-turbo", token_usage),
    }
