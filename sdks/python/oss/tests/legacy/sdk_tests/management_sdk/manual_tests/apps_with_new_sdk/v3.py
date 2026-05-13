import os

import agenta as ag
from agenta.sdk.managers.config import ConfigManager
from pydantic import BaseModel

os.environ["AGENTA_MODE"] = "true"

default_prompt = (
    "Give me 10 names for a baby from this country {country} with gender {gender}!!!!"
)

ag.init()


class NestConfig(BaseModel):
    some_param: str = "hello"


class MyConfigSchema(BaseModel):  # <- the app
    prompt_1: ag.Prompt = ag.Prompt(prompt_system="hello")
    prompt_2: ag.Prompt = ag.Prompt(prompt_system="hello")
    nest_config: NestConfig = NestConfig()


@ag.route(
    path="/", config_schema=MyConfigSchema, is_active=os.environ.get("AGENTA_MODE")
)
def rag(country: str, gender: str) -> str:
    """
    Generate a baby name based on the given country and gender.

    Args:
        country (str): The country to generate the name from.
        gender (str): The gender of the baby.

    Returns:
        str: The generated baby name.`
    """
    if os.environ.get("AGENTA_MODE") == "true":
        config = ConfigManager.get_from_route(schema=MyConfigSchema)
    else:
        config = ConfigManager.get_from_registry(
            schema=MyConfigSchema, environment="production"
        )
    prompt = config.pro.format(country=country, gender=gender)

    return f"mock output for {prompt}"


if __name__ == "__main__":
    rag(country="USA", gender="male")
